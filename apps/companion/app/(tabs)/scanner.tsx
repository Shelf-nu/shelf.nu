import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  useWindowDimensions,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  InteractionManager,
  Linking,
  Platform,
  Alert,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { openShelfWebUrl, pushIntoTab } from "@/lib/navigation";
import { cancelBookingReminders, syncBookingReminders } from "@/lib/reminders";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import type { TeamMember, Location as LocationType } from "@/lib/api";
import type { BookingAsset, ScannedKit } from "@/lib/api/types";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { extractQrId } from "@/lib/qr-utils";
import { parseSequentialId } from "@/lib/sequential-id";
import { announce } from "@/lib/a11y";
import { playScanSound } from "@/lib/scan-sound";
import { userHasPermission } from "@/lib/permissions";
import {
  computeBlockers,
  blockedQrIds,
  type BatchScanAction,
  type BlockerGroup,
} from "@/lib/batch-blockers";
import { markBookingDirty } from "@/lib/booking-refresh";
import { ScannerErrorBoundary } from "@/components/scanner-error-boundary";
import { useScanLineAnimation } from "@/hooks/use-scan-line-animation";
import { useInactivityTimer } from "@/hooks/use-inactivity-timer";
import { useScanCooldown } from "@/hooks/use-scan-cooldown";
import { useScannerGestures } from "@/hooks/use-scanner-gestures";
import { useScanProcessing } from "@/hooks/use-scan-processing";
import { ScanFrame } from "@/components/scanner/scan-frame";
import { ScanResultCard } from "@/components/scanner/scan-result-card";
import { ActionPills, ModeDots } from "@/components/scanner/action-pills";
import { ActionPillsCoachmark } from "@/components/scanner/action-pills-coachmark";
import { BatchDrawer } from "@/components/scanner/batch-drawer";

// ── Action Types ────────────────────────────────────────

type ScannerAction =
  | "view"
  | "assign_custody"
  | "release_custody"
  | "update_location";

type PermissionRequirement = {
  entity: "asset";
  action: "read" | "custody" | "update";
};

const SCANNER_ACTIONS: {
  key: ScannerAction;
  label: string;
  icon: string;
  permission: PermissionRequirement;
}[] = [
  {
    key: "view",
    label: "View",
    icon: "eye-outline",
    permission: { entity: "asset", action: "read" },
  },
  {
    key: "assign_custody",
    label: "Assign",
    icon: "person-add-outline",
    permission: { entity: "asset", action: "custody" },
  },
  {
    key: "release_custody",
    label: "Release",
    icon: "person-remove-outline",
    permission: { entity: "asset", action: "custody" },
  },
  {
    key: "update_location",
    label: "Location",
    icon: "location-outline",
    permission: { entity: "asset", action: "update" },
  },
];

const isBatchAction = (a: ScannerAction) => a !== "view";

// ── Scanned Item Type ───────────────────────────────────

type ScannedItem = {
  /** Entity kind — kits batch alongside assets, mirroring the web scanner. */
  type: "asset" | "kit";
  qrId: string;
  /** Asset id for type=asset, kit id for type=kit. */
  targetId: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: string | null;
  /** Assets only: set when the asset belongs to a kit (part-of-kit blocker). */
  kitId: string | null;
  /** Assets only: false when the asset is marked unavailable to book. */
  availableToBook?: boolean;
  /**
   * Assets only: the model this asset belongs to, or null. Fulfil mode matches
   * it against the booking's outstanding reservations, so progress counts only
   * units that genuinely fulfil one instead of counting every scan.
   */
  assetModelId?: string | null;
  /** Kits only: true when any contained asset is unavailable to book. */
  hasUnavailableAssets?: boolean;
  /** Kits only: number of contained assets (shown in the drawer row). */
  assetCount?: number;
  /** Kits only: true when any contained asset is individually in custody. */
  hasAssetsInCustody?: boolean;
};

/**
 * Match scanned items against a booking's outstanding model reservations.
 *
 * Shared by the live progress readout and the pre-submit revalidation, so both
 * use identical rules. Each asset consumes one unit of an outstanding request
 * for its model; once a model's remaining count hits zero, further units of it
 * are unmatched — mirroring `materializeModelRequestForAsset`, which returns
 * `matched: false` once `fulfilledQuantity >= quantity`.
 */
function matchScansToReservations(
  items: ScannedItem[],
  outstanding: { assetModelId: string; outstandingQuantity: number }[],
  required: number
) {
  const remainingByModel = new Map(
    outstanding.map((r) => [r.assetModelId, r.outstandingQuantity])
  );
  const unmatchedIds = new Set<string>();
  let matched = 0;

  for (const item of items) {
    if (item.type !== "asset") continue;
    const modelId = item.assetModelId ?? null;
    const remaining = modelId ? remainingByModel.get(modelId) ?? 0 : 0;
    if (remaining > 0) {
      remainingByModel.set(modelId as string, remaining - 1);
      matched += 1;
    } else {
      unmatchedIds.add(item.targetId);
    }
  }

  return {
    matched,
    required,
    unmatchedIds,
    isComplete: required > 0 && matched >= required,
  };
}

// ── Scanner Content ─────────────────────────────────────

