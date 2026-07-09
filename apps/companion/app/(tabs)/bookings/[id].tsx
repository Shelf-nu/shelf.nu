import { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  ActionSheetIOS,
  Modal,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { pushIntoTab } from "@/lib/navigation";
import {
  consumeBookingDirty,
  markBookingsListDirty,
} from "@/lib/booking-refresh";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  type BookingDetail,
  type BookingAsset,
  type CheckoutDisposition,
  type CheckinDisposition,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  formatDateTime,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { BookingDetailSkeleton } from "@/components/skeleton-loader";
import { QuantityInputSheet } from "@/components/quantity-input-sheet";
import { QuantityBadge } from "@/components/quantity-badge";
import {
  CheckinDispositionSheet,
  type CheckinDispositionValue,
} from "@/components/checkin-disposition-sheet";
import { announce } from "@/lib/a11y";
import { maybeAskForReview } from "@/lib/review-prompt";

const bookingAssetKeyExtractor = (item: BookingAsset) => item.id;

/**
 * Booking-scoped lifecycle state for a QUANTITY_TRACKED asset row. The asset's
 * GLOBAL status ("Available") is meaningless on a booking — what matters is how
 * many of the booked units are reserved / checked out / returned. Derived from
 * the server's per-asset remaining counts. `key` indexes the shared
 * `bookingStatusBadge` colours so the row reuses the booking colour vocabulary
 * (blue reserved, orange in-progress, green complete).
 *
 * @param args - booked units, remaining-to-check-out/in, and the parent
 *   booking's status (to tell a DRAFT line apart from a reserved one).
 * @returns The badge `{ key, label }` for this asset on this booking.
 */
function getBookingAssetState({
  booked,
  remOut,
  remIn,
  bookingStatus,
}: {
  booked: number;
  remOut?: number;
  remIn?: number;
  bookingStatus: string;
}): { key: string; label: string } {
  const clampedOut = Math.min(Math.max(remOut ?? booked, 0), booked);
  const clampedIn = Math.min(Math.max(remIn ?? booked, 0), booked);
  const checkedOut = booked - clampedOut; // units taken from the workspace
  const checkedIn = booked - clampedIn; // units reconciled back in

  if (booked <= 0 || checkedOut <= 0) {
    return bookingStatus === "DRAFT"
      ? { key: "DRAFT", label: "Draft" }
      : { key: "RESERVED", label: "Reserved" };
  }
  if (checkedIn >= booked) return { key: "COMPLETE", label: "Returned" };
  if (checkedIn > 0)
    return { key: "ONGOING", label: `${checkedIn}/${booked} returned` };
  if (checkedOut >= booked) return { key: "ONGOING", label: "Checked out" };
  return { key: "ONGOING", label: `${checkedOut}/${booked} out` };
}

/**
 * Segment colours for the booking lifecycle progress bar. Fixed hues matched to
 * the web `BookingLifecycleProgress` component so the bar reads identically on
 * both platforms: booked = grey, partial = amber, fully out = violet,
 * returned = green.
 */
const LIFECYCLE_COLORS = {
  booked: "#D1D5DB",
  partial: "#F59E0B",
  out: "#7C3AED",
  returned: "#22C55E",
} as const;

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors, statusBadge, bookingStatusBadge } = useTheme();
  const styles = useStyles();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [checkedInAssetIds, setCheckedInAssetIds] = useState<string[]>([]);
  const [canCheckout, setCanCheckout] = useState(false);
  const [canCheckin, setCanCheckin] = useState(false);
  // False when the workspace requires explicit (scan/select) check-in for this
  // user's role — hide the quick "Check In All" button to match web policy.
  const [canQuickCheckin, setCanQuickCheckin] = useState(true);
  // Per-booking lifecycle-action availability (cancel/archive/duplicate/delete),
  // computed server-side mirroring the web ActionsDropdown gating.
  const [bookingActions, setBookingActions] = useState({
    canCancel: false,
    canArchive: false,
    canDuplicate: false,
    canDelete: false,
  });
  // Android overflow-menu visibility (iOS uses the native ActionSheetIOS).
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  // Mirrors the web's canUserManageBookingAssets: closed statuses reject;
  // self-service users may only build their own DRAFT bookings.
  const isSelfService = currentOrg?.roles?.includes("SELF_SERVICE") ?? false;
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For progressive check-in/check-out: selected assets
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set()
  );
  // Selection mode picks a subset of assets to act on. "checkin" selects
  // checked-out assets to return; "checkout" selects not-yet-out assets to take.
  // null = not selecting.
  const [selectMode, setSelectMode] = useState<
    "checkin" | "checkout" | "remove" | null
  >(null);
  const isSelectMode = selectMode !== null;

  // Sequential quantity picker for checking out QUANTITY_TRACKED assets: the
  // user selects the rows, then we walk each QT asset asking "how many units?"
  // (defaulting to all remaining), collect the dispositions, then submit.
  const [checkoutQueue, setCheckoutQueue] = useState<{
    queue: BookingAsset[];
    index: number;
    collected: CheckoutDisposition[];
    individualIds: string[];
  } | null>(null);

  // Sequential disposition picker for checking IN quantity-tracked assets:
  // walk each QT asset asking returned/consumed/lost/damaged, then submit.
  const [checkinQueue, setCheckinQueue] = useState<{
    queue: BookingAsset[];
    index: number;
    collected: CheckinDisposition[];
    individualIds: string[];
  } | null>(null);

  const lastFetchedAt = useRef(0);

  const fetchBooking = useCallback(async () => {
    if (!id || !currentOrg) return;
    const { data, error: fetchErr } = await api.booking(id, currentOrg.id);
    // Request cancelled (navigation) — ignore
    if (!data && !fetchErr) return;
    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load booking");
      return;
    }
    setError(null);
    setBooking(data.booking);
    setCheckedInAssetIds(data.checkedInAssetIds);
    setCanCheckout(data.canCheckout);
    setCanCheckin(data.canCheckin);
    setCanQuickCheckin(data.canQuickCheckin);
    setBookingActions(data.bookingActions);
    // Clear stale selections — checked-in assets are no longer selectable
    setSelectedAssetIds(new Set());
    lastFetchedAt.current = Date.now();
  }, [id, currentOrg]);

  // Stale-while-revalidate: refetch on focus if data is > 60s old — UNLESS
  // a flow that mutated this booking (e.g. scan-to-add) marked it dirty,
  // which must bypass the freshness gate.
  useFocusEffect(
    useCallback(() => {
      const mustRefresh = consumeBookingDirty(id);
      const age = Date.now() - lastFetchedAt.current;
      if (!mustRefresh && age < 60_000 && booking) return; // fresh enough
      setIsLoading(!booking); // show skeleton only on first load
      fetchBooking().finally(() => setIsLoading(false));
    }, [fetchBooking, booking, id])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    await fetchBooking();
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  const getTimeZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  };

  const handleCheckout = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Check Out",
      `Check out "${booking.name}"?\n\nAll ${booking.assetCount} assets will be marked as checked out.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check Out",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.checkoutBooking(
              currentOrg.id,
              booking.id,
              getTimeZone()
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Error", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            Alert.alert("Checked Out", `"${booking.name}" is now ongoing.`, [
              { text: "OK", onPress: () => fetchBooking() },
            ]);
          },
        },
      ]
    );
  };

  const handleFullCheckin = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Check In All",
      `Check in all assets for "${booking.name}"?\n\nAll remaining units will be returned and the booking completed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check In All",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.checkinBooking(
              currentOrg.id,
              booking.id,
              getTimeZone()
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Error", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            Alert.alert("Complete", `"${booking.name}" is now complete.`, [
              {
                text: "OK",
                onPress: () => {
                  fetchBooking();
                  // Fully checking a booking back in is a natural success
                  // moment — ask for a review (throttled, OS-gated).
                  void maybeAskForReview();
                },
              },
            ]);
          },
        },
      ]
    );
  };

  // Send the check-in. `assetIds` = INDIVIDUAL rows (a bare QT id would default
  // to all-remaining server-side); `checkins` = per-QT-asset dispositions.
  const submitCheckin = async (
    assetIds: string[],
    checkins: CheckinDisposition[]
  ) => {
    if (!booking || !currentOrg) return;
    setIsActioning(true);
    const { data, error: err } = await api.partialCheckinBooking(
      currentOrg.id,
      booking.id,
      assetIds,
      getTimeZone(),
      checkins.length > 0 ? checkins : undefined
    );
    setIsActioning(false);
    if (err) {
      Alert.alert("Error", err);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Mutation changed this booking — force the list to refetch.
    markBookingsListDirty();
    const msg = data?.isComplete
      ? `All assets checked in. "${booking.name}" is now complete.`
      : `${data?.checkedInCount ?? "Some"} checked in, ${
          data?.remainingCount ?? "some"
        } remaining.`;
    Alert.alert("Checked In", msg, [
      {
        text: "OK",
        onPress: () => {
          setSelectedAssetIds(new Set());
          setSelectMode(null);
          fetchBooking();
        },
      },
    ]);
  };

  const handlePartialCheckin = () => {
    if (!booking || !currentOrg || selectedAssetIds.size === 0) return;
    const selected = booking.assets.filter((a) => selectedAssetIds.has(a.id));
    // QT assets get a returned/consumed/lost/damaged split; INDIVIDUAL rows
    // just flip back to available. Checkinable = booked units still to
    // reconcile (remainingToCheckIn > 0), matching the web check-in drawer.
    const qtAssets = selected.filter(
      (a) => a.type === "QUANTITY_TRACKED" && (a.remainingToCheckIn ?? 0) > 0
    );
    const individualIds = selected
      .filter((a) => a.type !== "QUANTITY_TRACKED")
      .map((a) => a.id);
    if (qtAssets.length === 0) {
      // No disposition to collect (INDIVIDUAL-only, or the server didn't send
      // QT metadata) — keep the simple confirm + bare send.
      const count = selectedAssetIds.size;
      Alert.alert(
        "Check In Selected",
        `Check in ${count} selected ${count === 1 ? "asset" : "assets"}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Check In",
            onPress: () => void submitCheckin(individualIds, []),
          },
        ]
      );
      return;
    }
    // Walk each QT asset through the disposition picker before submitting.
    setCheckinQueue({
      queue: qtAssets,
      index: 0,
      collected: [],
      individualIds,
    });
  };

  // Send the check-out. `assetIds` = INDIVIDUAL rows (implicit 1 unit);
  // `checkouts` = per-QT-asset quantities the picker collected.
  const submitCheckout = async (
    assetIds: string[],
    checkouts: CheckoutDisposition[]
  ) => {
    if (!booking || !currentOrg) return;
    setIsActioning(true);
    const { data, error: err } = await api.partialCheckoutBooking(
      currentOrg.id,
      booking.id,
      assetIds,
      getTimeZone(),
      checkouts.length > 0 ? checkouts : undefined
    );
    setIsActioning(false);
    if (err) {
      Alert.alert("Error", err);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Mutation changed this booking — force the list to refetch.
    markBookingsListDirty();
    const msg = data?.isComplete
      ? `All assets are now checked out for "${booking.name}".`
      : `${data?.checkedOutCount ?? "Some"} checked out, ${
          data?.remainingCount ?? "some"
        } still reserved.`;
    Alert.alert("Checked Out", msg, [
      {
        text: "OK",
        onPress: () => {
          setSelectedAssetIds(new Set());
          setSelectMode(null);
          fetchBooking();
        },
      },
    ]);
  };

  const handlePartialCheckout = () => {
    if (!booking || !currentOrg || selectedAssetIds.size === 0) return;
    const selected = booking.assets.filter((a) => selectedAssetIds.has(a.id));
    // QT assets need an explicit quantity; INDIVIDUAL rows are implicit 1 unit.
    const qtAssets = selected.filter(
      (a) => a.type === "QUANTITY_TRACKED" && (a.remainingToCheckOut ?? 0) > 0
    );
    const individualIds = selected
      .filter((a) => a.type !== "QUANTITY_TRACKED")
      .map((a) => a.id);
    if (qtAssets.length === 0) {
      // No quantity to pick (INDIVIDUAL-only, or the server didn't send QT
      // metadata) — keep the simple confirm + bare send.
      const count = selectedAssetIds.size;
      Alert.alert(
        "Check Out Selected",
        `Check out ${count} selected ${count === 1 ? "asset" : "assets"}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Check Out",
            onPress: () => void submitCheckout(individualIds, []),
          },
        ]
      );
      return;
    }
    // Walk each QT asset through the quantity picker before submitting.
    setCheckoutQueue({
      queue: qtAssets,
      index: 0,
      collected: [],
      individualIds,
    });
  };

  const handleReserve = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Reserve Booking",
      `Reserve "${booking.name}"? This confirms the booking and checks for conflicts.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reserve",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.reserveBooking(
              currentOrg.id,
              booking.id,
              getTimeZone()
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Couldn't reserve", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            Alert.alert("Reserved", `"${booking.name}" is now reserved.`, [
              { text: "OK", onPress: () => fetchBooking() },
            ]);
          },
        },
      ]
    );
  };

  const handleRemoveAssets = () => {
    if (!booking || !currentOrg || selectedAssetIds.size === 0) return;
    const count = selectedAssetIds.size;
    Alert.alert(
      "Remove Selected",
      `Remove ${count} selected ${
        count === 1 ? "asset" : "assets"
      } from this booking?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.removeAssets(
              currentOrg.id,
              booking.id,
              Array.from(selectedAssetIds)
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Couldn't remove", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            setSelectedAssetIds(new Set());
            setSelectMode(null);
            fetchBooking();
          },
        },
      ]
    );
  };

  // ── Lifecycle actions (cancel / archive / delete / duplicate) ──────────
  // Each is permission/status-gated server-side AND only offered when the
  // detail endpoint's `bookingActions` flag says this role/status may use it.

  const handleCancel = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Cancel Booking",
      `Cancel "${booking.name}"? This releases its assets and can't be undone.`,
      [
        { text: "Keep booking", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.cancelBooking(
              currentOrg.id,
              booking.id
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Couldn't cancel", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            fetchBooking();
          },
        },
      ]
    );
  };

  const handleArchive = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Archive Booking",
      `Archive "${booking.name}"? It moves to your archived bookings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.archiveBooking(
              currentOrg.id,
              booking.id
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Couldn't archive", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            fetchBooking();
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Delete Booking",
      `Permanently delete "${booking.name}"? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setIsActioning(true);
            const { error: err } = await api.deleteBooking(
              currentOrg.id,
              booking.id
            );
            setIsActioning(false);
            if (err) {
              Alert.alert("Couldn't delete", err);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            // The booking no longer exists — leave the detail screen.
            router.back();
          },
        },
      ]
    );
  };

  const handleDuplicate = () => {
    if (!booking || !currentOrg) return;
    Alert.alert(
      "Duplicate Booking",
      `Create a copy of "${booking.name}" as a new draft you can edit?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Duplicate",
          onPress: async () => {
            setIsActioning(true);
            const { data: dup, error: err } = await api.duplicateBooking(
              currentOrg.id,
              booking.id
            );
            setIsActioning(false);
            if (err || !dup) {
              Alert.alert("Couldn't duplicate", err || "Please try again.");
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Mutation changed this booking — force the list to refetch.
            markBookingsListDirty();
            // Open the new draft's edit screen so the user can adjust dates etc.
            router.push(`/(tabs)/bookings/edit?id=${dup.booking.id}`);
          },
        },
      ]
    );
  };

  // Build the available lifecycle actions for the overflow menu. Order: the
  // non-destructive Duplicate first, destructive ones last.
  const lifecycleActions: {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    destructive: boolean;
    onPress: () => void;
  }[] = [];
  if (bookingActions.canDuplicate)
    lifecycleActions.push({
      key: "duplicate",
      label: "Duplicate booking",
      icon: "copy-outline",
      destructive: false,
      onPress: handleDuplicate,
    });
  if (bookingActions.canArchive)
    lifecycleActions.push({
      key: "archive",
      label: "Archive booking",
      icon: "archive-outline",
      destructive: false,
      onPress: handleArchive,
    });
  if (bookingActions.canCancel)
    lifecycleActions.push({
      key: "cancel",
      label: "Cancel booking",
      icon: "close-circle-outline",
      destructive: true,
      onPress: handleCancel,
    });
  if (bookingActions.canDelete)
    lifecycleActions.push({
      key: "delete",
      label: "Delete booking",
      icon: "trash-outline",
      destructive: true,
      onPress: handleDelete,
    });

  // Open the lifecycle overflow menu: native ActionSheet on iOS, custom modal
  // on Android (mirrors the asset detail's quick-actions overflow pattern).
  const openActionsMenu = () => {
    if (lifecycleActions.length === 0) return;
    if (Platform.OS === "ios") {
      const labels = lifecycleActions.map((a) => a.label);
      const destructiveButtonIndex = lifecycleActions
        .map((a, i) => (a.destructive ? i : -1))
        .filter((i) => i >= 0);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, "Cancel"],
          cancelButtonIndex: labels.length,
          destructiveButtonIndex,
          title: booking?.name,
        },
        (idx) => {
          if (idx < lifecycleActions.length) lifecycleActions[idx].onPress();
        }
      );
    } else {
      setShowActionsMenu(true);
    }
  };

  const toggleAssetSelection = useCallback((assetId: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const renderAsset = useCallback(
    ({ item }: { item: BookingAsset }) => {
      const fallbackBadge = {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };
      // QUANTITY_TRACKED rows get a booking-scoped state (reserved / N out /
      // returned) instead of the asset's global status, which is meaningless on
      // a booking. INDIVIDUAL rows keep the existing status badge.
      const qtState =
        item.type === "QUANTITY_TRACKED"
          ? getBookingAssetState({
              booked: item.quantity ?? 0,
              remOut: item.remainingToCheckOut,
              remIn: item.remainingToCheckIn,
              bookingStatus: booking?.status ?? "",
            })
          : null;
      const badge = qtState
        ? bookingStatusBadge[qtState.key] ?? fallbackBadge
        : statusBadge[item.status] ?? fallbackBadge;
      const stateLabel = qtState ? qtState.label : formatStatus(item.status);
      const isCheckedIn = checkedInAssetIds.includes(item.id);
      const isCheckedOut = item.status === "CHECKED_OUT";
      const isSelected = selectedAssetIds.has(item.id);
      // QUANTITY_TRACKED selectability is quantity-based, not status-based: a
      // partially-checked-out QT asset stays AVAILABLE while units remain, so
      // the global-status test wrongly excluded it. Check-in = booked units
      // still to reconcile (remainingToCheckIn, the SAME "remaining" the web
      // check-in drawer caps at); check-out = units still to take
      // (remainingToCheckOut).
      const isQt = item.type === "QUANTITY_TRACKED";
      const qtRemainingIn = isQt ? item.remainingToCheckIn ?? 0 : 0;
      const qtRemainingOut = isQt ? item.remainingToCheckOut ?? 0 : 0;
      // What's selectable depends on the mode. A returned INDIVIDUAL asset is
      // back to AVAILABLE, so `!isCheckedOut` alone would re-offer it for
      // check-out — exclude the already-returned ones with `!isCheckedIn`.
      const selectable =
        selectMode === "checkin"
          ? isQt
            ? qtRemainingIn > 0
            : isCheckedOut && !isCheckedIn
          : selectMode === "checkout"
          ? isQt
            ? qtRemainingOut > 0
            : !isCheckedOut && !isCheckedIn
          : selectMode === "remove"
          ? true
          : false;

      return (
        <TouchableOpacity
          style={[
            styles.assetCard,
            isSelected && styles.assetCardSelected,
            isCheckedIn && styles.assetCardCheckedIn,
          ]}
          activeOpacity={selectable ? 0.6 : 1}
          onPress={() => {
            if (selectable) {
              toggleAssetSelection(item.id);
            } else if (!isSelectMode) {
              pushIntoTab("/(tabs)/assets", `/(tabs)/assets/${item.id}`);
            }
          }}
          accessibilityLabel={`${item.title}, ${stateLabel}${
            isCheckedIn ? ", checked in" : ""
          }${isSelected ? ", selected" : ""}${
            selectable ? ". Tap to select" : ""
          }`}
          accessibilityRole="button"
        >
          {selectable && (
            <View
              style={[styles.checkbox, isSelected && styles.checkboxChecked]}
            >
              {isSelected && (
                <Ionicons
                  name="checkmark"
                  size={14}
                  color={colors.primaryForeground}
                />
              )}
            </View>
          )}

          {isCheckedIn && (
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={colors.success}
            />
          )}

          {item.mainImage ? (
            <Image
              source={{ uri: item.mainImage }}
              style={styles.assetImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.assetImage, styles.assetImagePlaceholder]}>
              <Ionicons name="cube-outline" size={18} color={colors.gray300} />
            </View>
          )}

          <View style={styles.assetInfo}>
            <Text style={styles.assetTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {item.type === "QUANTITY_TRACKED" && (
              <QuantityBadge
                value={item.quantity}
                unitOfMeasure={item.unitOfMeasure}
                label="booked"
              />
            )}
            {item.kit && (
              <Text style={styles.assetKit} numberOfLines={1}>
                Kit: {item.kit.name}
              </Text>
            )}
            {item.category && (
              <Text style={styles.assetCategory} numberOfLines={1}>
                {item.category.name}
              </Text>
            )}
          </View>

          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.text }]} />
            <Text style={[styles.statusText, { color: badge.text }]}>
              {stateLabel}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    // why: toggleAssetSelection is stable (defined via useCallback in this component)
    // and intentionally not listed; adding it would cause unnecessary row re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      checkedInAssetIds,
      selectMode,
      selectedAssetIds,
      router,
      colors,
      statusBadge,
      bookingStatusBadge,
      booking?.status,
      styles,
    ]
  );

  if (isLoading) {
    return <BookingDetailSkeleton />;
  }

  if (error || !booking) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.error} />
        <Text style={styles.emptyText}>{error || "Booking not found"}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onRefresh}
          accessibilityLabel="Retry loading booking"
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const bookingBadge = bookingStatusBadge[booking.status] ?? {
    bg: colors.backgroundTertiary,
    text: colors.muted,
  };

  const custodianName =
    booking.custodianTeamMember?.name ||
    [booking.custodianUser?.firstName, booking.custodianUser?.lastName]
      .filter(Boolean)
      .join(" ") ||
    null;

  // Lifecycle counts for the progress bar: every asset is in exactly one of three
  // states. `checkedOutCount` (status === CHECKED_OUT) already EXCLUDES returned
  // assets — partial check-in flips them back to AVAILABLE — so it IS the live
  // "on job" count, and returns are subtracted from the reserved bucket (not from
  // checkedOutCount again, which would double-count them).
  const checkedInCount = checkedInAssetIds.length; // returned
  const onJobCount = booking.checkedOutCount; // still out
  const reservedCount = Math.max(
    0,
    booking.assetCount - onJobCount - checkedInCount
  ); // never checked out
  // Only show the bar once there's check-out activity — otherwise it's a flat,
  // single-colour bar that adds noise to a freshly-reserved booking.
  const showProgress =
    booking.assetCount > 0 &&
    (booking.checkedOutCount > 0 ||
      checkedInCount > 0 ||
      ["ONGOING", "OVERDUE", "COMPLETE"].includes(booking.status));
  // Segmented lifecycle progress from the server's shared helper (identical
  // numbers to the web bar). Guarded so an older server (field absent) simply
  // omits the card rather than crashing.
  const lp = booking.lifecycleProgress ?? null;

  // Book-by-model reservations still awaiting assignment. Fulfilled rows
  // (`fulfilledAt` set) are hidden here — the concrete assets they became
  // already appear in the assets list, so showing them too would double up.
  // Mirrors the web booking overview (booking-assets-column.tsx). The `?? []`
  // matches the web guard + this file's cross-version convention: a booking
  // detail from a not-yet-updated server (rolling deploy) omits the field, and
  // an unguarded `.filter` would crash the whole screen to the error boundary.
  const outstandingModelRequests = (booking.modelRequests ?? []).filter(
    (mr) => mr.fulfilledAt === null
  );
  // A booking with unfulfilled model reservations can't be checked out at all
  // (full OR partial): the shared checkout service hard-blocks RESERVED →
  // ONGOING until every request is assigned to concrete assets. So gate BOTH
  // checkout paths on this — the app surfaces an "Assign to check out" CTA
  // instead of a checkout the server would reject. (`canCheckout` from the
  // loader already accounts for this; `canPartialCheckout` is derived here.)
  const hasOutstandingModelRequests = outstandingModelRequests.length > 0;

  // Progressive check-out stays available while the booking is active AND still
  // holds never-checked-out assets. The server (`partialCheckoutBooking`) accepts
  // RESERVED/ONGOING/OVERDUE, but the loader's `canCheckout` is RESERVED-only (it
  // gates the full "Check Out All" button), so we derive our own flag for the
  // partial path — otherwise "Select to Check Out" disappears the moment the
  // first batch flips the booking to ONGOING.
  const canPartialCheckout =
    reservedCount > 0 &&
    !hasOutstandingModelRequests &&
    ["RESERVED", "ONGOING", "OVERDUE"].includes(booking.status);

  // Same gate the manage buttons use: an editable booking, and self-service
  // users only on their own DRAFTs (server re-checks ownership + status).
  const canManageModels =
    !["COMPLETE", "ARCHIVED", "CANCELLED"].includes(booking.status) &&
    (!isSelfService || booking.status === "DRAFT");

  /**
   * Open the model-reservation manager (the picker's Models tab) for this
   * booking. Editing quantity / adding / removing all live there so the
   * availability cap is computed in one place.
   */
  const openModelManager = () => {
    router.push(
      `/(tabs)/bookings/add-assets?bookingId=${
        booking.id
      }&bookingName=${encodeURIComponent(
        booking.name
      )}&from=${encodeURIComponent(booking.from)}&to=${encodeURIComponent(
        booking.to
      )}&mode=models`
    );
  };

  return (
    <View style={styles.container}>
      {isActioning && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      <FlatList
        data={booking.assets}
        renderItem={renderAsset}
        keyExtractor={bookingAssetKeyExtractor}
        contentContainerStyle={styles.list}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.muted}
            accessibilityLabel="Pull to refresh"
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Booking info card */}
            <View style={styles.infoCard}>
              <View style={styles.infoHeader}>
                <Text style={styles.bookingName}>{booking.name}</Text>
                <View
                  style={[
                    styles.statusBadgeLg,
                    { backgroundColor: bookingBadge.bg },
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: bookingBadge.text },
                    ]}
                  />
                  <Text
                    style={[styles.statusTextLg, { color: bookingBadge.text }]}
                  >
                    {formatStatus(booking.status)}
                  </Text>
                </View>
              </View>

              {booking.description ? (
                <Text style={styles.description} numberOfLines={3}>
                  {booking.description}
                </Text>
              ) : null}

              <View style={styles.infoRows}>
                <View style={styles.infoRow}>
                  <Ionicons
                    name="calendar-outline"
                    size={15}
                    color={colors.muted}
                  />
                  <Text style={styles.infoLabel}>Period</Text>
                  <Text style={styles.infoValue}>
                    {formatDateTime(booking.from)} →{" "}
                    {formatDateTime(booking.to)}
                  </Text>
                </View>

                <View style={styles.infoRow}>
                  <Ionicons
                    name="cube-outline"
                    size={15}
                    color={colors.muted}
                  />
                  <Text style={styles.infoLabel}>Assets</Text>
                  <Text style={styles.infoValue}>
                    {booking.assetCount} total
                    {booking.checkedOutCount > 0 &&
                      `, ${booking.checkedOutCount} checked out`}
                    {/* Book-by-model: surface reserved-but-not-yet-assigned
                        units so "0 total" never reads as an empty booking when
                        it actually holds a reservation. */}
                    {booking.outstandingModelUnitCount > 0 &&
                      `, ${booking.outstandingModelUnitCount} reserved`}
                  </Text>
                </View>

                {custodianName && (
                  <View style={styles.infoRow}>
                    <Ionicons
                      name="person-outline"
                      size={15}
                      color={colors.muted}
                    />
                    <Text style={styles.infoLabel}>Custodian</Text>
                    <Text style={styles.infoValue}>{custodianName}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Lifecycle progress: reserved → out → returned (single bar) */}
            {showProgress && lp && (
              <View style={styles.progressCard}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressTitle}>
                    {lp.bookedCount > 0
                      ? "Check-out progress"
                      : "Check-in progress"}
                  </Text>
                  <Text style={styles.progressCount}>
                    {lp.bookedCount > 0
                      ? lp.checkoutProgressCount
                      : lp.checkinProgressCount}{" "}
                    / {lp.totalUnits}
                  </Text>
                </View>
                <View
                  style={styles.progressBar}
                  accessibilityLabel={`${lp.bookedCount} booked, ${lp.partialCount} partial, ${lp.checkedOutCount} fully out, ${lp.returnedCount} returned, of ${lp.totalUnits}`}
                >
                  {lp.bookedCount > 0 && (
                    <View
                      style={{
                        flex: lp.bookedCount,
                        backgroundColor: LIFECYCLE_COLORS.booked,
                      }}
                    />
                  )}
                  {lp.partialCount > 0 && (
                    <View
                      style={{
                        flex: lp.partialCount,
                        backgroundColor: LIFECYCLE_COLORS.partial,
                      }}
                    />
                  )}
                  {lp.checkedOutCount > 0 && (
                    <View
                      style={{
                        flex: lp.checkedOutCount,
                        backgroundColor: LIFECYCLE_COLORS.out,
                      }}
                    />
                  )}
                  {lp.returnedCount > 0 && (
                    <View
                      style={{
                        flex: lp.returnedCount,
                        backgroundColor: LIFECYCLE_COLORS.returned,
                      }}
                    />
                  )}
                </View>
                <View style={styles.progressLegend}>
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: LIFECYCLE_COLORS.booked },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      Booked {lp.bookedCount}
                    </Text>
                  </View>
                  {lp.partialCount > 0 && (
                    <View style={styles.legendItem}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: LIFECYCLE_COLORS.partial },
                        ]}
                      />
                      <Text style={styles.legendText}>
                        Partial {lp.partialCount}
                      </Text>
                    </View>
                  )}
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: LIFECYCLE_COLORS.out },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      Fully out {lp.checkedOutCount}
                    </Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: LIFECYCLE_COLORS.returned },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      Returned {lp.returnedCount}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Action buttons */}
            {!["COMPLETE", "ARCHIVED", "CANCELLED"].includes(
              booking.status
            ) && (
              <View style={styles.manageRow}>
                <TouchableOpacity
                  style={[styles.actionButtonOutline, styles.manageRowItem]}
                  onPress={() =>
                    router.push(`/(tabs)/bookings/edit?id=${booking.id}`)
                  }
                  accessibilityLabel="Edit booking"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="create-outline"
                    size={18}
                    color={colors.buttonSecondaryText}
                  />
                  <Text style={styles.actionButtonOutlineText}>Edit</Text>
                </TouchableOpacity>

                {booking.status === "DRAFT" && (
                  <TouchableOpacity
                    style={[styles.actionButton, styles.manageRowItem]}
                    onPress={handleReserve}
                    accessibilityLabel="Reserve this booking"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="checkmark-done-outline"
                      size={18}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.actionButtonText}>Reserve</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* More lifecycle actions (duplicate / archive / cancel / delete).
                Shows for ANY status — including closed ones (Archive on
                COMPLETE, Duplicate always) — gated by server-computed flags. */}
            {lifecycleActions.length > 0 && (
              <TouchableOpacity
                style={styles.actionButtonOutline}
                onPress={openActionsMenu}
                accessibilityLabel="More booking actions"
                accessibilityRole="button"
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={18}
                  color={colors.buttonSecondaryText}
                />
                <Text style={styles.actionButtonOutlineText}>More actions</Text>
              </TouchableOpacity>
            )}

            {booking &&
              !["COMPLETE", "ARCHIVED", "CANCELLED"].includes(booking.status) &&
              (!isSelfService || booking.status === "DRAFT") && (
                <TouchableOpacity
                  style={styles.actionButtonOutline}
                  onPress={() =>
                    router.push(
                      `/(tabs)/scanner?bookingId=${
                        booking.id
                      }&bookingName=${encodeURIComponent(
                        booking.name
                      )}&bookingAction=add`
                    )
                  }
                  accessibilityLabel="Scan assets or kits to add to this booking"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="scan"
                    size={18}
                    color={colors.buttonSecondaryText}
                  />
                  <Text style={styles.actionButtonOutlineText}>
                    Scan to Add Assets
                  </Text>
                </TouchableOpacity>
              )}

            {/* Browse available assets/kits to add (date-aware picker) */}
            {!["COMPLETE", "ARCHIVED", "CANCELLED"].includes(booking.status) &&
              (!isSelfService || booking.status === "DRAFT") && (
                <TouchableOpacity
                  style={styles.actionButtonOutline}
                  onPress={() =>
                    router.push(
                      `/(tabs)/bookings/add-assets?bookingId=${
                        booking.id
                      }&bookingName=${encodeURIComponent(
                        booking.name
                      )}&from=${encodeURIComponent(
                        booking.from
                      )}&to=${encodeURIComponent(booking.to)}`
                    )
                  }
                  accessibilityLabel="Browse available assets and kits to add"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="search"
                    size={18}
                    color={colors.buttonSecondaryText}
                  />
                  <Text style={styles.actionButtonOutlineText}>
                    Browse to Add
                  </Text>
                </TouchableOpacity>
              )}

            {/* Select assets to remove (editable bookings with assets) */}
            {!["COMPLETE", "ARCHIVED", "CANCELLED"].includes(booking.status) &&
              (!isSelfService || booking.status === "DRAFT") &&
              booking.assetCount > 0 && (
                <TouchableOpacity
                  style={[
                    styles.actionButtonOutline,
                    selectMode === "remove" && styles.actionButtonOutlineActive,
                  ]}
                  onPress={() => {
                    setSelectMode(selectMode === "remove" ? null : "remove");
                    setSelectedAssetIds(new Set());
                  }}
                  accessibilityLabel={
                    selectMode === "remove"
                      ? "Cancel selection"
                      : "Select assets to remove"
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={selectMode === "remove" ? "close" : "trash-outline"}
                    size={18}
                    color={
                      selectMode === "remove"
                        ? colors.error
                        : colors.buttonSecondaryText
                    }
                  />
                  <Text
                    style={[
                      styles.actionButtonOutlineText,
                      selectMode === "remove" && { color: colors.error },
                    ]}
                  >
                    {selectMode === "remove" ? "Cancel" : "Select to Remove"}
                  </Text>
                </TouchableOpacity>
              )}

            {/* Full check-out is RESERVED-only (web parity); the loader's
                canCheckout reflects that. */}
            {canCheckout && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleCheckout}
                accessibilityLabel="Check out all assets in this booking"
                accessibilityRole="button"
              >
                <Ionicons
                  name="log-out-outline"
                  size={18}
                  color={colors.primaryForeground}
                />
                <Text style={styles.actionButtonText}>
                  Check Out All Assets
                </Text>
              </TouchableOpacity>
            )}

            {/* Progressive check-out persists while reserved assets remain, even
                after the booking has gone ONGOING (canPartialCheckout, not
                canCheckout) so the user can keep taking the rest. */}
            {canPartialCheckout && (
              <TouchableOpacity
                style={[
                  styles.actionButtonOutline,
                  selectMode === "checkout" && styles.actionButtonOutlineActive,
                ]}
                onPress={() => {
                  setSelectMode(selectMode === "checkout" ? null : "checkout");
                  setSelectedAssetIds(new Set());
                }}
                accessibilityLabel={
                  selectMode === "checkout"
                    ? "Cancel selection"
                    : "Select assets to check out"
                }
                accessibilityRole="button"
              >
                <Ionicons
                  name={
                    selectMode === "checkout" ? "close" : "checkbox-outline"
                  }
                  size={18}
                  color={
                    selectMode === "checkout"
                      ? colors.error
                      : colors.buttonSecondaryText
                  }
                />
                <Text
                  style={[
                    styles.actionButtonOutlineText,
                    selectMode === "checkout" && { color: colors.error },
                  ]}
                >
                  {selectMode === "checkout" ? "Cancel" : "Select to Check Out"}
                </Text>
              </TouchableOpacity>
            )}

            {/* Book-by-model: a RESERVED booking with unfulfilled reservations
                has no checkout button (the server hard-blocks checkout until
                every reserved unit is assigned to a concrete asset). Instead of
                a dead-end, point the operator straight at the assign step — the
                actual path to checkout — mirroring web's fulfil-and-checkout.
                Gated `!isSelfService` to match the add/browse affordances above:
                a self-service custodian can only edit a DRAFT booking, and the
                mobile add-scanned-assets action rejects their non-DRAFT edits,
                so on a RESERVED booking the assign flow can't succeed for them —
                showing the CTA would just lead to a rejected submit. */}
            {!isSelfService &&
              booking.status === "RESERVED" &&
              hasOutstandingModelRequests && (
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() =>
                    router.push(
                      `/(tabs)/bookings/add-assets?bookingId=${
                        booking.id
                      }&bookingName=${encodeURIComponent(
                        booking.name
                      )}&from=${encodeURIComponent(
                        booking.from
                      )}&to=${encodeURIComponent(booking.to)}`
                    )
                  }
                  accessibilityLabel={`Assign ${booking.outstandingModelUnitCount} reserved units to check out`}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="cube-outline"
                    size={18}
                    color={colors.primaryForeground}
                  />
                  <Text style={styles.actionButtonText}>
                    Assign {booking.outstandingModelUnitCount} unit
                    {booking.outstandingModelUnitCount === 1 ? "" : "s"} to
                    check out
                  </Text>
                </TouchableOpacity>
              )}

            {canCheckin && (
              <View style={styles.checkinActions}>
                {/* Quick "Check In All" is hidden when the workspace requires
                    explicit check-in for this role — the scan/select paths
                    below remain (they ARE explicit check-in). Mirrors web's
                    CheckinDropdown, which offers this "Quick check-in" (full
                    checkinBooking = return all remaining) on any ongoing
                    booking, partial included. */}
                {canQuickCheckin && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={handleFullCheckin}
                    accessibilityLabel="Check in all assets"
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="log-in-outline"
                      size={18}
                      color={colors.primaryForeground}
                    />
                    <Text style={styles.actionButtonText}>Check In All</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.actionButtonOutline}
                  onPress={() =>
                    router.push(
                      `/(tabs)/scanner?bookingId=${
                        booking.id
                      }&bookingName=${encodeURIComponent(booking.name)}`
                    )
                  }
                  accessibilityLabel="Scan assets to check in"
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="scan"
                    size={18}
                    color={colors.buttonSecondaryText}
                  />
                  <Text style={styles.actionButtonOutlineText}>
                    Scan to Check In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionButtonOutline,
                    selectMode === "checkin" &&
                      styles.actionButtonOutlineActive,
                  ]}
                  onPress={() => {
                    setSelectMode(selectMode === "checkin" ? null : "checkin");
                    setSelectedAssetIds(new Set());
                  }}
                  accessibilityLabel={
                    selectMode === "checkin"
                      ? "Cancel selection"
                      : "Select assets to check in"
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={
                      selectMode === "checkin" ? "close" : "checkbox-outline"
                    }
                    size={18}
                    color={
                      selectMode === "checkin"
                        ? colors.error
                        : colors.buttonSecondaryText
                    }
                  />
                  <Text
                    style={[
                      styles.actionButtonOutlineText,
                      selectMode === "checkin" && { color: colors.error },
                    ]}
                  >
                    {selectMode === "checkin" ? "Cancel" : "Select to Check In"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Reserved models (book-by-model): outstanding reservations that
                still need assets assigned via scan/browse. Shown above the
                assets list, matching the web booking overview. */}
            {outstandingModelRequests.length > 0 && (
              <View style={styles.modelsSection}>
                <View style={styles.modelsSectionHeader}>
                  <Text style={styles.sectionTitle}>
                    Reserved models ({outstandingModelRequests.length})
                  </Text>
                  {canManageModels && (
                    <TouchableOpacity
                      onPress={openModelManager}
                      accessibilityLabel="Manage reserved models"
                      accessibilityRole="button"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.modelsManageLink}>Manage</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {booking.outstandingModelUnitCount > 0 && (
                  <Text style={styles.modelsSubtitle}>
                    {booking.outstandingModelUnitCount} unit
                    {booking.outstandingModelUnitCount === 1 ? "" : "s"} still
                    to assign. Scan or browse to add matching assets.
                  </Text>
                )}
                {outstandingModelRequests.map((mr) => {
                  const remaining = mr.outstandingQuantity;
                  const row = (
                    <>
                      <View
                        style={[
                          styles.modelIcon,
                          { backgroundColor: colors.warningBg },
                        ]}
                      >
                        <Ionicons
                          name="cube-outline"
                          size={18}
                          color={colors.warning}
                        />
                      </View>
                      <View style={styles.modelInfo}>
                        <Text style={styles.modelName} numberOfLines={1}>
                          {mr.assetModelName}
                        </Text>
                        <View
                          style={[
                            styles.modelBadge,
                            { backgroundColor: colors.warningBg },
                          ]}
                        >
                          <Text
                            style={[
                              styles.modelBadgeText,
                              { color: colors.warning },
                            ]}
                          >
                            Reserved model
                          </Text>
                        </View>
                        {mr.fulfilledQuantity > 0 && (
                          <Text style={styles.modelProgress}>
                            {mr.fulfilledQuantity} of {mr.quantity} assigned
                          </Text>
                        )}
                      </View>
                      <Text style={styles.modelQty}>× {remaining}</Text>
                      {canManageModels && (
                        <Ionicons
                          name="chevron-forward"
                          size={18}
                          color={colors.muted}
                        />
                      )}
                    </>
                  );
                  return canManageModels ? (
                    <TouchableOpacity
                      key={mr.id}
                      style={styles.modelCard}
                      onPress={openModelManager}
                      accessibilityRole="button"
                      accessibilityLabel={`${mr.assetModelName}, ${remaining} reserved and awaiting assignment. Tap to manage.`}
                    >
                      {row}
                    </TouchableOpacity>
                  ) : (
                    <View
                      key={mr.id}
                      style={styles.modelCard}
                      accessibilityLabel={`${mr.assetModelName}, ${remaining} reserved and awaiting assignment`}
                    >
                      {row}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Assets section header */}
            <Text style={styles.sectionTitle}>
              Assets ({booking.assetCount})
            </Text>
          </View>
        }
      />

      {/* Floating progressive check-in / check-out button */}
      {isSelectMode && selectedAssetIds.size > 0 && (
        <View style={styles.floatingAction}>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={
              selectMode === "checkout"
                ? handlePartialCheckout
                : selectMode === "remove"
                ? handleRemoveAssets
                : handlePartialCheckin
            }
            accessibilityLabel={`${
              selectMode === "checkout"
                ? "Check out"
                : selectMode === "remove"
                ? "Remove"
                : "Check in"
            } ${selectedAssetIds.size} selected assets`}
            accessibilityRole="button"
          >
            <Ionicons
              name={
                selectMode === "checkout"
                  ? "log-out-outline"
                  : selectMode === "remove"
                  ? "trash-outline"
                  : "log-in-outline"
              }
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.floatingButtonText}>
              {selectMode === "checkout"
                ? "Check Out"
                : selectMode === "remove"
                ? "Remove"
                : "Check In"}{" "}
              {selectedAssetIds.size}{" "}
              {selectedAssetIds.size === 1 ? "Asset" : "Assets"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Lifecycle actions overflow (Android; iOS uses ActionSheetIOS) ── */}
      <Modal
        visible={showActionsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionsMenu(false)}
      >
        <TouchableOpacity
          style={styles.overflowBackdrop}
          activeOpacity={1}
          onPress={() => setShowActionsMenu(false)}
        >
          <View style={styles.overflowMenu} accessibilityViewIsModal={true}>
            {lifecycleActions.map((a) => (
              <TouchableOpacity
                key={a.key}
                style={styles.overflowItem}
                onPress={() => {
                  setShowActionsMenu(false);
                  a.onPress();
                }}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <Ionicons
                  name={a.icon}
                  size={20}
                  color={a.destructive ? colors.error : colors.foreground}
                />
                <Text
                  style={
                    a.destructive
                      ? styles.overflowItemTextDanger
                      : styles.overflowItemText
                  }
                >
                  {a.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Check-out quantity picker — walks the selected QT assets one at a
          time, defaulting to "all remaining" so one tap takes the whole line. */}
      {checkoutQueue && (
        <QuantityInputSheet
          // Remount per asset so the sheet's reset effect (keyed on
          // max/defaultValue) can't reuse the previous asset's typed value when
          // two consecutive queued assets share the same remaining quantity.
          key={checkoutQueue.queue[checkoutQueue.index].id}
          visible
          title="Check out"
          subtitle={`How many of ${
            checkoutQueue.queue[checkoutQueue.index].title
          } are you taking?`}
          max={
            checkoutQueue.queue[checkoutQueue.index].remainingToCheckOut ?? 1
          }
          defaultValue={
            checkoutQueue.queue[checkoutQueue.index].remainingToCheckOut ?? 1
          }
          unitOfMeasure={checkoutQueue.queue[checkoutQueue.index].unitOfMeasure}
          confirmLabel={
            checkoutQueue.index + 1 < checkoutQueue.queue.length
              ? "Next"
              : "Check out"
          }
          onSubmit={(quantity) => {
            const cur = checkoutQueue.queue[checkoutQueue.index];
            const collected = [
              ...checkoutQueue.collected,
              { assetId: cur.id, quantity },
            ];
            if (checkoutQueue.index + 1 < checkoutQueue.queue.length) {
              setCheckoutQueue({
                ...checkoutQueue,
                index: checkoutQueue.index + 1,
                collected,
              });
            } else {
              const { individualIds } = checkoutQueue;
              setCheckoutQueue(null);
              void submitCheckout(individualIds, collected);
            }
          }}
          onClose={() => setCheckoutQueue(null)}
        />
      )}

      {/* Check-in disposition picker — walks the selected QT assets one at a
          time, asking returned / consumed / lost / damaged per asset. */}
      {checkinQueue && (
        <CheckinDispositionSheet
          // Remount per asset so the sheet's reset effect (keyed on
          // remaining/consumptionType) can't carry the previous asset's typed
          // disposition into the next queued asset that shares the same values.
          key={checkinQueue.queue[checkinQueue.index].id}
          visible
          assetTitle={checkinQueue.queue[checkinQueue.index].title}
          // Cap the picker to booked units still to reconcile
          // (remainingToCheckIn = booked − returned/consumed/lost/damaged), the
          // SAME "remaining" the web check-in drawer uses.
          remaining={
            checkinQueue.queue[checkinQueue.index].remainingToCheckIn ?? 1
          }
          consumptionType={
            checkinQueue.queue[checkinQueue.index].consumptionType
          }
          unitOfMeasure={checkinQueue.queue[checkinQueue.index].unitOfMeasure}
          isLast={checkinQueue.index + 1 >= checkinQueue.queue.length}
          onSubmit={(value: CheckinDispositionValue) => {
            const cur = checkinQueue.queue[checkinQueue.index];
            const collected = [
              ...checkinQueue.collected,
              {
                assetId: cur.id,
                returned: value.returned,
                consumed: value.consumed,
                lost: value.lost,
                damaged: value.damaged,
              },
            ];
            if (checkinQueue.index + 1 < checkinQueue.queue.length) {
              setCheckinQueue({
                ...checkinQueue,
                index: checkinQueue.index + 1,
                collected,
              });
            } else {
              const { individualIds } = checkinQueue;
              setCheckinQueue(null);
              void submitCheckin(individualIds, collected);
            }
          }}
          onClose={() => setCheckinQueue(null)}
        />
      )}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayDark,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },

  // Header section
  header: {
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },

  // Info card
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },

  // Lifecycle progress bar
  progressCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  progressCount: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  progressBar: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.backgroundTertiary,
  },
  progressLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  infoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  bookingName: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: "700",
    color: colors.foreground,
  },
  description: {
    fontSize: fontSize.base,
    color: colors.muted,
    lineHeight: 20,
  },
  infoRows: {
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  infoLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    width: 70,
  },
  infoValue: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: "500",
  },

  // Status badges
  statusBadgeLg: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.pill,
    gap: 5,
  },
  statusTextLg: {
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "500",
  },

  // Action buttons
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
    ...shadows.sm,
  },
  actionButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
  checkinActions: {
    gap: spacing.sm,
  },
  // Lifecycle actions overflow menu (Android)
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  overflowItemText: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  overflowItemTextDanger: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.error,
  },
  manageRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  manageRowItem: {
    flex: 1,
  },
  actionButtonOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.buttonSecondaryBorder,
    gap: spacing.sm,
  },
  actionButtonOutlineActive: {
    borderColor: colors.error,
  },
  actionButtonOutlineText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.buttonSecondaryText,
  },

  // Section
  sectionTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    marginTop: spacing.xs,
  },

  // Reserved-models (book-by-model) section
  modelsSection: {
    gap: spacing.sm,
  },
  modelsSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modelsManageLink: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primary,
    marginTop: spacing.xs,
  },
  modelsSubtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 16,
  },
  modelCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  modelIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  modelInfo: {
    flex: 1,
    gap: 3,
  },
  modelName: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  modelBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
  },
  modelBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
  modelProgress: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  modelQty: {
    fontSize: fontSize.base,
    fontWeight: "700",
    color: colors.foreground,
  },

  // Asset cards
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  assetCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  assetCardCheckedIn: {
    opacity: 0.6,
  },
  assetImage: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
  },
  assetImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  assetInfo: {
    flex: 1,
    gap: 2,
  },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetKit: {
    fontSize: fontSize.xs,
    color: colors.checkedOut,
  },
  assetCategory: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },

  // Checkbox for selection
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.gray300,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  // Floating action
  floatingAction: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.md,
  },
  floatingButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  floatingButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },

  // Empty / error
  emptyText: {
    fontSize: fontSize.base,
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
}));
