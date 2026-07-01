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
import { api, type BookingDetail, type BookingAsset } from "@/lib/api";
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
import { announce } from "@/lib/a11y";
import { maybeAskForReview } from "@/lib/review-prompt";

const bookingAssetKeyExtractor = (item: BookingAsset) => item.id;

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
      `Check in all assets for "${booking.name}"?\n\nAll ${booking.checkedOutCount} checked-out assets will be returned.`,
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

  const handlePartialCheckin = () => {
    if (!booking || !currentOrg || selectedAssetIds.size === 0) return;
    const count = selectedAssetIds.size;
    Alert.alert(
      "Check In Selected",
      `Check in ${count} selected ${count === 1 ? "asset" : "assets"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check In",
          onPress: async () => {
            setIsActioning(true);
            const { data, error: err } = await api.partialCheckinBooking(
              currentOrg.id,
              booking.id,
              Array.from(selectedAssetIds),
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
            const msg = data?.isComplete
              ? `All assets checked in. "${booking.name}" is now complete.`
              : `${data?.checkedInCount ?? count} checked in, ${
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
          },
        },
      ]
    );
  };

  const handlePartialCheckout = () => {
    if (!booking || !currentOrg || selectedAssetIds.size === 0) return;
    const count = selectedAssetIds.size;
    Alert.alert(
      "Check Out Selected",
      `Check out ${count} selected ${count === 1 ? "asset" : "assets"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Check Out",
          onPress: async () => {
            setIsActioning(true);
            const { data, error: err } = await api.partialCheckoutBooking(
              currentOrg.id,
              booking.id,
              Array.from(selectedAssetIds),
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
            const msg = data?.isComplete
              ? `All assets are now checked out for "${booking.name}".`
              : `${data?.checkedOutCount ?? count} checked out, ${
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
          },
        },
      ]
    );
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
      const badge = statusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };
      const isCheckedIn = checkedInAssetIds.includes(item.id);
      const isCheckedOut = item.status === "CHECKED_OUT";
      const isSelected = selectedAssetIds.has(item.id);
      // What's selectable depends on the mode: returning checked-out assets
      // (check-in) vs. taking never-checked-out assets (check-out). A returned
      // asset is back to AVAILABLE, so `!isCheckedOut` alone would re-offer it
      // for check-out — exclude the already-returned ones with `!isCheckedIn`.
      const selectable =
        selectMode === "checkin"
          ? isCheckedOut && !isCheckedIn
          : selectMode === "checkout"
          ? !isCheckedOut && !isCheckedIn
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
          accessibilityLabel={`${item.title}, ${formatStatus(item.status)}${
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
              {formatStatus(item.status)}
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

  // Progressive check-out stays available while the booking is active AND still
  // holds never-checked-out assets. The server (`partialCheckoutBooking`) accepts
  // RESERVED/ONGOING/OVERDUE, but the loader's `canCheckout` is RESERVED-only (it
  // gates the full "Check Out All" button), so we derive our own flag for the
  // partial path — otherwise "Select to Check Out" disappears the moment the
  // first batch flips the booking to ONGOING.
  const canPartialCheckout =
    reservedCount > 0 &&
    ["RESERVED", "ONGOING", "OVERDUE"].includes(booking.status);

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
            {showProgress && (
              <View style={styles.progressCard}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressTitle}>Check-out progress</Text>
                  <Text style={styles.progressCount}>
                    {checkedInCount}/{booking.assetCount} returned
                  </Text>
                </View>
                <View
                  style={styles.progressBar}
                  accessibilityLabel={`${reservedCount} reserved, ${onJobCount} checked out, ${checkedInCount} returned`}
                >
                  {reservedCount > 0 && (
                    <View
                      style={{
                        flex: reservedCount,
                        backgroundColor: colors.backgroundTertiary,
                      }}
                    />
                  )}
                  {onJobCount > 0 && (
                    <View
                      style={{
                        flex: onJobCount,
                        backgroundColor: colors.primary,
                      }}
                    />
                  )}
                  {checkedInCount > 0 && (
                    <View
                      style={{
                        flex: checkedInCount,
                        backgroundColor: colors.success,
                      }}
                    />
                  )}
                </View>
                <View style={styles.progressLegend}>
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: colors.backgroundTertiary },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      {reservedCount} reserved
                    </Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: colors.primary },
                      ]}
                    />
                    <Text style={styles.legendText}>{onJobCount} out</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: colors.success },
                      ]}
                    />
                    <Text style={styles.legendText}>
                      {checkedInCount} returned
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

            {canCheckin && (
              <View style={styles.checkinActions}>
                {/* Quick "Check In All" is hidden when the workspace requires
                    explicit check-in for this role — the scan/select paths
                    below remain (they ARE explicit check-in). Mirrors web. */}
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