function ScannerContent() {
  const router = useRouter();
  const { bookingId, bookingName, bookingAction } = useLocalSearchParams<{
    bookingId?: string;
    bookingName?: string;
    /** "checkin" (default) or "add" — which booking flow the scanner serves. */
    bookingAction?: string;
  }>();
  const isFocused = useIsFocused();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();

  // Booking check-in mode
  const isBookingMode = !!bookingId;
  // Fulfil-and-check-out flow (book-by-model): the booking reserved N units of
  // a model up front; the operator scans the concrete units to assign them and
  // check the booking out in one atomic motion (web parity — see the web
  // `fulfil-and-checkout` scanner). It scans exactly like add mode; it only
  // differs on submit (assign + checkout instead of add) and in its labels.
  const isBookingFulfilMode = isBookingMode && bookingAction === "fulfil";
  // Scan-to-build flow: same booking header, but scans ADD items (assets and
  // kits) to the booking instead of checking them in. Fulfil mode is a
  // superset — it too captures scans into the add list, then checks out — so
  // all the add-mode scan capture / blockers / list rendering apply to both.
  const isBookingAddMode =
    isBookingMode && (bookingAction === "add" || bookingAction === "fulfil");

  // Filter scanner actions based on the user's role in the current org
  const availableActions = useMemo(
    () =>
      SCANNER_ACTIONS.filter(({ permission: perm }) =>
        userHasPermission({
          roles: currentOrg?.roles,
          entity: perm.entity,
          action: perm.action,
        })
      ),
    [currentOrg?.roles]
  );

  // Self-service users may only assign custody to themselves (mirrors the
  // web scanner, which pre-selects self and disables the custodian picker).
  const isSelfService = currentOrg?.roles?.includes("SELF_SERVICE") ?? false;

  // Action state
  const [action, setAction] = useState<ScannerAction>("view");

  // Batch state (for assign/release/location modes)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Blockers: items in the list that make the batch ineligible for the
  // current action. The bulk services are all-or-nothing, so submit stays
  // disabled until these are resolved (web-scanner parity).
  const blockers = useMemo<BlockerGroup[]>(
    () =>
      isBatchAction(action)
        ? computeBlockers(action as BatchScanAction, scannedItems)
        : [],
    [action, scannedItems]
  );

  const resolveBlocker = useCallback((group: BlockerGroup) => {
    setScannedItems((prev) =>
      prev.filter((i) => !group.qrIds.includes(i.qrId))
    );
  }, []);

  const resolveAllBlockers = useCallback(() => {
    const blocked = blockedQrIds(blockers);
    setScannedItems((prev) => prev.filter((i) => !blocked.has(i.qrId)));
  }, [blockers]);

  /**
   * Measured height of the open drawer. The overlay itself never resizes (see
   * the bottom-section comment), so this is used only to lift the floating
   * manual-entry pill clear of the drawer.
   */
  const [drawerHeight, setDrawerHeight] = useState(0);

  // Pickers
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Booking check-in items (separate from batch scan)
  const [bookingCheckinItems, setBookingCheckinItems] = useState<ScannedItem[]>(
    []
  );
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);

  /**
   * Clear the measured height once no drawer can be showing. The drawer host
   * unmounts on close, so its `onLayout` never fires again — without this the
   * manual-entry pill stays floating at the old offset over empty space.
   *
   * Mirrors the `show*Drawer` predicates further down (which sit past an early
   * return, so a hook can't read them) rather than only checking the item
   * lists: the drawer also disappears when `action` or booking mode changes.
   */
  const anyDrawerVisible =
    (!isBookingMode && isBatchAction(action) && scannedItems.length > 0) ||
    (isBookingMode && bookingCheckinItems.length > 0);
  useEffect(() => {
    if (!anyDrawerVisible) setDrawerHeight(0);
  }, [anyDrawerVisible]);

  /**
   * Where the floating manual-entry control sits, or `null` when it cannot be
   * placed without overlapping something.
   *
   * It is anchored inside the bottom strip, which is roughly half the space
   * left over after the 240px frame. Lifting it by the full drawer height
   * clears the drawer but can push it up INTO the frame and over the
   * instruction text — the drawer grows to 280px (400px with blockers), so on
   * a short viewport no offset clears both. In that case we render nothing
   * rather than recreate the overlap this fix exists to remove: the camera and
   * the drawer's own actions still work, and clearing an item restores the gap.
   */
  const { height: windowHeight } = useWindowDimensions();
  const manualEntryBottom = useMemo(() => {
    const DEFAULT_BOTTOM = 90;
    const CONTROL_HEIGHT = 48;
    if (drawerHeight <= DEFAULT_BOTTOM) return DEFAULT_BOTTOM;

    // Space between the frame's bottom edge and the screen bottom.
    const stripHeight = (windowHeight - FRAME_SIZE) / 2;
    const desired = drawerHeight + spacing.md;
    const maxBottom = stripHeight - CONTROL_HEIGHT - spacing.md;
    return desired > maxBottom ? null : desired;
  }, [drawerHeight, windowHeight]);

  // Booking context for both booking modes. Add mode uses bookedAssetIds +
  // bookingStatus for its blockers (web parity); check-in mode uses the
  // full asset rows for membership gates and kit→member expansion, plus
  // checkedInAssetIds to reject already-returned assets at scan time.
  const [bookingCtx, setBookingCtx] = useState<{
    bookedAssetIds: Set<string>;
    bookingStatus: string;
    bookedAssets: BookingAsset[];
    checkedInAssetIds: Set<string>;
    // Book-by-model reservations still awaiting concrete units, so fulfil mode
    // can tell the operator exactly what (and how many) to scan.
    outstandingModelRequests: {
      /** Needed to match a scanned asset's model against this reservation. */
      assetModelId: string;
      assetModelName: string;
      outstandingQuantity: number;
    }[];
    outstandingModelUnitCount: number;
  } | null>(null);

  // Also called from the scan paths when a code arrives before the first
  // fetch lands (or after it failed) — a scan-while-loading retries it.
  const fetchBookingCtx = useCallback(() => {
    if (!isBookingMode || !bookingId || !currentOrg) return;
    api.booking(bookingId, currentOrg.id).then(({ data }) => {
      if (!data) return;
      setBookingCtx({
        bookedAssetIds: new Set(data.booking.assets.map((a) => a.id)),
        bookingStatus: data.booking.status,
        bookedAssets: data.booking.assets,
        checkedInAssetIds: new Set(data.checkedInAssetIds),
        outstandingModelRequests: (data.booking.modelRequests ?? [])
          .filter((r) => r.fulfilledAt === null && r.outstandingQuantity > 0)
          .map((r) => ({
            assetModelId: r.assetModelId,
            assetModelName: r.assetModelName,
            outstandingQuantity: r.outstandingQuantity,
          })),
        outstandingModelUnitCount: data.booking.outstandingModelUnitCount ?? 0,
      });
    });
  }, [isBookingMode, bookingId, currentOrg]);

  useEffect(() => {
    fetchBookingCtx();
  }, [fetchBookingCtx]);

  // Blockers for the add-to-booking list (the check-in flow has its own
  // eligibility rule at scan time and no blockers).
  const bookingBlockers = useMemo<BlockerGroup[]>(
    () =>
      isBookingAddMode && bookingCtx
        ? computeBlockers("booking_add", bookingCheckinItems, bookingCtx)
        : [],
    [isBookingAddMode, bookingCtx, bookingCheckinItems]
  );

  const resolveBookingBlocker = useCallback((group: BlockerGroup) => {
    setBookingCheckinItems((prev) =>
      prev.filter((i) => !group.qrIds.includes(i.qrId))
    );
  }, []);

  const resolveAllBookingBlockers = useCallback(() => {
    const blocked = blockedQrIds(bookingBlockers);
    setBookingCheckinItems((prev) => prev.filter((i) => !blocked.has(i.qrId)));
  }, [bookingBlockers]);

  // Dev-mode scan injection (stripped from production builds)
  const [devScanInput, setDevScanInput] = useState("");
  const [devScanVisible, setDevScanVisible] = useState(false);

  // Cooldown (shared hook)
  const {
    shouldSkip: shouldSkipScan,
    startCooldown,
    lastScanRef,
  } = useScanCooldown();

  // Scan processing state (extracted hook) -- created first so
  // its setIsPaused can be referenced by the inactivity callback.
  const setIsPausedRef = useRef<(v: boolean) => void>(() => {});
  const onInactivityTimeout = useCallback(
    () => setIsPausedRef.current(true),
    []
  );

  // Placeholder resetTimer -- will be replaced after useInactivityTimer
  const resetTimerRef = useRef<() => void>(() => {});
  const scanProcessing = useScanProcessing({
    resetTimer: () => resetTimerRef.current(),
  });

  const {
    isProcessing,
    setIsProcessing,
    isProcessingRef,
    scanResult,
    setScanResult,
    frameHighlight,
    flashFrame,
    isPaused,
    togglePause,
    torchEnabled,
    toggleTorch,
    dismissResult: dismissResultBase,
  } = scanProcessing;

  // Wire up the ref so inactivity timeout can call setIsPaused
  setIsPausedRef.current = scanProcessing.setIsPaused;

  // Inactivity auto-pause (shared hook)
  const { resetTimer: resetInactivityTimer } = useInactivityTimer({
    isFocused,
    isPaused,
    onTimeout: onInactivityTimeout,
  });

  // Wire up the resetTimer ref so useScanProcessing.togglePause can call it
  resetTimerRef.current = resetInactivityTimer;

  const dismissResult = useCallback(() => {
    dismissResultBase();
    lastScanRef.current = "";
  }, [dismissResultBase, lastScanRef]);

  // Animation for scan line (shared hook)
  const scanLineAnim = useScanLineAnimation(isFocused, isPaused);

  // Clear batch items when switching actions
  const handleActionChange = useCallback(
    (newAction: ScannerAction) => {
      if (scannedItems.length > 0 && newAction !== action) {
        Alert.alert(
          "Switch Action?",
          `You have ${scannedItems.length} scanned item${
            scannedItems.length > 1 ? "s" : ""
          }. Switching will clear them.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Switch",
              style: "destructive",
              onPress: () => {
                setScannedItems([]);
                setScanResult(null);
                lastScanRef.current = "";
                setAction(newAction);
              },
            },
          ]
        );
      } else {
        setAction(newAction);
      }
    },
    [action, scannedItems.length, setScanResult, lastScanRef]
  );

  // Swipe gestures (extracted hook)
  const { panResponder, swipeTranslateX, swipeOpacity } = useScannerGestures({
    availableActions,
    action,
    handleActionChange,
    isBookingMode,
    isPaused,
    isProcessing,
    isSubmitting,
    scannedItemsCount: scannedItems.length,
  });

  /** Release the processing lock and start the cooldown timer */
  const finalizeScan = () => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    startCooldown();
  };

  // ── Scan Handler ────────────────────────────────────

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (isProcessingRef.current || shouldSkipScan(data)) return;

      isProcessingRef.current = true;
      lastScanRef.current = data;
      setIsProcessing(true);
      setScanResult(null);
      resetInactivityTimer();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        const qrId = extractQrId(data);
        // SAM / sequential ids (e.g. SAM-0001) aren't QR ids — they resolve
        // via the QR route's sequentialId branch, scoped to the current
        // workspace (web parity: the web scan resolver tries parseSequentialId
        // before the QR lookup, ungated by the Barcodes add-on). SAM is unique
        // per-org, so this needs currentOrg; without it we fall through to the
        // barcode path, which already errors cleanly.
        const samId = !qrId && currentOrg ? parseSequentialId(data) : null;
        // The code to resolve via the QR route: a QR id or a normalized SAM id.
        const qrLookupId = qrId ?? samId;
        let codeId: string;
        let codeOrgId: string | null;
        let asset: {
          id: string;
          title: string;
          status: string;
          mainImage: string | null;
          // The kit the ASSET belongs to (distinct from the `kitId` local
          // below, which is the kit a kit-linked QR points at directly).
          kitId: string | null;
          availableToBook: boolean;
          /**
           * Model this asset belongs to, or null. Fulfil mode matches it
           * against the booking's outstanding reservations so progress counts
           * only units that actually fulfil one. Optional: an older server
           * omits it, and the client then treats the match as unknown rather
           * than claiming false progress.
           */
          assetModelId?: string | null;
          category: { name: string } | null;
          location: { name: string } | null;
        } | null;
        // The kit a kit-linked code resolves to (full object for batch ops).
        let kit: ScannedKit | null = null;
        // A QR can be asset-less but still linked to a kit. We track kitId
        // separately because the create-asset flow must not be offered for
        // kit-linked QRs (see the !asset branch below for the full rationale).
        let kitId: string | null = null;

        if (qrLookupId) {
          // ── Shelf QR / SAM path ──

          // Early batch dedup by code id (saves a network call)
          if (
            isBatchAction(action) &&
            scannedItems.some((item) => item.qrId === qrLookupId)
          ) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: "This item is already in your scan list.",
            });
            finalizeScan();
            return;
          }

          // orgId is only consumed by the server's SAM branch; on the QR path
          // the org is derived from the QR record and this is ignored.
          const { data: qrData, error } = await api.qr(
            qrLookupId,
            currentOrg?.id
          );

          if (error || !qrData) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

            // Detect unclaimed QR codes — offer browser link instead of generic error
            const isUnclaimed =
              error === "This QR code is not linked to any organization";

            if (isUnclaimed) {
              setScanResult({
                type: "not_found",
                title: "No Asset Linked",
                message:
                  "This QR code is not linked to any asset. Open the web app to link it.",
                action: {
                  label: "Link in Browser",
                  icon: "open-outline",
                  onPress: () => {
                    void openShelfWebUrl(`https://app.shelf.nu/qr/${qrId}`);
                    dismissResult();
                  },
                },
              });
            } else {
              setScanResult({
                type: "error",
                title: "Lookup Failed",
                message: error || "Could not look up this QR code.",
              });
            }
            finalizeScan();
            return;
          }

          codeId = qrLookupId;
          codeOrgId = qrData.qr?.organizationId ?? null;
          asset = qrData.qr?.asset ?? null;
          kit = qrData.qr?.kit ?? null;
          kitId = qrData.qr?.kitId ?? null;
        } else {
          // ── Barcode fallback path ──

          if (!currentOrg) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Code not recognized");
            setScanResult({
              type: "not_found",
              title: "Code Not Recognized",
              message: "This code is not recognized as a Shelf asset code.",
            });
            finalizeScan();
            return;
          }

          if (!currentOrg.barcodesEnabled) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Barcode scanning not available");
            setScanResult({
              type: "not_found",
              title: "Barcode Not Supported",
              message:
                "Your workspace does not support barcode scanning. Contact your admin to enable this feature.",
            });
            finalizeScan();
            return;
          }

          const { data: barcodeData, error: barcodeError } = await api.barcode(
            data,
            currentOrg.id
          );

          if (barcodeError || !barcodeData) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            announce("Code not recognized");
            setScanResult({
              type: "not_found",
              title: "Code Not Recognized",
              message:
                barcodeError || "This code was not found in your workspace.",
            });
            finalizeScan();
            return;
          }

          codeId = barcodeData.barcode.id;
          codeOrgId = barcodeData.barcode.organizationId;
          asset = barcodeData.barcode.asset;
          kit = barcodeData.barcode.kit ?? null;
          kitId = barcodeData.barcode.kitId ?? null;
        }

        // ── Shared processing (QR and barcode paths converge here) ──

        // Cross-org check
        if (currentOrg && codeOrgId && codeOrgId !== currentOrg.id) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setScanResult({
            type: "error",
            title: "Different Workspace",
            message:
              "This asset belongs to a different workspace. Switch workspaces to view it.",
          });
          finalizeScan();
          return;
        }

        // ── KIT-LINKED code (full kit object resolved) ──
        if (!asset && kit) {
          // BOOKING CHECK-IN: a kit QR expands to the kit's member assets
          // that are in THIS booking and not yet checked in — mirroring the
          // web partial-check-in drawer (kits are never checked in as a
          // unit; partially-in-booking kits are allowed).
          if (isBookingMode && !isBookingAddMode) {
            if (!bookingCtx) {
              // Context fetch still in flight (sub-second) — ask for a rescan
              // rather than guessing membership.
              fetchBookingCtx(); // self-heal if the initial fetch failed
              flashFrame("error");
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning
              );
              setScanResult({
                type: "error",
                title: "Booking Still Loading",
                message: "One moment — scan the kit again.",
              });
              finalizeScan();
              return;
            }

            const members = bookingCtx.bookedAssets.filter(
              (a) => a.kitId === kit!.id
            );
            if (members.length === 0) {
              flashFrame("error");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              setScanResult({
                type: "error",
                title: "Not in This Booking",
                message: `None of "${kit.name}"'s assets are part of this booking.`,
              });
              finalizeScan();
              return;
            }

            // Only assets currently checked out for this booking are eligible
            // to check in — mirror the single-asset gate (line ~933). A kit
            // member that was never checked out (e.g. skipped during a
            // progressive check-out) would otherwise be submitted and
            // 400-rejected by partialCheckinBooking's progressive-checkout
            // guard, failing the entire batch including its checked-out peers.
            const checkedOutMembers = members.filter(
              (a) => a.status === "CHECKED_OUT"
            );
            const eligible = checkedOutMembers.filter(
              (a) =>
                !bookingCtx.checkedInAssetIds.has(a.id) &&
                !bookingCheckinItems.some((item) => item.targetId === a.id)
            );
            if (eligible.length === 0) {
              // Distinguish "none are checked out" from "all already covered".
              const reason =
                checkedOutMembers.length === 0
                  ? {
                      title: "Not Checked Out",
                      message: `None of "${kit.name}"'s assets in this booking are checked out.`,
                    }
                  : {
                      title: "Already Covered",
                      message: `All of "${kit.name}"'s checked-out assets are already checked in or scanned.`,
                    };
              flashFrame("error");
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning
              );
              setScanResult({ type: "error", ...reason });
              finalizeScan();
              return;
            }

            const kitMemberItems: ScannedItem[] = eligible.map((a) => ({
              type: "asset",
              qrId: `${codeId}:${a.id}`,
              targetId: a.id,
              title: a.title,
              status: a.status,
              mainImage: a.mainImage,
              category: a.category?.name ?? null,
              kitId: a.kitId,
            }));

            setBookingCheckinItems((prev) => [...kitMemberItems, ...prev]);
            flashFrame("success");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            setScanResult({
              type: "success",
              title: kit.name,
              message: `Added ${eligible.length} kit asset${
                eligible.length === 1 ? "" : "s"
              } (${bookingCheckinItems.length + eligible.length} items)`,
            });

            setTimeout(() => setScanResult(null), 1200);
            finalizeScan();
            return;
          }

          // BOOKING-ADD mode: dedupe by kit id, add to the booking list
          if (isBookingAddMode) {
            if (
              bookingCheckinItems.some(
                (item) => item.type === "kit" && item.targetId === kit!.id
              )
            ) {
              flashFrame("error");
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Warning
              );
              setScanResult({
                type: "error",
                title: "Already Scanned",
                message: "This kit is already in your list.",
              });
              finalizeScan();
              return;
            }

            const kitItem: ScannedItem = {
              type: "kit",
              qrId: codeId,
              targetId: kit.id,
              title: kit.name,
              status: kit.status,
              mainImage: kit.image,
              category: null,
              kitId: null,
              assetCount: kit._count.assets,
              hasAssetsInCustody: kit.assets.some(
                (a) => a.status === "IN_CUSTODY"
              ),
              hasUnavailableAssets: kit.assets.some((a) => !a.availableToBook),
            };

            setBookingCheckinItems((prev) => [kitItem, ...prev]);
            flashFrame("success");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            setScanResult({
              type: "success",
              title: kit.name,
              message: `Added to list (${
                bookingCheckinItems.length + 1
              } items)`,
            });

            setTimeout(() => setScanResult(null), 1200);
            finalizeScan();
            return;
          }

          if (action === "view") {
            flashFrame("success");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            announce("Kit scanned successfully");
            setScanResult({
              type: "success",
              title: kit.name,
              message: `Kit • ${kit._count.assets} asset${
                kit._count.assets === 1 ? "" : "s"
              }`,
            });

            const kitDetailId = kit.id;
            setTimeout(() => {
              // Cross-surface nav must go through pushIntoTab so the Assets
              // stack (which hosts the kits screens) is rooted and "back"
              // works.
              pushIntoTab(
                "/(tabs)/assets",
                `/(tabs)/assets/kits/${kitDetailId}`
              );
              setScanResult(null);
              finalizeScan();
            }, 950);
            return;
          }

          // BATCH mode: dedupe by kit id, then add to the list
          if (
            scannedItems.some(
              (item) => item.type === "kit" && item.targetId === kit!.id
            )
          ) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: "This kit is already in your scan list.",
            });
            finalizeScan();
            return;
          }

          const newKitItem: ScannedItem = {
            type: "kit",
            qrId: codeId,
            targetId: kit.id,
            title: kit.name,
            status: kit.status,
            mainImage: kit.image,
            category: null,
            kitId: null,
            assetCount: kit._count.assets,
            hasAssetsInCustody: kit.assets.some(
              (a) => a.status === "IN_CUSTODY"
            ),
          };

          setScannedItems((prev) => [newKitItem, ...prev]);
          flashFrame("success");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          playScanSound();
          setScanResult({
            type: "success",
            title: kit.name,
            message: `Added to list (${scannedItems.length + 1} items)`,
          });

          setTimeout(() => setScanResult(null), 1200);
          finalizeScan();
          return;
        }

        if (!asset) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

          // For Shelf QR codes, offer a path to link the QR to a new asset:
          // - If claimed to current org → navigate to in-app asset creation
          // - If unclaimed → bridge to web for the claim+link flow
          // Barcodes don't have an external link flow, so no action for those
          let unlinkedQrAction:
            | {
                label: string;
                icon: string;
                onPress: () => void;
              }
            | undefined;

          const canCreateAsset = userHasPermission({
            roles: currentOrg?.roles,
            entity: "asset",
            action: "create",
          });

          // A QR linked to a kit (kitId set, asset null) must NOT offer in-app
          // "Create Asset". createAsset only attaches a passed QR when both its
          // assetId AND kitId are null; for a kit-linked QR it silently mints a
          // *different* QR and leaves the scanned kit QR untouched — breaking the
          // "this QR will be linked" promise. Bridge those to the web kit view.
          const isKitLinked = Boolean(kitId);

          if (qrId && isKitLinked) {
            // QR belongs to a kit — open the web app to view the kit
            unlinkedQrAction = {
              label: "Open in Browser",
              icon: "open-outline",
              onPress: () => {
                void openShelfWebUrl(`https://app.shelf.nu/qr/${qrId}`);
                dismissResult();
              },
            };
          } else if (qrId && codeOrgId === currentOrg?.id && canCreateAsset) {
            // QR is claimed to current org, truly unlinked, and user can create — create in-app
            unlinkedQrAction = {
              label: "Create Asset",
              icon: "add-circle-outline",
              onPress: () => {
                pushIntoTab("/(tabs)/assets", {
                  pathname: "/(tabs)/assets/new",
                  params: { qrId },
                });
                dismissResult();
              },
            };
          } else if (qrId) {
            // QR is unclaimed — bridge to web for claim flow
            unlinkedQrAction = {
              label: "Link in Browser",
              icon: "open-outline",
              onPress: () => {
                void openShelfWebUrl(`https://app.shelf.nu/qr/${qrId}`);
                dismissResult();
              },
            };
          }

          setScanResult({
            type: "not_found",
            title: isKitLinked ? "Linked to a Kit" : "No Asset Linked",
            message: qrId
              ? isKitLinked
                ? "This QR code is linked to a kit, not an asset. Open the web app to view the kit."
                : codeOrgId === currentOrg?.id && canCreateAsset
                ? "This QR code is not linked to any asset. Create one now."
                : "This QR code is not linked to any asset. Open the web app to link it."
              : "This code exists but is not linked to any asset.",
            action: unlinkedQrAction,
          });
          finalizeScan();
          return;
        }

        // ── BOOKING modes (check-in / scan-to-add) ──
        if (isBookingMode) {
          // Check duplicate
          if (bookingCheckinItems.some((item) => item.targetId === asset.id)) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: isBookingAddMode
                ? "This asset is already in your list."
                : "This asset is already in your check-in list.",
            });
            finalizeScan();
            return;
          }

          const newItem: ScannedItem = {
            type: "asset",
            qrId: codeId,
            targetId: asset.id,
            title: asset.title,
            status: asset.status,
            mainImage: asset.mainImage,
            category: asset.category?.name || null,
            kitId: asset.kitId ?? null,
            availableToBook: asset.availableToBook,
            assetModelId: asset.assetModelId ?? null,
          };

          // ADD mode: no scan-time eligibility gate — the blockers handle
          // ineligible items with one-tap fixes (web parity).
          if (isBookingAddMode) {
            setBookingCheckinItems((prev) => [newItem, ...prev]);
            flashFrame("success");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            setScanResult({
              type: "success",
              title: asset.title,
              message: `Added to list (${
                bookingCheckinItems.length + 1
              } items)`,
            });

            setTimeout(() => setScanResult(null), 1200);
            finalizeScan();
            return;
          }

          // CHECK-IN mode scan-time gates (web parity — the web drawer
          // surfaces these as blockers; mobile rejects at scan time for
          // instant feedback). Membership can't be judged before the
          // booking context arrives, so scans during that window are
          // rejected with a retry prompt — falling through to the status
          // gate would accept assets from OTHER bookings (they are
          // CHECKED_OUT too). The e2e caught exactly that race.
          if (!bookingCtx) {
            fetchBookingCtx(); // self-heal if the initial fetch failed
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Booking Still Loading",
              message: "One moment — scan again.",
            });
            finalizeScan();
            return;
          }

          if (!bookingCtx.bookedAssetIds.has(asset.id)) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setScanResult({
              type: "error",
              title: "Not in This Booking",
              message: `"${asset.title}" is not part of this booking.`,
            });
            finalizeScan();
            return;
          }

          if (bookingCtx.checkedInAssetIds.has(asset.id)) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Checked In",
              message: `"${asset.title}" has already been checked in for this booking.`,
            });
            finalizeScan();
            return;
          }

          if (asset.status !== "CHECKED_OUT") {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setScanResult({
              type: "error",
              title: "Not Checked Out",
              message: `"${asset.title}" is ${asset.status
                .replace(/_/g, " ")
                .toLowerCase()}, not checked out.`,
            });
            finalizeScan();
            return;
          }

          setBookingCheckinItems((prev) => [newItem, ...prev]);
          flashFrame("success");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          playScanSound();
          setScanResult({
            type: "success",
            title: asset.title,
            message: `Added to check-in (${
              bookingCheckinItems.length + 1
            } items)`,
          });

          setTimeout(() => setScanResult(null), 1200);
          finalizeScan();
          return;
        }

        // ── VIEW mode: navigate to detail ──
        if (action === "view") {
          const statusLabel =
            asset.status === "IN_CUSTODY"
              ? "In Custody"
              : asset.status === "AVAILABLE"
              ? "Available"
              : asset.status.replace(/_/g, " ");

          flashFrame("success");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          playScanSound();
          announce("Code scanned successfully");
          setScanResult({
            type: "success",
            title: asset.title,
            message: `${asset.category?.name || "Asset"} \u2022 ${statusLabel}`,
          });

          setTimeout(() => {
            // Cross-surface nav must go through pushIntoTab so the Assets
            // tab is rooted at its list and "back" works (see navigation.ts).
            pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${asset.id}`);
            setScanResult(null);
            finalizeScan();
          }, 950);
          return;
        }

        // ── BATCH mode: add to list ──
        if (
          scannedItems.some(
            (item) => item.type === "asset" && item.targetId === asset!.id
          )
        ) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setScanResult({
            type: "error",
            title: "Already Scanned",
            message: "This asset is already in your scan list.",
          });
          finalizeScan();
          return;
        }

        const newItem: ScannedItem = {
          type: "asset",
          qrId: codeId,
          targetId: asset.id,
          title: asset.title,
          status: asset.status,
          mainImage: asset.mainImage,
          category: asset.category?.name || null,
          kitId: asset.kitId ?? null,
        };

        setScannedItems((prev) => [newItem, ...prev]);
        flashFrame("success");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        playScanSound();
        setScanResult({
          type: "success",
          title: asset.title,
          message: `Added to list (${scannedItems.length + 1} items)`,
        });

        setTimeout(() => {
          setScanResult(null);
        }, 1200);

        finalizeScan();
      } catch (err) {
        if (__DEV__) console.error("[Scanner] Error:", err);
        flashFrame("error");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setScanResult({
          type: "error",
          title: "Error",
          message: "Something went wrong while scanning.",
        });
        finalizeScan();
      }
    },
    // why: finalizeScan, isProcessingRef, lastScanRef, setIsProcessing, setScanResult,
    // and shouldSkipScan are stable across renders (refs and setState identities) or
    // would cause render storms if listed; intentionally excluded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      router,
      action,
      currentOrg,
      scannedItems,
      isBookingMode,
      bookingCheckinItems,
      bookingCtx,
      fetchBookingCtx,
      flashFrame,
      resetInactivityTimer,
    ]
  );

  // ── Batch Actions ──────────────────────────────────

  const removeItem = (qrId: string) => {
    setScannedItems((prev) => prev.filter((i) => i.qrId !== qrId));
  };

  const clearAll = () => {
    setScannedItems([]);
    lastScanRef.current = "";
  };

  /** Split the scan list into asset and kit id arrays for the fan-out calls. */
  const splitScannedIds = () => ({
    assetIds: scannedItems
      .filter((i) => i.type === "asset")
      .map((i) => i.targetId),
    kitIds: scannedItems.filter((i) => i.type === "kit").map((i) => i.targetId),
  });

  /** Human label for the current batch: `"Tripod"` / `3 assets and 2 kits`. */
  const batchLabel = () => {
    if (scannedItems.length === 1) return `"${scannedItems[0].title}"`;
    const assetCount = scannedItems.filter((i) => i.type === "asset").length;
    const kitCount = scannedItems.length - assetCount;
    const parts: string[] = [];
    if (assetCount > 0)
      parts.push(`${assetCount} asset${assetCount > 1 ? "s" : ""}`);
    if (kitCount > 0) parts.push(`${kitCount} kit${kitCount > 1 ? "s" : ""}`);
    return parts.join(" and ");
  };

  const handleBatchSubmit = () => {
    // The drawer disables submit while blockers exist; this guard is
    // belt-and-braces so a clean list is an invariant of every perform* call.
    if (scannedItems.length === 0 || blockers.length > 0) return;

    if (action === "assign_custody") {
      if (isSelfService) {
        // Self-service: no picker — resolve own team-member record and assign.
        void assignCustodyToSelf();
      } else {
        setShowCustodyPicker(true);
      }
    } else if (action === "release_custody") {
      // Blockers guarantee every item in the list is IN_CUSTODY here.
      Alert.alert("Release Custody", `Release custody of ${batchLabel()}?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Release",
          style: "destructive",
          onPress: () => performBulkRelease(),
        },
      ]);
    } else if (action === "update_location") {
      setShowLocationPicker(true);
    }
  };

  /**
   * Self-service custody assignment: the mobile team-members endpoint returns
   * only the caller's own record for SELF_SERVICE roles, so resolve it and go
   * straight to the confirm dialog — no picker.
   */
  const assignCustodyToSelf = async () => {
    if (!currentOrg) return;
    setIsSubmitting(true);
    const { data, error } = await api.teamMembers(currentOrg.id);
    setIsSubmitting(false);

    const selfMember = data?.teamMembers?.[0];
    if (error || !selfMember) {
      Alert.alert(
        "Error",
        error || "Could not find your team member record for this workspace."
      );
      return;
    }
    performBulkAssign(selfMember);
  };

  const performBulkAssign = async (member: TeamMember) => {
    setShowCustodyPicker(false);
    if (!currentOrg) return;

    const displayName = member.user
      ? [member.user.firstName, member.user.lastName]
          .filter(Boolean)
          .join(" ") || member.name
      : member.name;

    const confirmLabel = batchLabel();
    Alert.alert("Assign Custody", `Assign ${confirmLabel} to ${displayName}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Assign",
        onPress: async () => {
          setIsSubmitting(true);
          // Fan out per entity type — assets and kits have separate bulk
          // endpoints wrapping their respective services (web parity).
          const { assetIds, kitIds } = splitScannedIds();
          const [assetResult, kitResult] = await Promise.all([
            assetIds.length > 0
              ? api.bulkAssignCustody(currentOrg.id, assetIds, member.id)
              : Promise.resolve({ data: null, error: null }),
            kitIds.length > 0
              ? api.bulkAssignKitCustody(currentOrg.id, kitIds, member.id)
              : Promise.resolve({ error: null }),
          ]);
          setIsSubmitting(false);

          const error = assetResult.error || kitResult.error;
          if (error) {
            Alert.alert("Error", error);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            // Honest partial success: mixed batches skip QUANTITY_TRACKED
            // assets server-side (their custody is per-unit), so say both
            // numbers instead of implying everything was assigned. Absent
            // field (older server) or all-INDIVIDUAL batches read 0 and the
            // alert body is unchanged. All-QT batches error out server-side
            // and never reach this branch.
            const skipped = assetResult.data?.skippedQuantityTracked ?? 0;
            const skippedNote =
              skipped > 0
                ? `\n\n${skipped} quantity-tracked asset${
                    skipped === 1 ? "" : "s"
                  } skipped. Assign quantities from the asset's detail screen.`
                : "";
            Alert.alert(
              "Done",
              `Assigned ${confirmLabel} to ${displayName}.${skippedNote}`
            );
            setScannedItems([]);
            lastScanRef.current = "";
          }
        },
      },
    ]);
  };

  const performBulkRelease = async () => {
    if (!currentOrg) return;
    const releasedLabel = batchLabel();
    setIsSubmitting(true);
    const { assetIds, kitIds } = splitScannedIds();
    const [assetResult, kitResult] = await Promise.all([
      assetIds.length > 0
        ? api.bulkReleaseCustody(currentOrg.id, assetIds)
        : Promise.resolve({ data: null, error: null }),
      kitIds.length > 0
        ? api.bulkReleaseKitCustody(currentOrg.id, kitIds)
        : Promise.resolve({ error: null }),
    ]);
    setIsSubmitting(false);

    const error = assetResult.error || kitResult.error;
    if (error) {
      Alert.alert("Error", error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playScanSound();
      // Honest partial success — mirrors performBulkAssign: the server skips
      // QUANTITY_TRACKED assets in mixed batches and reports the count.
      const skipped = assetResult.data?.skippedQuantityTracked ?? 0;
      const skippedNote =
        skipped > 0
          ? `\n\n${skipped} quantity-tracked asset${
              skipped === 1 ? "" : "s"
            } skipped. Release quantities from the asset's detail screen.`
          : "";
      Alert.alert(
        "Done",
        `Released custody of ${releasedLabel}.${skippedNote}`
      );
      setScannedItems([]);
      lastScanRef.current = "";
    }
  };

  const performBulkUpdateLocation = async (location: LocationType) => {
    setShowLocationPicker(false);
    if (!currentOrg) return;

    const moveLabel = batchLabel();
    Alert.alert("Update Location", `Move ${moveLabel} to ${location.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Move",
        onPress: async () => {
          setIsSubmitting(true);
          const { assetIds, kitIds } = splitScannedIds();
          const [assetResult, kitResult] = await Promise.all([
            assetIds.length > 0
              ? api.bulkUpdateLocation(currentOrg.id, assetIds, location.id)
              : Promise.resolve({ error: null }),
            kitIds.length > 0
              ? api.bulkUpdateKitLocation(currentOrg.id, kitIds, location.id)
              : Promise.resolve({ error: null }),
          ]);
          setIsSubmitting(false);

          const error = assetResult.error || kitResult.error;
          if (error) {
            Alert.alert("Error", error);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            Alert.alert("Done", `Moved ${moveLabel} to ${location.name}.`);
            setScannedItems([]);
            lastScanRef.current = "";
          }
        },
      },
    ]);
  };

  // ── Booking Check-in Actions ────────────────────────

  const removeBookingItem = (targetId: string) => {
    setBookingCheckinItems((prev) =>
      prev.filter((i) => i.targetId !== targetId)
    );
  };

  const clearBookingItems = () => {
    setBookingCheckinItems([]);
    lastScanRef.current = "";
  };

  /** Submit the scan-to-add list: assets + kits join the booking. */
  const handleBookingAdd = () => {
    if (
      !bookingId ||
      !currentOrg ||
      bookingCheckinItems.length === 0 ||
      // Block submit until the booking context has loaded — until then
      // bookingBlockers is empty (not "no blockers"), so a submit here would
      // bypass the not-bookable / part-of-kit / already-in-booking checks.
      !bookingCtx ||
      bookingBlockers.length > 0
    ) {
      return;
    }

    const assetIds = bookingCheckinItems
      .filter((i) => i.type === "asset")
      .map((i) => i.targetId);
    const kitIds = bookingCheckinItems
      .filter((i) => i.type === "kit")
      .map((i) => i.targetId);
    const count = bookingCheckinItems.length;

    Alert.alert(
      "Add to Booking",
      `Add ${count} item${count === 1 ? "" : "s"} to "${
        bookingName || "this booking"
      }"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: async () => {
            setIsBookingSubmitting(true);
            const { error } = await api.addScannedToBooking(
              currentOrg.id,
              bookingId,
              assetIds,
              kitIds
            );
            setIsBookingSubmitting(false);

            if (error) {
              Alert.alert("Error", error);
              return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            Alert.alert(
              "Done",
              `Added ${count} item${count === 1 ? "" : "s"} to "${
                bookingName || "the booking"
              }".`,
              [
                {
                  text: "OK",
                  onPress: () => {
                    setBookingCheckinItems([]);
                    lastScanRef.current = "";
                    // Navigate explicitly (anchored) — router.back() from a
                    // tab screen falls through history and can land on Home.
                    // The dirty flag forces the detail to refetch past its
                    // 60s freshness gate (router params don't reach an
                    // already-mounted screen, so a ?refresh token can't).
                    markBookingDirty(bookingId);
                    // Defer past the alert dismissal: navigating
                    // synchronously from an Alert onPress wedges the
                    // navigation transition into an endless render-commit
                    // loop (JS thread pegged at ~125% CPU, network
                    // callbacks starve) — verified by process sampling.
                    InteractionManager.runAfterInteractions(() => {
                      pushIntoTab(
                        "/(tabs)/bookings",
                        `/(tabs)/bookings/${bookingId}`
                      );
                    });
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  /**
   * Submit the fulfil-and-check-out list: the scanned assets are matched
   * against the booking's outstanding model reservations (materialising them)
   * AND the booking is checked out (RESERVED -> ONGOING) in one atomic call.
   * Mirrors the web `fulfil-and-checkout` scanner. The server rejects the
   * submit if any reservation is still unassigned, so the operator gets a clear
   * "still N to assign" error rather than a silent partial checkout.
   */
  const handleBookingFulfil = async () => {
    if (
      !bookingId ||
      !currentOrg ||
      bookingCheckinItems.length === 0 ||
      // Same guard as add: don't submit before the booking context has loaded
      // (blockers are empty until then, which would bypass the eligibility
      // checks) or while any blocker is unresolved.
      !bookingCtx ||
      bookingBlockers.length > 0
    ) {
      return;
    }

    /**
     * Refuse locally what the server would refuse anyway. Without this the
     * operator taps a confident-looking CTA and only then learns their scans
     * don't cover the reservation — the exact round trip this whole change
     * exists to remove.
     */
    /**
     * Refuse locally what the server would refuse anyway — but only after
     * confirming against fresh data.
     *
     * `fulfilMatch` is computed from the booking context captured when this
     * screen opened. If someone else fulfilled or shrank a reservation in the
     * meantime, that snapshot is stale and a purely local block would strand
     * the operator on a booking the server would happily check out. So on a
     * local miss, re-read the booking and re-run the SAME matcher; only refuse
     * if it is still short.
     */
    if (!fulfilMatch.isComplete) {
      setIsBookingSubmitting(true);
      const { data: fresh } = await api.booking(bookingId, currentOrg.id);
      setIsBookingSubmitting(false);

      const freshOutstanding = (fresh?.booking.modelRequests ?? [])
        .filter((r) => r.fulfilledAt === null && r.outstandingQuantity > 0)
        .map((r) => ({
          assetModelId: r.assetModelId,
          outstandingQuantity: r.outstandingQuantity,
        }));
      const revalidated = matchScansToReservations(
        bookingCheckinItems,
        freshOutstanding,
        fresh?.booking.outstandingModelUnitCount ?? fulfilMatch.required
      );

      if (!revalidated.isComplete) {
        const short = revalidated.required - revalidated.matched;
        Alert.alert(
          "Not ready to check out",
          `${short} more reserved unit${
            short === 1 ? "" : "s"
          } still to assign. Scan units matching the reserved models — items that don't match a reservation don't count towards it.`
        );
        // Refresh the on-screen counter so it reflects what we just read.
        fetchBookingCtx();
        return;
      }
      // Reservations were satisfied server-side while we were open; fall
      // through and let the submit proceed.
      fetchBookingCtx();
    }

    const assetIds = bookingCheckinItems
      .filter((i) => i.type === "asset")
      .map((i) => i.targetId);
    const kitIds = bookingCheckinItems
      .filter((i) => i.type === "kit")
      .map((i) => i.targetId);
    const count = bookingCheckinItems.length;

    Alert.alert(
      "Assign & check out",
      `Assign ${count} scanned unit${count === 1 ? "" : "s"} and check out "${
        bookingName || "this booking"
      }"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check out",
          onPress: async () => {
            setIsBookingSubmitting(true);
            const timeZone = (() => {
              try {
                return (
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                );
              } catch {
                return "UTC";
              }
            })();

            const { error } = await api.fulfilAndCheckoutBooking(
              currentOrg.id,
              bookingId,
              assetIds,
              kitIds,
              timeZone
            );
            setIsBookingSubmitting(false);

            if (error) {
              Alert.alert("Couldn't check out", error);
              return;
            }

            // Booking is now ONGOING — schedule its due-back reminders.
            // Interactive: this is a direct user action, so the OS
            // permission prompt may show here (first checkout only).
            void syncBookingReminders(bookingId, currentOrg.id, {
              interactive: true,
            });

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            Alert.alert(
              "Checked out",
              `Assigned ${count} unit${
                count === 1 ? "" : "s"
              } and checked out "${bookingName || "the booking"}".`,
              [
                {
                  text: "OK",
                  onPress: () => {
                    setBookingCheckinItems([]);
                    lastScanRef.current = "";
                    markBookingDirty(bookingId);
                    InteractionManager.runAfterInteractions(() => {
                      pushIntoTab(
                        "/(tabs)/bookings",
                        `/(tabs)/bookings/${bookingId}`
                      );
                    });
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  /**
   * Fulfil-mode progress, computed against the RESERVATIONS rather than by
   * counting scans.
   *
   * The previous version divided `bookingCheckinItems.length` by the reserved
   * unit count, which lied in both directions: scanning a camera against a
   * "Tablecloth x2" reservation read "1/2 scanned" (it fulfils nothing), and
   * scanning three tablecloths against x2 read "3/2". The server refuses both
   * at submit, so the operator only discovered it at the very end.
   *
   * Each scanned asset is now matched to an outstanding request for its model
   * and capped at that model's outstanding quantity, so extra units of a model
   * that is already satisfied count as unmatched — exactly how the server
   * treats them (`materializeModelRequestForAsset` returns `matched: false`
   * once `fulfilledQuantity >= quantity`).
   */
  const fulfilMatch = useMemo(
    () =>
      matchScansToReservations(
        bookingCheckinItems,
        bookingCtx?.outstandingModelRequests ?? [],
        bookingCtx?.outstandingModelUnitCount ?? 0
      ),
    [bookingCheckinItems, bookingCtx]
  );

  const handleBookingCheckin = () => {
    if (!bookingId || !currentOrg || bookingCheckinItems.length === 0) return;

    const count = bookingCheckinItems.length;
    Alert.alert(
      "Check In Assets",
      `Check in ${count} ${count === 1 ? "asset" : "assets"} for "${
        bookingName || "this booking"
      }"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check In",
          onPress: async () => {
            setIsBookingSubmitting(true);
            const assetIds = bookingCheckinItems.map((i) => i.targetId);
            const timeZone = (() => {
              try {
                return (
                  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
                );
              } catch {
                return "UTC";
              }
            })();

            const { data: result, error } = await api.partialCheckinBooking(
              currentOrg.id,
              bookingId,
              assetIds,
              timeZone
            );
            setIsBookingSubmitting(false);

            if (error) {
              Alert.alert("Error", error);
              return;
            }

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            // Keep the scan-time gates honest for follow-up scans: the
            // assets just submitted are now checked in, but the fetched
            // context predates the submit.
            setBookingCtx((prev) =>
              prev
                ? {
                    ...prev,
                    checkedInAssetIds: new Set([
                      ...prev.checkedInAssetIds,
                      ...assetIds,
                    ]),
                  }
                : prev
            );
            // Fully returned → the booking left ONGOING; drop its due-back
            // reminders immediately (no fetch — we know it closed here).
            // Partial check-ins keep them: gear is still out.
            if (result?.isComplete) {
              void cancelBookingReminders(bookingId);
            }
            const msg = result?.isComplete
              ? `All assets checked in! "${
                  bookingName || "Booking"
                }" is now complete.`
              : `${
                  result?.checkedInCount ?? bookingCheckinItems.length
                } checked in, ${result?.remainingCount ?? "some"} remaining.`;
            Alert.alert("Checked In", msg, [
              {
                text: "OK",
                onPress: () => {
                  setBookingCheckinItems([]);
                  lastScanRef.current = "";
                  // The check-in mutated the booking — flag the detail to
                  // refetch past its freshness gate on next focus.
                  markBookingDirty(bookingId);
                  if (result?.isComplete) {
                    // Anchored navigation — router.back() from a tab screen
                    // falls through history and can land on Home. Deferred
                    // past the alert dismissal (same render-loop wedge as
                    // the add path — see handleBookingAdd).
                    InteractionManager.runAfterInteractions(() => {
                      pushIntoTab(
                        "/(tabs)/bookings",
                        `/(tabs)/bookings/${bookingId}`
                      );
                    });
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  };

  // ── Permission states ───────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.muted} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Ionicons name="camera-outline" size={64} color={colors.mutedLight} />
        <Text style={styles.messageTitle}>Camera Access Needed</Text>
        <Text style={styles.messageBody}>
          Shelf needs camera access to scan QR codes and barcodes on your
          assets.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={requestPermission}
          >
            <Text style={styles.actionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => {
              if (Platform.OS === "ios") {
                Linking.openURL("app-settings:");
              } else {
                Linking.openSettings();
              }
            }}
          >
            <Text style={styles.actionButtonText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Camera view ──────────────────────────────────────

  const showBatchDrawer =
    !isBookingMode && isBatchAction(action) && scannedItems.length > 0;
  const showBookingDrawer = isBookingMode && bookingCheckinItems.length > 0;

  // Instruction text
  const instructionMap: Record<ScannerAction, string> = {
    view: "Scan to view an asset or kit",
    assign_custody: "Scan assets or kits to assign custody",
    release_custody: "Scan assets or kits to release custody",
    update_location: "Scan assets or kits to update location",
  };

  // Submit button label
  const submitLabelMap: Record<ScannerAction, string> = {
    view: "",
    // Self-service users can only take custody themselves — no picker step.
    assign_custody: isSelfService ? "Take Custody" : "Choose Custodian",
    release_custody: "Release All",
    update_location: "Choose Location",
  };

  return (
    <View style={styles.container}>
      {isFocused && !isPaused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torchEnabled}
          barcodeScannerSettings={{
            barcodeTypes: ["qr", "code128", "code39", "datamatrix", "ean13"],
          }}
          onBarcodeScanned={
            isProcessing || (scanResult && action === "view" && !isBookingMode)
              ? undefined
              : handleBarCodeScanned
          }
        />
      )}

      {/* Paused overlay (inspired by Scandit freeze-frame pattern) */}
      {isPaused && (
        <TouchableOpacity
          style={styles.pausedOverlay}
          onPress={togglePause}
          activeOpacity={0.9}
          accessibilityLabel="Camera paused. Tap to resume scanning"
          accessibilityRole="button"
        >
          <Ionicons
            name="play-circle-outline"
            size={64}
            color="rgba(255,255,255,0.8)"
          />
          <Text style={styles.pausedTitle}>Camera Paused</Text>
          <Text style={styles.pausedSubtitle}>
            Tap anywhere to resume scanning
          </Text>
        </TouchableOpacity>
      )}

      {/* Overlay with cutout */}
      <View style={styles.overlay}>
        {/* Top - Action picker or Booking header */}
        <View style={styles.overlaySection}>
          {isBookingMode ? (
            <View style={styles.actionPickerContainer}>
              <View style={styles.bookingModeHeader}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  accessibilityLabel="Go back"
                  accessibilityRole="button"
                >
                  <Ionicons name="arrow-back" size={22} color="#fff" />
                </TouchableOpacity>
                <View style={styles.bookingModeInfo}>
                  <Text style={styles.bookingModeLabel}>
                    {isBookingFulfilMode
                      ? "Fulfil & Check Out"
                      : isBookingAddMode
                      ? "Add to Booking"
                      : "Booking Check-In"}
                  </Text>
                  <Text style={styles.bookingModeName} numberOfLines={1}>
                    {bookingName || "Scan assets to check in"}
                  </Text>
                  {isBookingFulfilMode &&
                    bookingCtx &&
                    bookingCtx.outstandingModelRequests.length > 0 && (
                      <Text style={styles.bookingFulfilHint} numberOfLines={2}>
                        {`Reserved: ${bookingCtx.outstandingModelRequests
                          .map(
                            (r) =>
                              `${r.assetModelName} ×${r.outstandingQuantity}`
                          )
                          .join(", ")}  ·  ${fulfilMatch.matched}/${
                          fulfilMatch.required
                        } assigned`}
                      </Text>
                    )}
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.actionPickerContainer}>
              <ActionPills
                actions={availableActions}
                currentAction={action}
                onActionChange={handleActionChange}
              />
              <ActionPillsCoachmark
                enabled={availableActions.length > 1}
                currentAction={action}
              />
            </View>
          )}
        </View>

        {/* Middle row -- swipe gesture target */}
        <View style={styles.middleRow} {...panResponder.panHandlers}>
          <View style={styles.overlaySection} />
          <ScanFrame
            scanLineAnim={scanLineAnim}
            frameHighlight={frameHighlight}
            showScanLine={!scanResult && !isPaused}
          />
          <View style={styles.overlaySection} />
        </View>

        {/* Bottom */}
        <View
          /**
           * The overlay must NOT reflow when a drawer opens.
           *
           * This used to collapse to `flex: 0`, but only the BOTTOM section
           * did — the top kept `flex: 1`, so it absorbed the freed space and
           * pushed the header and the 240px scan frame downward. The camera is
           * a static `absoluteFill` layer underneath, so what actually moved
           * was the cutout sliding down over a still picture: it reads as "the
           * camera jumped". It also dragged the absolutely-positioned
           * manual-entry pill (anchored to this section's bottom) up onto the
           * drawer.
           *
           * The drawer is an absolutely-positioned sibling at `bottom: 0`, so
           * it never needed the overlay to make room in the first place.
           */
          style={[styles.overlaySection, styles.bottomSection]}
        >
          {/* Mode indicator dots */}
          {!isBookingMode && (
            <ModeDots actions={availableActions} currentAction={action} />
          )}

          {/* Status / instruction text -- animated for swipe transitions */}
          <Animated.View
            style={[
              styles.instructionContainer,
              {
                transform: [{ translateX: swipeTranslateX }],
                opacity: swipeOpacity,
              },
            ]}
          >
            {isProcessing && !scanResult ? (
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.instructionText}>Looking up asset...</Text>
              </View>
            ) : scanResult ? (
              <ScanResultCard result={scanResult} onDismiss={dismissResult} />
            ) : (
              <Text style={styles.instructionText}>
                {isBookingMode
                  ? isBookingFulfilMode
                    ? "Scan the reserved units to assign"
                    : isBookingAddMode
                    ? "Scan assets or kits to add"
                    : "Scan assets to check in"
                  : instructionMap[action]}
              </Text>
            )}
          </Animated.View>

          {/* Camera controls -- positioned in the thumb-friendly bottom zone */}
          <View style={styles.controlButtons}>
            {/* Pause/Resume toggle */}
            <TouchableOpacity
              style={[
                styles.controlButton,
                isPaused && styles.controlButtonActive,
              ]}
              onPress={togglePause}
              accessibilityLabel={isPaused ? "Resume camera" : "Pause camera"}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons
                name={isPaused ? "play" : "pause"}
                size={20}
                color="#fff"
              />
            </TouchableOpacity>
            {/* Flashlight toggle */}
            <TouchableOpacity
              style={[
                styles.controlButton,
                torchEnabled && styles.controlButtonActive,
              ]}
              onPress={toggleTorch}
              accessibilityLabel={
                torchEnabled ? "Turn off flashlight" : "Turn on flashlight"
              }
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Ionicons
                name={torchEnabled ? "flash" : "flash-outline"}
                size={20}
                color={torchEnabled ? "#FFD600" : "#fff"}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Manual code entry ───────────────────────────
            Type a QR id, barcode value, or SAM id when a label can't be
            scanned (damaged/missing/no camera focus). Feeds the same
            resolution pipeline as the camera. Web parity: every web scan
            surface exposes a manual code-entry Input
            (apps/webapp/app/components/scanner/code-scanner.tsx).
            NOTE: testIDs/state keep the `dev-scan`/`devScan` prefix from this
            control's origin so the existing e2e flows stay stable. */}
        {manualEntryBottom !== null && (
          <View
            style={[
              styles.devScanContainer,
              // Clamped so the lift never pushes the control into the scan
              // frame; see `manualEntryBottom`.
              { bottom: manualEntryBottom },
            ]}
          >
            {devScanVisible ? (
              <View style={styles.devScanRow}>
                <TextInput
                  testID="dev-scan-input"
                  style={styles.devScanInput}
                  value={devScanInput}
                  onChangeText={setDevScanInput}
                  placeholder="Enter QR, barcode, or SAM ID"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => {
                    if (devScanInput.trim()) {
                      handleBarCodeScanned({ data: devScanInput.trim() });
                      setDevScanInput("");
                    }
                  }}
                />
                <TouchableOpacity
                  testID="dev-scan-submit"
                  style={styles.devScanButton}
                  onPress={() => {
                    if (devScanInput.trim()) {
                      handleBarCodeScanned({ data: devScanInput.trim() });
                      setDevScanInput("");
                    }
                  }}
                  accessibilityLabel="Look up code"
                >
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.devScanClose}
                  onPress={() => setDevScanVisible(false)}
                  accessibilityLabel="Close manual entry"
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                testID="dev-scan-toggle"
                style={styles.devScanToggle}
                onPress={() => setDevScanVisible(true)}
                accessibilityLabel="Enter a code manually"
              >
                <Ionicons name="keypad-outline" size={14} color="#fff" />
                <Text style={styles.devScanToggleText}>Enter code</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* ── Drawers ─────────────────────────────────────
          Hosted OUTSIDE the overlay view as a sibling ABOVE the paused
          overlay: RN zIndex only competes between siblings, so nesting the
          drawer inside the overlay left its buttons dead whenever the
          camera auto-paused (the paused layer won the hit test). */}
      {(showBatchDrawer || showBookingDrawer) && (
        <View
          style={styles.drawerHost}
          pointerEvents="box-none"
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            // Guard the setState: onLayout re-fires on every relayout, and an
            // unconditional set would loop.
            setDrawerHeight((prev) => (prev === h ? prev : h));
          }}
        >
          {/* ── Batch Drawer ──────────────────────────── */}
          {showBatchDrawer && (
            <BatchDrawer
              items={scannedItems}
              keyField="qrId"
              title={`${scannedItems.length} item${
                scannedItems.length > 1 ? "s" : ""
              } scanned`}
              submitLabel={submitLabelMap[action]}
              submitIcon={
                SCANNER_ACTIONS.find((a) => a.key === action)?.icon ||
                "checkmark"
              }
              isSubmitting={isSubmitting}
              onRemove={removeItem}
              onClear={clearAll}
              onSubmit={handleBatchSubmit}
              showStatus
              blockers={blockers}
              onResolveBlocker={resolveBlocker}
              onResolveAllBlockers={resolveAllBlockers}
            />
          )}

          {/* ── Booking Drawer (check-in / scan-to-add) ── */}
          {showBookingDrawer && (
            <BatchDrawer
              items={bookingCheckinItems}
              keyField="targetId"
              title={
                isBookingAddMode
                  ? `${bookingCheckinItems.length} unit${
                      bookingCheckinItems.length > 1 ? "s" : ""
                    } scanned`
                  : `${bookingCheckinItems.length} asset${
                      bookingCheckinItems.length > 1 ? "s" : ""
                    } to check in`
              }
              submitLabel={
                isBookingFulfilMode
                  ? fulfilMatch.isComplete
                    ? // Count every scanned item, not just the matched ones:
                      // the submit sends the whole list and the service adds
                      // unmatched assets directly and checks them out too, so
                      // labelling only `matched` would understate the action.
                      `Assign & check out ${bookingCheckinItems.length} unit${
                        bookingCheckinItems.length === 1 ? "" : "s"
                      }`
                    : `${
                        fulfilMatch.required - fulfilMatch.matched
                      } more to assign`
                  : isBookingAddMode
                  ? "Add to Booking"
                  : `Check In ${bookingCheckinItems.length} ${
                      bookingCheckinItems.length === 1 ? "Asset" : "Assets"
                    }`
              }
              submitIcon={
                isBookingFulfilMode
                  ? "log-out-outline"
                  : isBookingAddMode
                  ? "add-circle-outline"
                  : "log-in-outline"
              }
              isSubmitting={isBookingSubmitting}
              onRemove={removeBookingItem}
              onClear={clearBookingItems}
              onSubmit={
                isBookingFulfilMode
                  ? handleBookingFulfil
                  : isBookingAddMode
                  ? handleBookingAdd
                  : handleBookingCheckin
              }
              showStatus={isBookingAddMode}
              blockers={isBookingAddMode ? bookingBlockers : []}
              onResolveBlocker={resolveBookingBlocker}
              onResolveAllBlockers={resolveAllBookingBlockers}
            />
          )}
        </View>
      )}

      {/* ── Pickers (modals) ──────────────────────────── */}
      {currentOrg && (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={performBulkAssign}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            onSelect={performBulkUpdateLocation}
            onClose={() => setShowLocationPicker(false)}
          />
        </>
      )}
    </View>
  );
}

// ── Default export wraps with error boundary ─────────────

export default function ScannerScreen() {
  return (
    <ScannerErrorBoundary label="Scanner">
      <ScannerContent />
    </ScannerErrorBoundary>
  );
}

// ── Styles ────────────────────────────────────────────────

const FRAME_SIZE = 240;

const useStyles = createStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  messageTitle: {
    fontSize: fontSize.xxl,
    fontWeight: "700",
    color: colors.foreground,
    textAlign: "center",
  },
  messageBody: {
    fontSize: fontSize.lg,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
  },
  actionButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  actionButtonText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.xl,
  },

  // Hosts the drawers as a sibling ABOVE the paused overlay (zIndex 5) so
  // their buttons stay tappable while the camera is auto-paused.
  drawerHost: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  // Paused overlay
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    // why: no zIndex — the action pills / batch drawer (later siblings) must
    // win hit-testing, otherwise this full-screen touchable swallows the
    // first tap aimed at them while paused. It still covers the camera area.
  },
  pausedTitle: {
    color: "#fff",
    fontSize: fontSize.xxl,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  pausedSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: fontSize.base,
  },

  // Overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  controlButtons: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  controlButtonActive: {
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  overlaySection: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  // Action picker
  actionPickerContainer: {
    position: "absolute",
    bottom: spacing.lg,
    left: 0,
    right: 0,
  },
  bookingModeHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  bookingModeInfo: {
    flex: 1,
  },
  bookingModeLabel: {
    fontSize: fontSize.xs,
    color: "rgba(255,255,255,0.6)",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bookingModeName: {
    fontSize: fontSize.lg,
    color: "#fff",
    fontWeight: "700",
  },
  bookingFulfilHint: {
    marginTop: 2,
    fontSize: fontSize.xs,
    color: "rgba(255,255,255,0.85)",
    fontWeight: "600",
  },
  middleRow: {
    flexDirection: "row",
    height: FRAME_SIZE,
  },
  bottomSection: {
    justifyContent: "flex-start",
    paddingTop: spacing.lg,
  },

  // Instructions / results
  instructionContainer: {
    alignItems: "center",
    paddingHorizontal: spacing.xxl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  instructionText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // ── Dev Scan Injection (DEV only) ───────────────
  devScanContainer: {
    position: "absolute" as const,
    bottom: 90,
    left: spacing.md,
    right: spacing.md,
    zIndex: 999,
  },
  devScanRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: borderRadius.md,
    padding: spacing.xs,
    gap: spacing.xs,
  },
  devScanInput: {
    flex: 1,
    color: "#fff",
    fontSize: fontSize.sm,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  devScanButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
  },
  devScanClose: {
    padding: spacing.xs,
  },
  devScanToggle: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "center" as const,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 4,
  },
  devScanToggleText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: fontSize.xs,
    fontWeight: "600" as const,
    letterSpacing: 0.2,
  },
}));
