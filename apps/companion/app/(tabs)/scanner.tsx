import { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
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
import { pushIntoTab } from "@/lib/navigation";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import type { TeamMember, Location as LocationType } from "@/lib/api";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { extractQrId } from "@/lib/qr-utils";
import { announce } from "@/lib/a11y";
import { playScanSound } from "@/lib/scan-sound";
import { userHasPermission } from "@/lib/permissions";
import { ScannerErrorBoundary } from "@/components/scanner-error-boundary";
import { useScanLineAnimation } from "@/hooks/use-scan-line-animation";
import { useInactivityTimer } from "@/hooks/use-inactivity-timer";
import { useScanCooldown } from "@/hooks/use-scan-cooldown";
import { useScannerGestures } from "@/hooks/use-scanner-gestures";
import { useScanProcessing } from "@/hooks/use-scan-processing";
import { ScanFrame } from "@/components/scanner/scan-frame";
import { ScanResultCard } from "@/components/scanner/scan-result-card";
import { ActionPills, ModeDots } from "@/components/scanner/action-pills";
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
  qrId: string;
  assetId: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: string | null;
};

// ── Scanner Content ─────────────────────────────────────

function ScannerContent() {
  const router = useRouter();
  const { bookingId, bookingName } = useLocalSearchParams<{
    bookingId?: string;
    bookingName?: string;
  }>();
  const isFocused = useIsFocused();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();

  // Booking check-in mode
  const isBookingMode = !!bookingId;

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

  // Action state
  const [action, setAction] = useState<ScannerAction>("view");

  // Batch state (for assign/release/location modes)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pickers
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // Booking check-in items (separate from batch scan)
  const [bookingCheckinItems, setBookingCheckinItems] = useState<ScannedItem[]>(
    []
  );
  const [isBookingSubmitting, setIsBookingSubmitting] = useState(false);

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
        let codeId: string;
        let codeOrgId: string | null;
        let asset: {
          id: string;
          title: string;
          status: string;
          mainImage: string | null;
          category: { name: string } | null;
          location: { name: string } | null;
        } | null;

        if (qrId) {
          // ── Shelf QR path ──

          // Early batch dedup by QR ID (saves a network call)
          if (
            isBatchAction(action) &&
            scannedItems.some((item) => item.qrId === qrId)
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

          const { data: qrData, error } = await api.qr(qrId);

          if (error || !qrData) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            setScanResult({
              type: "error",
              title: "Lookup Failed",
              message: error || "Could not look up this QR code.",
            });
            finalizeScan();
            return;
          }

          codeId = qrId;
          codeOrgId = qrData.qr?.organizationId ?? null;
          asset = qrData.qr?.asset ?? null;
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

        if (!asset) {
          flashFrame("error");
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setScanResult({
            type: "not_found",
            title: "No Asset Linked",
            message: "This code exists but is not linked to any asset.",
          });
          finalizeScan();
          return;
        }

        // ── BOOKING CHECK-IN mode ──
        if (isBookingMode) {
          // Check duplicate
          if (bookingCheckinItems.some((item) => item.assetId === asset.id)) {
            flashFrame("error");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setScanResult({
              type: "error",
              title: "Already Scanned",
              message: "This asset is already in your check-in list.",
            });
            finalizeScan();
            return;
          }

          const newItem: ScannedItem = {
            qrId: codeId,
            assetId: asset.id,
            title: asset.title,
            status: asset.status,
            mainImage: asset.mainImage,
            category: asset.category?.name || null,
          };

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
        if (scannedItems.some((item) => item.assetId === asset.id)) {
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
          qrId: codeId,
          assetId: asset.id,
          title: asset.title,
          status: asset.status,
          mainImage: asset.mainImage,
          category: asset.category?.name || null,
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

  const handleBatchSubmit = () => {
    if (scannedItems.length === 0) return;

    if (action === "assign_custody") {
      setShowCustodyPicker(true);
    } else if (action === "release_custody") {
      const releasable = scannedItems.filter((i) => i.status === "IN_CUSTODY");
      if (releasable.length === 0) {
        Alert.alert(
          "No Assets to Release",
          "None of the scanned assets are currently in custody."
        );
        return;
      }
      const releaseLabel =
        releasable.length === 1
          ? `"${releasable[0].title}"`
          : `${releasable.length} assets`;
      Alert.alert("Release Custody", `Release custody of ${releaseLabel}?`, [
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

  const performBulkAssign = async (member: TeamMember) => {
    setShowCustodyPicker(false);
    if (!currentOrg) return;

    const displayName = member.user
      ? [member.user.firstName, member.user.lastName]
          .filter(Boolean)
          .join(" ") || member.name
      : member.name;

    const confirmLabel =
      scannedItems.length === 1
        ? `"${scannedItems[0].title}"`
        : `${scannedItems.length} assets`;
    Alert.alert("Assign Custody", `Assign ${confirmLabel} to ${displayName}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Assign",
        onPress: async () => {
          setIsSubmitting(true);
          const assetIds = scannedItems.map((i) => i.assetId);
          const { data: result, error } = await api.bulkAssignCustody(
            currentOrg.id,
            assetIds,
            member.id
          );
          setIsSubmitting(false);

          if (error) {
            Alert.alert("Error", error);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            const assignedCount = result?.assigned ?? scannedItems.length;
            const assetLabel =
              scannedItems.length === 1
                ? `"${scannedItems[0].title}"`
                : `${assignedCount} asset${assignedCount > 1 ? "s" : ""}`;
            const msg = result?.skipped
              ? `Assigned ${assetLabel} to ${displayName}. ${result.skipped} skipped (already in custody).`
              : `Assigned ${assetLabel} to ${displayName}.`;
            Alert.alert("Done", msg);
            setScannedItems([]);
            lastScanRef.current = "";
          }
        },
      },
    ]);
  };

  const performBulkRelease = async () => {
    if (!currentOrg) return;
    setIsSubmitting(true);
    const assetIds = scannedItems.map((i) => i.assetId);
    const { data: result, error } = await api.bulkReleaseCustody(
      currentOrg.id,
      assetIds
    );
    setIsSubmitting(false);

    if (error) {
      Alert.alert("Error", error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      playScanSound();
      const releasedCount = result?.released ?? scannedItems.length;
      const assetLabel =
        scannedItems.length === 1
          ? `"${scannedItems[0].title}"`
          : `${releasedCount} asset${releasedCount > 1 ? "s" : ""}`;
      const msg = result?.skipped
        ? `Released ${assetLabel}. ${result.skipped} skipped (not in custody).`
        : `Released custody of ${assetLabel}.`;
      Alert.alert("Done", msg);
      setScannedItems([]);
      lastScanRef.current = "";
    }
  };

  const performBulkUpdateLocation = async (location: LocationType) => {
    setShowLocationPicker(false);
    if (!currentOrg) return;

    const moveLabel =
      scannedItems.length === 1
        ? `"${scannedItems[0].title}"`
        : `${scannedItems.length} assets`;
    Alert.alert("Update Location", `Move ${moveLabel} to ${location.name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Move",
        onPress: async () => {
          setIsSubmitting(true);
          const assetIds = scannedItems.map((i) => i.assetId);
          const { data: result, error } = await api.bulkUpdateLocation(
            currentOrg.id,
            assetIds,
            location.id
          );
          setIsSubmitting(false);

          if (error) {
            Alert.alert("Error", error);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            playScanSound();
            const updatedCount = result?.updated ?? scannedItems.length;
            const assetLabel =
              scannedItems.length === 1
                ? `"${scannedItems[0].title}"`
                : `${updatedCount} asset${updatedCount > 1 ? "s" : ""}`;
            const msg = result?.skipped
              ? `Moved ${assetLabel} to ${location.name}. ${result.skipped} already at this location.`
              : `Moved ${assetLabel} to ${location.name}.`;
            Alert.alert("Done", msg);
            setScannedItems([]);
            lastScanRef.current = "";
          }
        },
      },
    ]);
  };

  // ── Booking Check-in Actions ────────────────────────

  const removeBookingItem = (assetId: string) => {
    setBookingCheckinItems((prev) => prev.filter((i) => i.assetId !== assetId));
  };

  const clearBookingItems = () => {
    setBookingCheckinItems([]);
    lastScanRef.current = "";
  };

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
            const assetIds = bookingCheckinItems.map((i) => i.assetId);
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
                  if (result?.isComplete) {
                    router.back();
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
    view: "Scan to view asset",
    assign_custody: "Scan assets to assign custody",
    release_custody: "Scan assets to release custody",
    update_location: "Scan assets to update location",
  };

  // Submit button label
  const submitLabelMap: Record<ScannerAction, string> = {
    view: "",
    assign_custody: "Choose Custodian",
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
                  <Text style={styles.bookingModeLabel}>Booking Check-In</Text>
                  <Text style={styles.bookingModeName} numberOfLines={1}>
                    {bookingName || "Scan assets to check in"}
                  </Text>
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
          style={[
            styles.overlaySection,
            styles.bottomSection,
            (showBatchDrawer || showBookingDrawer) && {
              flex: 0,
              paddingTop: spacing.md,
            },
          ]}
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
                  ? "Scan assets to check in"
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

        {/* ── Dev Scan Injection (DEV only) ───────────── */}
        {__DEV__ && (
          <View style={styles.devScanContainer}>
            {devScanVisible ? (
              <View style={styles.devScanRow}>
                <TextInput
                  testID="dev-scan-input"
                  style={styles.devScanInput}
                  value={devScanInput}
                  onChangeText={setDevScanInput}
                  placeholder="QR ID or barcode value"
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
                  accessibilityLabel="Inject scan"
                >
                  <Ionicons name="scan" size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.devScanClose}
                  onPress={() => setDevScanVisible(false)}
                  accessibilityLabel="Close dev scanner"
                >
                  <Ionicons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                testID="dev-scan-toggle"
                style={styles.devScanToggle}
                onPress={() => setDevScanVisible(true)}
                accessibilityLabel="Open dev scanner input"
              >
                <Ionicons name="code-working-outline" size={14} color="#fff" />
                <Text style={styles.devScanToggleText}>DEV SCAN</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Batch Drawer ────────────────────────────── */}
        {showBatchDrawer && (
          <BatchDrawer
            items={scannedItems}
            keyField="qrId"
            title={`${scannedItems.length} asset${
              scannedItems.length > 1 ? "s" : ""
            } scanned`}
            submitLabel={submitLabelMap[action]}
            submitIcon={
              SCANNER_ACTIONS.find((a) => a.key === action)?.icon || "checkmark"
            }
            isSubmitting={isSubmitting}
            onRemove={removeItem}
            onClear={clearAll}
            onSubmit={handleBatchSubmit}
            showStatus
          />
        )}

        {/* ── Booking Check-in Drawer ──────────────────── */}
        {showBookingDrawer && (
          <BatchDrawer
            items={bookingCheckinItems}
            keyField="assetId"
            title={`${bookingCheckinItems.length} asset${
              bookingCheckinItems.length > 1 ? "s" : ""
            } to check in`}
            submitLabel={`Check In ${bookingCheckinItems.length} ${
              bookingCheckinItems.length === 1 ? "Asset" : "Assets"
            }`}
            submitIcon="log-in-outline"
            isSubmitting={isBookingSubmitting}
            onRemove={removeBookingItem}
            onClear={clearBookingItems}
            onSubmit={handleBookingCheckin}
            showStatus={false}
          />
        )}
      </View>

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

  // Paused overlay
  pausedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    zIndex: 5,
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
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
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
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700" as const,
    letterSpacing: 1,
  },
}));
