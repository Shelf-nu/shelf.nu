import {
  ASSET_QTY_STATUS_LABELS,
  DELETE_CONSEQUENCE_LABELS,
} from "@shelf/labels";
import { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Dimensions,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { releaseCategory, isLowStock } from "@shelf/quantity-control";
import {
  api,
  type AssetCustodyListEntry,
  type Location as LocationType,
  type TeamMember,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { resolveSelfTeamMember } from "@/lib/self-team-member";
import { useOrg } from "@/lib/org-context";
import { userHasPermission } from "@/lib/permissions";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  getQuantityStatusLabel,
  formatCurrency,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { pushIntoTab } from "@/lib/navigation";
import { useAssetScreenNavigation } from "@/lib/asset-host-stack";
import { buildBookingCustodyRows } from "@/lib/asset-custody-rows";
import { TeamMemberPicker } from "@/components/team-member-picker";
import { LocationPicker } from "@/components/location-picker";
import { QuantityInputSheet } from "@/components/quantity-input-sheet";
import { custodyAssignCap } from "@/lib/custody-scan-quantities";
import {
  assignSourceOptions,
  ALL_SOURCES,
  assignSourceRequestValue,
  defaultAssignSourceOption,
  describeHolderSources,
  releaseAsksForSource,
  releaseNoteSource,
  releaseSourceOptions,
  releaseSourceQuantity,
  releaseSourceRequestValue,
} from "@/lib/custody-source-options";
import { AdjustQuantitySheet } from "@/components/adjust-quantity-sheet";
import { ManagePlacementsSheet } from "@/components/manage-placements-sheet";
import ConfirmDeleteSheet from "@/components/confirm-delete-sheet";
import { AssetDetailSkeleton } from "@/components/skeleton-loader";
import { AssetHeader } from "@/components/asset-detail/asset-header";
import { QuickActions } from "@/components/asset-detail/quick-actions";
import { NotesSection } from "@/components/asset-detail/notes-section";
import { CodeSection } from "@/components/shared/code-section";
import { CustomFieldsSection } from "@/components/asset-detail/custom-fields-section";
import { InfoRow } from "@/components/shared/info-row";
import { isQuantityTracked, formatQuantity } from "@/lib/quantity-format";
import { useAssetData } from "@/hooks/use-asset-data";
import { useCustodyActions } from "@/hooks/use-custody-actions";
import { useRoleAccess } from "@/hooks/use-role-access";
import { mayReleaseAssetCustody } from "@/lib/role-access";
import { useImageUpload } from "@/hooks/use-image-upload";
import { useSheetSubmit } from "@/hooks/use-sheet-submit";

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  // Edit and Kit open in whichever stack mounts this screen (the Assets tab,
  // or the Audits stack when opened from an audit row), so back retraces the
  // path instead of jumping tabs. See lib/asset-routes.ts.
  const assetNavigation = useAssetScreenNavigation();
  const { currentOrg } = useOrg();
  // Role-aware UI. Server enforces these on every API call
  // (requireMobilePermission); this hides actions the user cannot perform
  // so BASE/SELF_SERVICE don't tap buttons that 403. Mirrors scanner.tsx.
  const roles = currentOrg?.roles;
  const canUpdateAsset = userHasPermission({
    roles,
    entity: "asset",
    action: "update",
  });
  const canDeleteAsset = userHasPermission({
    roles,
    entity: "asset",
    action: "delete",
  });
  const canCustody = userHasPermission({
    roles,
    entity: "asset",
    action: "custody",
  });
  const canCreateNote = userHasPermission({
    roles,
    entity: "note",
    action: "create",
  });
  // Members whose custody scope is self may only take custody for themselves
  // and release their OWN quantity-custody rows; the server enforces both.
  // The client check only controls affordance visibility. Mirrors scanner.tsx.
  const access = useRoleAccess();
  const takesCustodyForSelfOnly = access.custody.assign === "self";
  // Current auth user — used to recognize the caller's own custody row via
  // the server-provided custodian.userId (bearer-auth session user id).
  const { user } = useAuth();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  // Render dates in the acting user's format preferences + timezone.
  const { formatDate, formatDateTime } = useDateFormatter();

  // Asset data
  const {
    asset,
    setAsset,
    isLoading,
    isRefreshing,
    error,
    setError,
    setIsLoading,
    fetchAsset,
    onRefresh,
  } = useAssetData(id, currentOrg?.id);

  // Custody actions
  const {
    isActionLoading,
    setIsActionLoading,
    handleAssignCustody,
    handleReleaseCustody,
    performAssignQuantity,
    performReleaseQuantity,
  } = useCustodyActions({
    asset,
    currentOrg,
    fetchAsset,
    isSelfService: takesCustodyForSelfOnly,
  });

  // The placements and stock sheets submit through this: each stays open,
  // showing the save in progress, until the server accepts its change.
  const submitFromSheet = useSheetSubmit({
    refresh: fetchAsset,
    setSubmitting: setIsActionLoading,
  });

  /**
   * Assigns units from the quantity sheet. When the server refuses (most
   * often because the picked source's numbers moved since the asset was
   * loaded), the asset is reloaded so the picker's counts and default
   * refresh while the sheet stays open with the entered quantity. The
   * reload only replaces the asset on success: a failed reload keeps the
   * screen as it is instead of swapping it for an error state.
   *
   * @param member - The team member receiving the units
   * @param quantity - Units to assign
   * @param locationId - The source to take them from (see `performAssignQuantity`)
   */
  const assignQuantityFromSheet = async (
    member: TeamMember,
    quantity: number,
    locationId?: string | null
  ) => {
    let accepted = false;
    await performAssignQuantity(
      member,
      quantity,
      () => {
        accepted = true;
        setAssignQtyMember(null);
      },
      locationId
    );
    if (accepted || !currentOrg) return;
    const { data } = await api.asset(id, currentOrg.id);
    if (data) setAsset(data.asset);
  };

  // Image upload
  const { isUploadingImage, handleImagePress } = useImageUpload({
    assetId: asset?.id,
    orgId: currentOrg?.id,
    fetchAsset,
  });

  /**
   * Self-service custody: resolve the caller's own team-member record and go
   * straight to the operation — the picker would hold exactly one row (their
   * own; the team-members endpoint is self-scoped for that role). QT assets
   * continue into the quantity sheet; INDIVIDUAL assets confirm directly.
   */
  const handleTakeCustodySelf = async () => {
    if (!currentOrg) return;
    setIsActionLoading(true);
    const { member, error: resolveError } = await resolveSelfTeamMember(
      currentOrg.id
    );
    setIsActionLoading(false);
    if (!member) {
      Alert.alert("Error", resolveError ?? "Something went wrong.");
      return;
    }
    if (isQtyTracked) {
      setAssignQtyMember(member);
    } else {
      handleAssignCustody(member);
    }
  };

  // UI states
  const [showCustodyPicker, setShowCustodyPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showAdjustSheet, setShowAdjustSheet] = useState(false);
  const [showImageZoom, setShowImageZoom] = useState(false);

  // Quantity-custody steps (QUANTITY_TRACKED assets only). Non-null values
  // double as the "sheet visible" flag AND carry the pending target, so the
  // sheet and the submit handler can never disagree about who is affected.
  const [assignQtyMember, setAssignQtyMember] = useState<TeamMember | null>(
    null
  );
  const [releaseQtyEntry, setReleaseQtyEntry] =
    useState<AssetCustodyListEntry | null>(null);

  // "From location" for the assign and release sheets. Only a pool placed at
  // two or more locations asks (the server says so through
  // `custodySources.multiSource`); the picked row drives each sheet's cap.
  const sourceSummary = asset?.custodySources ?? null;
  const multiSource =
    sourceSummary?.multiSource === true && sourceSummary.options.length > 0;
  // The operator's picks, keyed by who the sheet is for, so a pick never
  // leaks from one member (or holder) to the next. The effective value is
  // derived during render: the pick when it belongs to the sheet that is
  // open, else the default. No effect seeds state.
  const [assignPick, setAssignPick] = useState<{
    memberId: string;
    value: string;
  } | null>(null);
  const [releasePick, setReleasePick] = useState<{
    custodianId: string;
    value: string;
  } | null>(null);
  // The row the assign sheet opens on: the location with the most left.
  const defaultAssignValue = sourceSummary
    ? defaultAssignSourceOption(sourceSummary.options)?.value ?? null
    : null;
  // A pick counts only while its row still exists: a refetch can drop the
  // row it named (a location cleared, a source released in full).
  const assignSource =
    assignQtyMember && multiSource && sourceSummary
      ? assignPick?.memberId === assignQtyMember.id &&
        sourceSummary.options.some(
          (option) => option.value === assignPick.value
        )
        ? assignPick.value
        : defaultAssignValue
      : null;
  // Release goes by the HOLDER's sources, not the pool's current placements:
  // custody recorded from two locations stays releasable per source even
  // after the pool was moved to one location. Only a holder with two or
  // more sources is asked; the picker opens on "All sources", their whole
  // hold. With 0 or 1 sources there is nothing to choose.
  const releaseSources = releaseAsksForSource(releaseQtyEntry?.sources)
    ? releaseQtyEntry?.sources ?? null
    : null;
  // A pick counts only while its row still exists; otherwise the release
  // falls back to all sources.
  const releaseSource =
    releaseQtyEntry && releaseSources
      ? releasePick?.custodianId === releaseQtyEntry.custodian.id &&
        releaseSourceQuantity(releaseSources, releasePick.value) !== null
        ? releasePick.value
        : ALL_SOURCES
      : null;

  // Notes
  const [noteText, setNoteText] = useState("");
  const [isPostingNote, setIsPostingNote] = useState(false);

  // ── Location / Placements Actions ───────────────────

  // QUANTITY_TRACKED assets edit their location spread in the placements
  // editor; INDIVIDUAL assets keep the picker + confirm-alert flow.
  const [showPlacementsSheet, setShowPlacementsSheet] = useState(false);
  // The typed-name delete confirmation (see ConfirmDeleteSheet).
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);

  /**
   * Current placement rows for the placements card + editor seed. Prefers
   * the server's `placements` array; a server that omits it degrades to a
   * single synthesized row from the flat `location` field so the card and
   * editor still reflect the primary placement.
   */
  const placements = useMemo(() => {
    // why: isQuantityTracked is called directly — the screen's shared
    // `isQtyTracked` const is declared after the loading/error returns,
    // and hooks must run before them.
    if (!asset || !isQuantityTracked(asset)) return [];
    if (asset.placements) return asset.placements;
    if (!asset.location) return [];
    return [
      {
        locationId: asset.location.id,
        locationName: asset.location.name,
        quantity: asset.locationQuantity ?? asset.quantity ?? 1,
        viaKit: null,
      },
    ];
  }, [asset]);

  /**
   * Units not placed at any location. Manual rows only — kit-driven rows
   * describe the same units from the kit's point of view and are bounded
   * on their own axis, so they don't reduce the unplaced pool.
   */
  const unplacedUnits = useMemo(() => {
    if (!asset || !isQuantityTracked(asset)) return 0;
    const manualSum = placements.reduce(
      (sum, p) => (p.viaKit === null ? sum + p.quantity : sum),
      0
    );
    return Math.max(0, (asset.quantity ?? 0) - manualSum);
  }, [asset, placements]);

  /** INDIVIDUAL flow: picker selection confirms a whole-asset move. */
  const handleLocationSelect = (location: LocationType) => {
    setShowLocationPicker(false);

    if (location.id === asset?.location?.id) return; // same location

    Alert.alert(
      "Update Location",
      `Move "${asset?.title}" to ${location.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move", onPress: () => performUpdateLocation(location.id) },
      ]
    );
  };

  /** Applies an INDIVIDUAL asset's location update and refreshes. */
  const performUpdateLocation = async (locationId: string) => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.updateLocation(
      currentOrg.id,
      asset.id,
      locationId
    );
    if (err) Alert.alert("Error", err);
    else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await fetchAsset();
    }
    setIsActionLoading(false);
  };

  /**
   * Replaces the manual placement set (QUANTITY_TRACKED) and refreshes.
   * The sheet already validated the sum client-side; the server re-checks
   * everything against the row-locked asset and reports conflicts (409)
   * through the error alert. The sheet closes only once the server accepts
   * the set, so a refusal leaves the edited rows on screen to fix or retry.
   */
  const performSavePlacements = async (
    nextPlacements: { locationId: string; quantity: number }[]
  ) => {
    if (!currentOrg || !asset) return;
    const orgId = currentOrg.id;
    const assetId = asset.id;
    await submitFromSheet(
      () => api.managePlacements(orgId, assetId, nextPlacements),
      () => setShowPlacementsSheet(false)
    );
  };

  // ── Adjust Quantity (stock) ─────────────────────────

  /**
   * Applies a stock adjustment and refreshes the asset. Web
   * QuickAdjustDialog parity: Add maps to RESTOCK, Remove maps to LOSS —
   * the server writes the ConsumptionLog row and fires the low-stock alert.
   * The sheet closes only once the server accepts the adjustment, so a
   * refusal keeps the entered quantity and note.
   */
  const performAdjustQuantity = async (args: {
    direction: "add" | "subtract";
    quantity: number;
    note?: string;
  }) => {
    if (!currentOrg || !asset) return;
    const orgId = currentOrg.id;
    const assetId = asset.id;
    await submitFromSheet(
      () =>
        api.adjustQuantity(orgId, assetId, {
          quantity: args.quantity,
          direction: args.direction,
          category: args.direction === "add" ? "RESTOCK" : "LOSS",
          note: args.note,
        }),
      () => setShowAdjustSheet(false)
    );
  };

  // ── Notes Action ────────────────────────────────────

  const handlePostNote = async () => {
    const orgId = currentOrg?.id;
    if (!asset || !noteText.trim() || isPostingNote || !orgId) return;
    setIsPostingNote(true);
    const { error: err } = await api.addNote(asset.id, noteText.trim(), orgId);
    if (err) {
      Alert.alert("Error", err);
    } else {
      setNoteText("");
      await fetchAsset();
    }
    setIsPostingNote(false);
  };

  // ── Delete Asset ──────────────────────────────────

  // A permanent delete asks for the asset's name to be typed first, the same
  // rule as the webapp's delete dialog.
  const handleDeleteAsset = () => {
    if (!asset) return;
    setShowDeleteSheet(true);
  };

  const performDeleteAsset = async () => {
    if (!currentOrg || !asset) return;
    setIsActionLoading(true);
    const { error: err } = await api.deleteAsset(currentOrg.id, asset.id);
    setIsActionLoading(false);
    setShowDeleteSheet(false);
    if (err) {
      Alert.alert("Error", err);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Deleted", `"${asset.title}" has been deleted.`, [
        { text: "OK", onPress: () => router.back() },
      ]);
    }
  };

  // ── Render ──────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Loading..." }} />
        <AssetDetailSkeleton />
      </>
    );
  }

  if (error || !asset) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.errorText}>{error || "Asset not found"}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setIsLoading(true);
              fetchAsset().finally(() => setIsLoading(false));
            }}
            accessibilityLabel="Retry loading asset"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const badge = statusBadge[asset.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };
  const activeCustomFields = asset.customFields.filter(
    (cf) => cf.customField.active !== false
  );

  // ── Quantity display (additive, QUANTITY_TRACKED assets only) ────────
  // Every value below is guarded so an INDIVIDUAL asset — or a pre-quantity
  // server that omits these fields — renders exactly as before.
  const isQtyTracked = isQuantityTracked(asset);
  // Total quantity label ("10 pcs" / "10"). Null when absent.
  const totalQuantityLabel = isQtyTracked
    ? formatQuantity(asset.quantity, asset.unitOfMeasure)
    : null;
  // Per-status slices; null for INDIVIDUAL assets or QT assets with no
  // activity (server's getQuantityData null contract) — we fall back to the
  // plain total in that case.
  const breakdown = isQtyTracked ? asset.quantityBreakdown ?? null : null;
  // Available units for the low-stock check + the "Available" stat. Prefer the
  // breakdown's `available`, but fall back to the plain total (`asset.quantity`)
  // when the server omitted the breakdown: an idle QT asset (no custody/booking
  // activity) returns a null breakdown yet can still sit at/below its threshold.
  // Web derives `available` unconditionally (notifier + overview card), so
  // gating on the breakdown here would hide low-stock on exactly the idle
  // inventory the alert is for.
  const availableUnits = breakdown?.available ?? asset.quantity ?? null;
  // Low-stock mirrors the web detail card: availability-aware
  // `available <= minQuantity` (null threshold = not low).
  const isAvailableLowStock =
    availableUnits != null &&
    isLowStock({
      available: availableUnits,
      minQuantity: asset.minQuantity ?? null,
    });
  // Status pill label. For a QUANTITY_TRACKED asset whose units span states
  // (e.g. some held, some free), the raw enum ("IN_CUSTODY") reads wrong — the
  // web shows a derived "Partial custody". Use the shared quantity-aware label
  // (identical precedence to web getQuantityBadgeLabelAndColor); fall back to
  // the plain enum label for INDIVIDUAL assets or QT assets with no breakdown.
  const statusLabel =
    getQuantityStatusLabel(breakdown) ?? formatStatus(asset.status);
  const unitSuffix = asset.unitOfMeasure?.trim()
    ? ` ${asset.unitOfMeasure.trim()}`
    : "";
  // Many-aware custody rows. Empty/absent → fall back to the existing single
  // `asset.custody` display below.
  const custodyList =
    isQtyTracked && asset.custodyList && asset.custodyList.length > 0
      ? asset.custodyList
      : null;
  // Custody held through a booking. Rendered only when neither custody source
  // above has a row, the same precedence as the web asset page's card.
  const bookingCustodyRows = buildBookingCustodyRows(asset.activeBooking, {
    formatDateTime,
    // The booking lives in another tab; the helper roots that tab at its list
    // so "back" has somewhere to go. The same holds when this screen is
    // mounted in the Audits stack: the booking screen is not mounted there.
    onOpenBooking: (bookingId) =>
      pushIntoTab("/(tabs)/bookings", `/(tabs)/bookings/${bookingId}`),
  });
  // Cap for the assign-quantity step, shared with the Scan tab's assign mode
  // so both offer the same number. The server re-validates the real cap on
  // submit either way.
  const assignMax = isQtyTracked ? custodyAssignCap(asset) : 0;
  // Units releasable from the pending release target (operator rows only;
  // kit-held units are excluded). 0 while no row is pending.
  const releaseMax = releaseQtyEntry
    ? releaseQtyEntry.releasableQuantity ?? releaseQtyEntry.quantity
    : 0;
  // The shared predicate decides this, so the wording can never disagree with
  // what the server does. Servers predating the field send no consumptionType,
  // which falls through to the returnable copy — the server's own default.
  const isConsumable = releaseCategory(asset.consumptionType) === "CONSUME";
  // The assign sheet's picker and cap. With a source picked, the cap is what
  // that source has left (never above the pool-wide cap).
  const selectedAssignOption =
    multiSource && sourceSummary && assignSource != null
      ? sourceSummary.options.find((option) => option.value === assignSource) ??
        null
      : null;
  const assignSheetMax = selectedAssignOption
    ? Math.min(assignMax, Math.max(0, selectedAssignOption.left))
    : assignMax;
  // Why the cap is 0 when the picked source has nothing left. The server
  // enforces the per-source cap, so the operator has to pick another row.
  const assignSourceNotice =
    selectedAssignOption && selectedAssignOption.left <= 0 && sourceSummary
      ? !sourceSummary.options.some((option) => option.left > 0)
        ? "No units are left at any location."
        : selectedAssignOption.locationId === null
        ? "No unplaced units are left. Pick a location."
        : `Nothing left at ${selectedAssignOption.label}. Pick another location.`
      : undefined;
  const assignSourceProp =
    multiSource && sourceSummary && assignSource != null
      ? {
          label: "From location",
          options: assignSourceOptions(
            sourceSummary.options,
            asset.unitOfMeasure
          ),
          value: assignSource,
          onChange: (value: string) => {
            if (assignQtyMember) {
              setAssignPick({ memberId: assignQtyMember.id, value });
            }
          },
        }
      : undefined;
  // The release sheet's picker and cap: "All sources" plus one row per
  // source the holder took units from, shown only when there are two or
  // more. The cap is what the picked row holds (the whole hold for "All
  // sources"), never above the releasable units.
  const pickedReleaseQuantity =
    releaseSources && releaseSource != null
      ? releaseSourceQuantity(releaseSources, releaseSource)
      : null;
  const releaseSheetMax =
    pickedReleaseQuantity !== null
      ? Math.min(releaseMax, pickedReleaseQuantity)
      : releaseMax;
  // The source the "goes back to" note names: the picked row, or a holder's
  // only source on a multi-location pool. Null for "All sources", which can
  // return units to several places.
  const selectedReleaseEntry = releaseNoteSource({
    sources: releaseQtyEntry?.sources,
    picked: releaseSource,
    multiSource,
  });
  const releaseSourceProp =
    releaseSources && releaseSource != null
      ? {
          label: "From",
          options: releaseSourceOptions(releaseSources, asset.unitOfMeasure),
          value: releaseSource,
          onChange: (value: string) => {
            if (releaseQtyEntry) {
              setReleasePick({
                custodianId: releaseQtyEntry.custodian.id,
                value,
              });
            }
          },
        }
      : undefined;
  const releaseSourceNote =
    selectedReleaseEntry && !selectedReleaseEntry.unrecorded
      ? selectedReleaseEntry.locationId === null
        ? "Goes back to the unplaced units."
        : `Goes back to ${
            selectedReleaseEntry.name ?? "its location"
          }, where the units came from.`
      : null;
  // Custody holders the server hid from this caller (privacy filtering for
  // roles without view-all-custody). Shown as a muted "+N others" row.
  const custodyOthersCount = isQtyTracked
    ? asset.custodyListOthersCount ?? 0
    : 0;

  return (
    <>
      <Stack.Screen options={{ title: asset.title }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
              accessibilityLabel="Pull to refresh"
            />
          }
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Hero Image ─────────────────────────────── */}
          <AssetHeader
            asset={asset}
            onImagePress={() => setShowImageZoom(true)}
            onUploadPress={handleImagePress}
            isUploading={isUploadingImage}
            canUpload={canUpdateAsset}
          />

          {/* ── Title + Status ─────────────────────────── */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{asset.title}</Text>
            <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
              <View
                style={[styles.statusDot, { backgroundColor: badge.text }]}
              />
              <Text style={[styles.statusText, { color: badge.text }]}>
                {statusLabel}
              </Text>
            </View>
          </View>

          {asset.description && (
            <Text style={styles.description}>{asset.description}</Text>
          )}

          {/* ── Quantity (QUANTITY_TRACKED assets only) ── */}
          {isQtyTracked && totalQuantityLabel && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Quantity</Text>
              <View style={styles.quantityCard}>
                <View style={styles.quantityTotalRow}>
                  <Text style={styles.quantityTotalValue}>
                    {totalQuantityLabel}
                  </Text>
                  <Text style={styles.quantityTotalLabel}>total</Text>
                  {/* Stock adjust — server requires asset:update, so the
                      affordance is hidden from roles that would 403. */}
                  {canUpdateAsset && (
                    <TouchableOpacity
                      style={styles.adjustButton}
                      onPress={() => setShowAdjustSheet(true)}
                      disabled={isActionLoading}
                      activeOpacity={0.7}
                      accessibilityLabel="Adjust quantity"
                      accessibilityRole="button"
                    >
                      <Ionicons
                        name="swap-vertical"
                        size={14}
                        color={colors.foreground}
                      />
                      <Text style={styles.adjustButtonText}>Adjust</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* "Available" always renders for a QT asset (so an idle asset
                    at/below its low-stock threshold still shows the amber
                    warning); the other status slices render only when the
                    server sent a breakdown (null = no custody/booking activity,
                    i.e. all units available). */}
                {availableUnits != null && (
                  <View style={styles.quantityBreakdownRow}>
                    <QuantityStat
                      label={ASSET_QTY_STATUS_LABELS.AVAILABLE}
                      value={`${availableUnits}${unitSuffix}`}
                      warning={isAvailableLowStock}
                    />
                    {breakdown && (
                      <>
                        <QuantityStat
                          label={ASSET_QTY_STATUS_LABELS.IN_CUSTODY}
                          value={`${breakdown.inCustody}${unitSuffix}`}
                        />
                        <QuantityStat
                          label={ASSET_QTY_STATUS_LABELS.RESERVED}
                          value={`${breakdown.reserved}${unitSuffix}`}
                        />
                        <QuantityStat
                          label={ASSET_QTY_STATUS_LABELS.CHECKED_OUT}
                          value={`${breakdown.checkedOut}${unitSuffix}`}
                        />
                      </>
                    )}
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── Quick Actions ──────────────────────────── */}
          <QuickActions
            asset={asset}
            onAssignCustody={() => {
              if (takesCustodyForSelfOnly) {
                void handleTakeCustodySelf();
              } else {
                setShowCustodyPicker(true);
              }
            }}
            onReleaseCustody={handleReleaseCustody}
            canReleaseCustody={mayReleaseAssetCustody({
              access,
              userId: user?.id,
              custodianUserId: asset.custody?.custodian?.userId,
            })}
            onLocationPress={() =>
              isQtyTracked
                ? setShowPlacementsSheet(true)
                : setShowLocationPicker(true)
            }
            onEditPress={() => assetNavigation.openEdit(asset.id)}
            onDeletePress={handleDeleteAsset}
            isActionLoading={isActionLoading}
            showOverflowMenu={showOverflowMenu}
            setShowOverflowMenu={setShowOverflowMenu}
            canUpdate={canUpdateAsset}
            canDelete={canDeleteAsset}
            canCustody={canCustody}
            isSelfService={takesCustodyForSelfOnly}
            isQtyTracked={isQtyTracked}
            custodyAvailable={isQtyTracked ? assignMax : undefined}
          />

          {/* ── Details Card ───────────────────────────── */}
          <View style={styles.infoSection}>
            {asset.category && (
              <InfoRow
                icon="pricetag-outline"
                label="Category"
                value={asset.category.name}
              />
            )}
            {/* INDIVIDUAL: single flat location row. QUANTITY_TRACKED
                renders the placement rows below instead. */}
            {!isQtyTracked && asset.location && (
              <InfoRow
                icon="location-outline"
                label="Location"
                value={asset.location.name}
              />
            )}
            {/* QUANTITY_TRACKED: the full location spread. One row per
                placement (kit-driven rows named as such), plus the unplaced
                remainder — so a partial move's result is readable right
                here. The first row opens the placements editor. */}
            {isQtyTracked &&
              placements.map((p, idx) => (
                <InfoRow
                  key={`${p.locationId}-${p.viaKit?.id ?? "manual"}`}
                  icon={idx === 0 ? "location-outline" : "return-down-forward"}
                  label={idx === 0 ? "Locations" : "Also at"}
                  value={`${p.locationName} · ${
                    formatQuantity(p.quantity, asset.unitOfMeasure) ??
                    p.quantity
                  }${p.viaKit ? ` via kit ${p.viaKit.name}` : ""}`}
                  // The row's value IS its a11y label (default), so a screen
                  // reader reads the location + count; role=button + the
                  // chevron signal it opens the editor. The QuickActions
                  // "Placements" button carries the "Manage placements" label.
                  onPress={
                    idx === 0 && canUpdateAsset
                      ? () => setShowPlacementsSheet(true)
                      : undefined
                  }
                />
              ))}
            {isQtyTracked && unplacedUnits > 0 && (
              <InfoRow
                icon="ellipse-outline"
                label={placements.length > 0 ? "Unplaced" : "Locations"}
                value={
                  placements.length > 0
                    ? `${
                        formatQuantity(unplacedUnits, asset.unitOfMeasure) ??
                        unplacedUnits
                      }`
                    : `Unplaced · ${
                        formatQuantity(unplacedUnits, asset.unitOfMeasure) ??
                        unplacedUnits
                      }`
                }
                onPress={
                  placements.length === 0 && canUpdateAsset
                    ? () => setShowPlacementsSheet(true)
                    : undefined
                }
              />
            )}
            {asset.kit && (
              <InfoRow
                icon="layers-outline"
                label="Kit"
                value={asset.kit.name}
                // Kit detail is mounted in this same stack, so the push keeps
                // "back" returning to this asset.
                onPress={() => assetNavigation.openKit(asset.kit!.id)}
                accessibilityLabel={`View kit ${asset.kit.name}`}
              />
            )}
            {custodyList ? (
              /* Many-aware custody — one row per holder. Each row is
                 self-describing: the custodian's name labels the row and the
                 held quantity is the value, so no row depends on a sibling for
                 context (QUANTITY_TRACKED assets can have several holders).
                 Rows the caller can act on are tappable and open the
                 release-quantity sheet; rows the caller can't act on (no
                 custody permission, another member's row for self-service,
                 or units held only via a kit) stay read-only. */
              custodyList.map((entry) => {
                const qtyLabel = formatQuantity(
                  entry.quantity,
                  asset.unitOfMeasure
                );
                // Operator-releasable units. Older servers omit the field —
                // treat the full holding as releasable (server re-validates).
                const releasableQty =
                  entry.releasableQuantity ?? entry.quantity;
                // Units earmarked through a kit's custody: released only by
                // releasing the kit itself, so they get a hint, not a button.
                const kitHeldQty = Math.max(0, entry.quantity - releasableQty);
                const canReleaseRow =
                  canCustody &&
                  releasableQty > 0 &&
                  (!takesCustodyForSelfOnly ||
                    entry.custodian.userId === user?.id);
                return (
                  <InfoRow
                    key={entry.custodian.id}
                    icon="person-outline"
                    label={entry.custodian.name}
                    value={
                      kitHeldQty > 0
                        ? `${
                            qtyLabel ?? ASSET_QTY_STATUS_LABELS.IN_CUSTODY
                          } • ${kitHeldQty} via kit`
                        : qtyLabel ?? ASSET_QTY_STATUS_LABELS.IN_CUSTODY
                    }
                    // Where the holder's units came from, under the quantity
                    // so it never truncates the count: "1 from Camera Room ·
                    // 1 from Studio · 1 unplaced". Only a pool kept at two or
                    // more locations says it.
                    hint={
                      (multiSource || (entry.sources?.length ?? 0) > 1
                        ? describeHolderSources(entry.sources)
                        : null) ?? undefined
                    }
                    onPress={
                      canReleaseRow
                        ? () => setReleaseQtyEntry(entry)
                        : undefined
                    }
                    accessibilityLabel={
                      canReleaseRow
                        ? isConsumable
                          ? `End hold on units held by ${
                              entry.custodian.name
                            }, holds ${qtyLabel ?? entry.quantity}`
                          : `Release custody from ${
                              entry.custodian.name
                            }, holds ${qtyLabel ?? entry.quantity}`
                        : undefined
                    }
                  />
                );
              })
            ) : asset.custody ? (
              <>
                <InfoRow
                  icon="person-outline"
                  label="In Custody Of"
                  value={asset.custody.custodian.name}
                />
                {asset.custody.custodian.user?.email && (
                  <InfoRow
                    icon="mail-outline"
                    label="Custodian Email"
                    value={asset.custody.custodian.user.email}
                  />
                )}
                <InfoRow
                  icon="time-outline"
                  label="Custody Since"
                  value={formatDate(asset.custody.createdAt)}
                />
              </>
            ) : (
              bookingCustodyRows.map((row) => (
                <InfoRow
                  key={row.key}
                  icon={row.icon}
                  label={row.label}
                  value={row.value}
                  onPress={row.onPress}
                  accessibilityLabel={row.accessibilityLabel}
                />
              ))
            )}
            {/* Holders hidden from this caller (privacy filtering) — one calm
                muted row so partial lists don't read as the full picture. */}
            {custodyOthersCount > 0 && (
              <View
                style={styles.custodyOthersRow}
                accessible
                accessibilityLabel={`Plus ${custodyOthersCount} ${
                  custodyOthersCount === 1 ? "other holds" : "others hold"
                } this asset`}
              >
                <Ionicons
                  name="people-outline"
                  size={16}
                  color={colors.muted}
                />
                <Text style={styles.custodyOthersText}>
                  +{custodyOthersCount}{" "}
                  {custodyOthersCount === 1 ? "other holds" : "others hold"}{" "}
                  this asset
                </Text>
              </View>
            )}
            {asset.valuation != null && (
              <InfoRow
                icon="cash-outline"
                label="Value"
                value={formatCurrency(
                  asset.valuation,
                  asset.organization?.currency || "USD"
                )}
              />
            )}
            {asset.assetModel?.name ? (
              <InfoRow
                icon="cube-outline"
                label="Asset Model"
                value={asset.assetModel.name}
              />
            ) : null}
            {/* The identifier this workspace labels its assets with, resolved
                server-side. Labelled with the code's own name ("Code 128") so
                the reader can tell WHICH identifier they are looking at when
                matching a physical label. */}
            {asset.displayCode?.value ? (
              <InfoRow
                // `barcode-outline` rather than `pricetag-outline`: the Category
                // row above already owns the pricetag, and it also matches the
                // scanner affordance this row exists for.
                icon="barcode-outline"
                label={asset.displayCode.label}
                value={asset.displayCode.value}
              />
            ) : null}
            {/* The SAM ID keeps its own row whenever it is not already the row
                above: the scanner's manual entry accepts a SAM ID, so the app
                has to be able to tell you what an asset's SAM ID is whatever
                the workspace prefers to display. */}
            {asset.sequentialId &&
            asset.displayCode?.value !== asset.sequentialId ? (
              <InfoRow
                // `keypad-outline`: this row exists because the scanner's
                // manual entry takes a SAM ID, and a pricetag would read as a
                // second Category row.
                icon="keypad-outline"
                label="SAM ID"
                value={asset.sequentialId}
              />
            ) : null}
            <InfoRow
              icon="calendar-outline"
              label="Created"
              value={formatDate(asset.createdAt)}
            />
            <InfoRow
              icon="refresh-outline"
              label="Updated"
              value={formatDate(asset.updatedAt)}
            />
          </View>

          {/* ── Tags ───────────────────────────────────── */}
          {asset.tags.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <View style={styles.tagsRow}>
                {asset.tags.map((tag) => (
                  <View key={tag.id} style={styles.tag}>
                    <Text style={styles.tagText}>{tag.name}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── Codes ──────────────────────────────────── */}
          {/* Leads with the workspace's preferred code and offers the others.
              The choice is the server's (`displayCode`); this screen never
              re-derives it, because it does not receive the preference. */}
          <CodeSection
            displayCode={asset.displayCode}
            barcodes={asset.barcodes}
            qrCodes={asset.qrCodes}
          />

          {/* ── Custom Fields ──────────────────────────── */}
          <CustomFieldsSection
            customFields={activeCustomFields}
            currency={asset.organization?.currency || "USD"}
          />

          {/* ── Activity / Notes ───────────────────────── */}
          <NotesSection
            notes={asset.notes}
            noteText={noteText}
            onChangeNoteText={setNoteText}
            onPostNote={handlePostNote}
            isPostingNote={isPostingNote}
            // why: composer shows only when the workspace is resolved AND
            // the member holds note:create, because the server gates adding a
            // note on that same permission; members without it get a
            // read-only activity feed instead of a box that 403s on Post.
            canPostNote={!!currentOrg?.id && canCreateNote}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Overflow Menu (Android) ───────────────────── */}
      <Modal
        visible={showOverflowMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverflowMenu(false)}
      >
        <TouchableOpacity
          style={styles.overflowBackdrop}
          activeOpacity={1}
          onPress={() => setShowOverflowMenu(false)}
        >
          <View style={styles.overflowMenu} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.overflowItem}
              onPress={() => {
                setShowOverflowMenu(false);
                handleDeleteAsset();
              }}
            >
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={styles.overflowItemTextDanger}>Delete Asset</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Image Zoom Modal ──────────────────────────── */}
      {asset.mainImage && (
        <Modal
          visible={showImageZoom}
          transparent
          animationType="fade"
          onRequestClose={() => setShowImageZoom(false)}
        >
          <View style={styles.zoomOverlay} accessibilityViewIsModal={true}>
            <TouchableOpacity
              style={styles.zoomCloseBtn}
              onPress={() => setShowImageZoom(false)}
              accessibilityLabel="Close image viewer"
              accessibilityRole="button"
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Image
              source={{ uri: asset.mainImage }}
              style={styles.zoomImage}
              contentFit="contain"
            />
          </View>
        </Modal>
      )}

      {/* ── Modals ────────────────────────────────────── */}
      {currentOrg && (
        <>
          <TeamMemberPicker
            visible={showCustodyPicker}
            orgId={currentOrg.id}
            onSelect={(member) => {
              // Mirror handleLocationSelect: dismiss the picker before the
              // confirm/assign flow so the user sees the refetched asset
              // detail and the new custody state — not a stuck member list
              // with no visible feedback (read as "it didn't work").
              setShowCustodyPicker(false);
              if (isQtyTracked) {
                // QUANTITY_TRACKED: capture the member and ask how many
                // units — the quantity sheet's submit is the confirm step.
                setAssignQtyMember(member);
              } else {
                // INDIVIDUAL: unchanged Alert-confirm flow.
                handleAssignCustody(member);
              }
            }}
            onClose={() => setShowCustodyPicker(false)}
          />
          <LocationPicker
            visible={showLocationPicker}
            orgId={currentOrg.id}
            currentLocationId={asset?.location?.id}
            onSelect={handleLocationSelect}
            onClose={() => setShowLocationPicker(false)}
          />
          {asset && (
            <ConfirmDeleteSheet
              visible={showDeleteSheet}
              title="Delete asset"
              message={DELETE_CONSEQUENCE_LABELS.ASSET}
              expected={asset.title}
              isDeleting={isActionLoading}
              onConfirm={() => void performDeleteAsset()}
              onClose={() => setShowDeleteSheet(false)}
            />
          )}
          {/* Quantity steps — mounted only for QUANTITY_TRACKED assets so
              INDIVIDUAL rendering stays byte-identical. */}
          {isQtyTracked && (
            <>
              <ManagePlacementsSheet
                visible={showPlacementsSheet}
                orgId={currentOrg.id}
                totalQuantity={asset.quantity ?? 1}
                unitOfMeasure={asset.unitOfMeasure}
                initialPlacements={placements}
                isSubmitting={isActionLoading}
                onSave={(next) => void performSavePlacements(next)}
                onClose={() => setShowPlacementsSheet(false)}
              />
              <AdjustQuantitySheet
                visible={showAdjustSheet}
                // Physical removal cap (custodyAvailable chain), NOT
                // `breakdown.available`: available subtracts the SUM of all
                // future reservations, which over-restricts Remove when
                // non-overlapping bookings exist. The server enforces the
                // real floor (in-custody + peak concurrent reservations).
                availableQuantity={assignMax}
                unitOfMeasure={asset.unitOfMeasure}
                isSubmitting={isActionLoading}
                onSubmit={(args) => void performAdjustQuantity(args)}
                onClose={() => setShowAdjustSheet(false)}
              />
              <QuantityInputSheet
                visible={assignQtyMember != null}
                title={
                  takesCustodyForSelfOnly ? "Take Quantity" : "Assign Quantity"
                }
                subtitle={
                  assignQtyMember
                    ? takesCustodyForSelfOnly
                      ? "How many units are you taking?"
                      : `Assign to ${memberDisplayName(assignQtyMember)}`
                    : undefined
                }
                max={assignSheetMax}
                defaultValue={1}
                unitOfMeasure={asset.unitOfMeasure}
                source={assignSourceProp}
                notice={assignSourceNotice}
                confirmLabel={takesCustodyForSelfOnly ? "Take" : "Assign"}
                isSubmitting={isActionLoading}
                onSubmit={(quantity) => {
                  if (!assignQtyMember) return;
                  void assignQuantityFromSheet(
                    assignQtyMember,
                    quantity,
                    // Sent only when the pool asked. The default is sent
                    // explicitly because the server records "location not
                    // recorded" for a multi-source assign without one; the
                    // server validates the cap, so a stale default is
                    // refused rather than mis-recorded.
                    assignSourceProp && assignSource != null
                      ? assignSourceRequestValue(assignSource)
                      : undefined
                  );
                }}
                onClose={() => setAssignQtyMember(null)}
              />
              <QuantityInputSheet
                visible={releaseQtyEntry != null}
                title={isConsumable ? "End hold" : "Release Quantity"}
                subtitle={
                  releaseQtyEntry
                    ? isConsumable
                      ? `End the hold on how many of ${
                          releaseQtyEntry.custodian.name
                        }'s ${
                          formatQuantity(
                            releaseSheetMax,
                            asset.unitOfMeasure
                          ) ?? String(releaseSheetMax)
                        }, and how many were used up? Used-up units permanently reduce total stock.`
                      : `Release how many of ${
                          releaseQtyEntry.custodian.name
                        }'s ${
                          formatQuantity(
                            releaseSheetMax,
                            asset.unitOfMeasure
                          ) ?? String(releaseSheetMax)
                        }?${releaseSourceNote ? ` ${releaseSourceNote}` : ""}`
                    : undefined
                }
                source={releaseSourceProp}
                max={releaseSheetMax}
                // Web parity: the release dialog pre-fills a full release.
                defaultValue={releaseSheetMax}
                unitOfMeasure={asset.unitOfMeasure}
                secondary={
                  isConsumable
                    ? {
                        label: "Of those, how many were used up?",
                        // Pre-fill a full consume — the common case, and what
                        // the server defaults to when no split is sent.
                        defaultValue: releaseSheetMax,
                      }
                    : undefined
                }
                confirmLabel={isConsumable ? "Confirm" : "Release"}
                destructive
                isSubmitting={isActionLoading}
                onSubmit={(quantity, consumed) => {
                  if (!releaseQtyEntry) return;
                  void performReleaseQuantity(
                    releaseQtyEntry.custodian.id,
                    quantity,
                    consumed,
                    () => setReleaseQtyEntry(null),
                    // A specific source is sent only when the holder was
                    // asked and picked one. "All sources", or a holder with
                    // 0 or 1 sources, sends no locationId and the server
                    // draws the holder's rows in its fixed order.
                    releaseSources && releaseSource != null
                      ? releaseSourceRequestValue(releaseSource)
                      : undefined
                  );
                }}
                onClose={() => setReleaseQtyEntry(null)}
              />
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * Human display name for a team member — the linked user's full name when
 * present, falling back to the team-member record name. Matches the label
 * the TeamMemberPicker row showed, so the quantity sheet's subtitle names
 * exactly who was just tapped.
 *
 * @param member - The selected team member.
 * @returns The display name.
 */
function memberDisplayName(member: TeamMember): string {
  if (member.user) {
    const fullName = [member.user.firstName, member.user.lastName]
      .filter(Boolean)
      .join(" ");
    return fullName || member.name;
  }
  return member.name;
}

/**
 * QuantityStat — one labelled value in the QUANTITY_TRACKED breakdown grid
 * (e.g. "Available · 6 pcs"). Module-scoped for stable render identity.
 *
 * @param props.label - The status label (e.g. "Available").
 * @param props.value - The pre-formatted quantity string (e.g. "6 pcs").
 * @param props.warning - When true, render an amber low-stock affordance
 *   (icon + amber value), mirroring the web detail card's amber alert.
 */
function QuantityStat({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  // `accessible` groups the two Text nodes into one element so
  // VoiceOver/TalkBack reads the combined "label value" once.
  return (
    <View
      style={styles.quantityStat}
      accessible
      accessibilityLabel={`${label} ${value}${warning ? ", low stock" : ""}`}
    >
      <View style={styles.quantityStatValueRow}>
        {warning ? (
          <Ionicons
            name="warning-outline"
            size={14}
            color={colors.warningText}
          />
        ) : null}
        <Text
          style={[
            styles.quantityStatValue,
            warning ? { color: colors.warningText } : null,
          ]}
        >
          {value}
        </Text>
      </View>
      <Text style={styles.quantityStatLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────

const useStyles = createStyles((colors, shadows) => ({
  container: { flex: 1, backgroundColor: colors.backgroundSecondary },
  content: { paddingBottom: 40 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.xl,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },

  // Title
  titleSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
    flex: 1,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: fontSize.xs, fontWeight: "500" },
  description: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  // Overflow menu
  overflowBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  overflowMenu: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    width: "75%",
    overflow: "hidden",
    ...shadows.lg,
  },
  overflowItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
  },
  overflowItemTextDanger: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.error,
  },

  // Info card
  infoSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },

  // Section containers (tags, QR)
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // Quantity card (QUANTITY_TRACKED assets)
  quantityCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.sm,
  },
  quantityTotalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  quantityTotalValue: {
    fontSize: fontSize.xxxl,
    fontWeight: "700",
    color: colors.foreground,
  },
  quantityTotalLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
  },
  adjustButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    alignSelf: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.gray300,
    backgroundColor: colors.white,
  },
  adjustButtonText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  quantityBreakdownRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  // Two-up grid: each stat takes ~half the row so 4 stats wrap to 2x2.
  quantityStat: {
    width: "50%",
    paddingVertical: spacing.xs,
    gap: 2,
  },
  // Row for the (optional) low-stock warning icon + the value text.
  quantityStatValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  quantityStatValue: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  quantityStatLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  // "+N others hold this asset" — matches InfoRow's row metrics but stays
  // muted end-to-end (it is a note about hidden rows, not a data row).
  custodyOthersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  custodyOthersText: {
    fontSize: fontSize.base,
    color: colors.muted,
  },

  // Tags
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: {
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagText: { fontSize: fontSize.sm, color: colors.gray700 },

  // Image zoom modal
  zoomOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomCloseBtn: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  zoomImage: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.7,
  },
}));
