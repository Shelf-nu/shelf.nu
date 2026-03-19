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
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import {
  api,
  type BookingDetail,
  type BookingAsset,
  type BookingDetailResponse,
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
import { announce } from "@/lib/a11y";

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
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For partial check-in: selected assets
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set()
  );
  const [isSelectMode, setIsSelectMode] = useState(false);

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
    lastFetchedAt.current = Date.now();
  }, [id, currentOrg]);

  // Stale-while-revalidate: refetch on focus if data is > 60s old
  useFocusEffect(
    useCallback(() => {
      const age = Date.now() - lastFetchedAt.current;
      if (age < 60_000 && booking) return; // fresh enough
      setIsLoading(!booking); // show skeleton only on first load
      fetchBooking().finally(() => setIsLoading(false));
    }, [fetchBooking, booking])
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
            const { data, error: err } = await api.checkoutBooking(
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
            const { data, error: err } = await api.checkinBooking(
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
            Alert.alert("Complete", `"${booking.name}" is now complete.`, [
              { text: "OK", onPress: () => fetchBooking() },
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
            const msg = data?.isComplete
              ? `All assets checked in. "${booking.name}" is now complete.`
              : `${data?.checkedInCount} checked in, ${data?.remainingCount} remaining.`;
            Alert.alert("Checked In", msg, [
              {
                text: "OK",
                onPress: () => {
                  setSelectedAssetIds(new Set());
                  setIsSelectMode(false);
                  fetchBooking();
                },
              },
            ]);
          },
        },
      ]
    );
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
      const selectable = isSelectMode && isCheckedOut && !isCheckedIn;

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
              router.push(`/(tabs)/assets/${item.id}`);
            }
          }}
          accessibilityLabel={`${item.title}, ${formatStatus(item.status)}${
            isCheckedIn ? ", checked in" : ""
          }${isSelected ? ", selected" : ""}${
            selectable ? ". Tap to select" : ""
          }`}
          accessibilityRole="button"
        >
          {isSelectMode && isCheckedOut && !isCheckedIn && (
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
    [
      checkedInAssetIds,
      isSelectMode,
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
            tintColor={colors.primary}
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

            {/* Action buttons */}
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

            {canCheckin && (
              <View style={styles.checkinActions}>
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
                  <Ionicons name="scan" size={18} color={colors.primary} />
                  <Text style={styles.actionButtonOutlineText}>
                    Scan to Check In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionButtonOutline,
                    isSelectMode && styles.actionButtonOutlineActive,
                  ]}
                  onPress={() => {
                    setIsSelectMode(!isSelectMode);
                    setSelectedAssetIds(new Set());
                  }}
                  accessibilityLabel={
                    isSelectMode
                      ? "Cancel selection"
                      : "Select assets to check in"
                  }
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={isSelectMode ? "close" : "checkbox-outline"}
                    size={18}
                    color={isSelectMode ? colors.error : colors.primary}
                  />
                  <Text
                    style={[
                      styles.actionButtonOutlineText,
                      isSelectMode && { color: colors.error },
                    ]}
                  >
                    {isSelectMode ? "Cancel" : "Select to Check In"}
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

      {/* Floating partial check-in button */}
      {isSelectMode && selectedAssetIds.size > 0 && (
        <View style={styles.floatingAction}>
          <TouchableOpacity
            style={styles.floatingButton}
            onPress={handlePartialCheckin}
            accessibilityLabel={`Check in ${selectedAssetIds.size} selected assets`}
            accessibilityRole="button"
          >
            <Ionicons
              name="log-in-outline"
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.floatingButtonText}>
              Check In {selectedAssetIds.size}{" "}
              {selectedAssetIds.size === 1 ? "Asset" : "Assets"}
            </Text>
          </TouchableOpacity>
        </View>
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
  actionButtonOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: spacing.sm,
  },
  actionButtonOutlineActive: {
    borderColor: colors.error,
  },
  actionButtonOutlineText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primary,
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
