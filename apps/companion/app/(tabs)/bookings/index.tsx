import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useFocusEffect, useScrollToTop } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { api, type BookingListItem } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  formatDateTime,
  hitSlop,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { BookingListSkeleton } from "@/components/skeleton-loader";
import { useSwipeFilters } from "@/lib/use-swipe-filters";
import { announce } from "@/lib/a11y";

const PAGE_SIZE = 20;
const bookingKeyExtractor = (item: BookingListItem) => item.id;

/** Which status filters to show as pills */
const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "Active", value: "RESERVED,ONGOING,OVERDUE" },
  { label: "Completed", value: "COMPLETE" },
  {
    label: "All",
    value: "DRAFT,RESERVED,ONGOING,OVERDUE,COMPLETE,ARCHIVED,CANCELLED",
  },
];

export default function BookingsListScreen() {
  return (
    <ErrorBoundary screenName="Bookings">
      <BookingsListContent />
    </ErrorBoundary>
  );
}

function BookingsListContent() {
  const router = useRouter();
  const {
    currentOrg,
    isLoading: orgLoading,
    error: orgError,
    refresh: refreshOrg,
  } = useOrg();
  const { colors, bookingStatusBadge } = useTheme();
  const styles = useStyles();
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const nextPage = useRef(1);
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  // Swipe-to-filter gesture (Instagram-style horizontal swipe between filters)
  const {
    panHandlers: swipePanHandlers,
    animatedStyle: swipeAnimatedStyle,
    syncIndex,
  } = useSwipeFilters(STATUS_FILTERS.length, (newIndex) => {
    Haptics.selectionAsync();
    setActiveFilter(newIndex);
  });

  // Keep swipe hook in sync with active filter
  useEffect(() => {
    syncIndex(activeFilter);
  }, [activeFilter, syncIndex]);

  const fetchBookings = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!currentOrg) return;
      const { data, error: fetchErr } = await api.bookings(currentOrg.id, {
        status: STATUS_FILTERS[activeFilter].value,
        page: pageNum,
        perPage: PAGE_SIZE,
      });
      // Request cancelled (navigation) — ignore
      if (!data && !fetchErr) return;
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load bookings");
        return;
      }
      setError(null);
      setTotalPages(data.totalPages);
      nextPage.current = pageNum + 1;
      if (reset) setBookings(data.bookings);
      else setBookings((prev) => [...prev, ...data.bookings]);
    },
    [currentOrg, activeFilter]
  );

  // Refresh on tab focus — skip if data is fresh (< 60s old)
  const hasFetchedBookings = useRef(false);
  const lastFetchedAt = useRef(0);

  // Reset cache when org changes so useFocusEffect refetches
  useEffect(() => {
    lastFetchedAt.current = 0;
    hasFetchedBookings.current = false;
    setBookings([]);
    setError(null);
    nextPage.current = 1;
  }, [currentOrg?.id]);

  // Re-fetch immediately when filter changes
  useEffect(() => {
    if (!currentOrg || !hasFetchedBookings.current) return;
    nextPage.current = 1;
    fetchBookings(1, true).finally(() => {
      lastFetchedAt.current = Date.now();
    });
  }, [activeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      if (
        hasFetchedBookings.current &&
        Date.now() - lastFetchedAt.current < 60_000
      )
        return;
      if (!hasFetchedBookings.current) {
        setIsLoading(true);
      }
      nextPage.current = 1;
      const isFirstLoad = !hasFetchedBookings.current;
      fetchBookings(1, true).finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        if (isFirstLoad) {
          hasFetchedBookings.current = true;
          setBookings((current) => {
            announce(
              current.length === 0
                ? "No bookings found"
                : current.length + " bookings loaded"
            );
            return current;
          });
        }
      });
      // why: depend on org id (not full object) to avoid re-runs on identity-only changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentOrg?.id, activeFilter, fetchBookings])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    nextPage.current = 1;
    await fetchBookings(1, true);
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  const onEndReached = async () => {
    if (isLoadingMore || nextPage.current > totalPages) return;
    setIsLoadingMore(true);
    await fetchBookings(nextPage.current, false);
    setIsLoadingMore(false);
  };

  const renderBooking = useCallback(
    ({ item }: { item: BookingListItem }) => {
      const badge = bookingStatusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };

      const isUrgent = item.status === "OVERDUE";
      const isActive = item.status === "ONGOING" || item.status === "RESERVED";

      return (
        <TouchableOpacity
          style={[styles.bookingCard, isUrgent && styles.bookingCardUrgent]}
          onPress={() => router.push(`/(tabs)/bookings/${item.id}`)}
          activeOpacity={0.6}
          accessibilityLabel={`Booking: ${item.name}, ${formatStatus(
            item.status
          )}, ${item.assetCount} assets`}
          accessibilityRole="button"
        >
          <View style={styles.bookingHeader}>
            <View style={styles.bookingTitleRow}>
              <Text style={styles.bookingName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                <View
                  style={[styles.statusDot, { backgroundColor: badge.text }]}
                />
                <Text style={[styles.statusText, { color: badge.text }]}>
                  {formatStatus(item.status)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.bookingMeta}>
            <View style={styles.metaRow}>
              <Ionicons
                name="calendar-outline"
                size={13}
                color={colors.mutedLight}
              />
              <Text style={styles.metaText}>
                {formatDateTime(item.from)} → {formatDateTime(item.to)}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Ionicons
                name="cube-outline"
                size={13}
                color={colors.mutedLight}
              />
              <Text style={styles.metaText}>
                {item.assetCount} {item.assetCount === 1 ? "asset" : "assets"}
              </Text>
            </View>

            {item.custodianName && (
              <View style={styles.metaRow}>
                <Ionicons
                  name="person-outline"
                  size={13}
                  color={colors.mutedLight}
                />
                <Text style={styles.metaText} numberOfLines={1}>
                  {item.custodianName}
                </Text>
              </View>
            )}
          </View>

          {isActive && (
            <View style={styles.actionHint}>
              <Ionicons
                name={
                  item.status === "RESERVED"
                    ? "log-out-outline"
                    : "log-in-outline"
                }
                size={14}
                color={colors.iconDefault}
              />
              <Text style={styles.actionHintText}>
                {item.status === "RESERVED"
                  ? "Ready to check out"
                  : "Tap to check in"}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [router, colors, bookingStatusBadge, styles]
  );

  if (orgLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
          color={colors.muted}
          accessibilityLabel="Loading bookings"
        />
      </View>
    );
  }

  if (orgError) {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="cloud-offline-outline"
          size={48}
          color={colors.mutedLight}
        />
        <Text style={styles.emptyText}>{orgError}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            refreshOrg();
          }}
          activeOpacity={0.7}
          accessibilityLabel="Retry loading"
          accessibilityRole="button"
        >
          <Ionicons name="refresh" size={16} color={colors.primaryForeground} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status filter pills */}
      <View style={styles.filterRow} accessibilityRole="tablist">
        {STATUS_FILTERS.map((f, i) => (
          <TouchableOpacity
            key={f.value}
            style={[
              styles.filterPill,
              activeFilter === i && styles.filterPillActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveFilter(i);
            }}
            hitSlop={hitSlop.sm}
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilter === i }}
          >
            <Text
              style={[
                styles.filterPillText,
                activeFilter === i && styles.filterPillTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Swipeable content area — swipe left/right to cycle filter pills */}
      <View style={styles.flexFill} {...swipePanHandlers}>
        <Animated.View style={[styles.flexFill, swipeAnimatedStyle]}>
          {error ? (
            <View style={styles.centered}>
              <Ionicons
                name="alert-circle-outline"
                size={48}
                color={colors.error}
              />
              <Text style={styles.emptyText}>{error}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={onRefresh}
                accessibilityLabel="Retry loading bookings"
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : isLoading && bookings.length === 0 ? (
            <BookingListSkeleton />
          ) : bookings.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons
                name="calendar-outline"
                size={48}
                color={colors.border}
              />
              <Text style={styles.emptyTitle}>
                {activeFilter === 0
                  ? "No active bookings"
                  : `No ${STATUS_FILTERS[
                      activeFilter
                    ].label.toLowerCase()} bookings`}
              </Text>
              <Text style={styles.emptyText}>
                {activeFilter === 0
                  ? "Active bookings will appear here when created"
                  : "Try selecting a different status filter"}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={bookings}
              renderItem={renderBooking}
              keyExtractor={bookingKeyExtractor}
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
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <ActivityIndicator
                    style={styles.footer}
                    color={colors.muted}
                  />
                ) : null
              }
            />
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  flexFill: {
    flex: 1,
  },
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

  // Filter pills
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  filterPill: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    height: 34,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.filterPillActiveBg,
    borderColor: colors.filterPillActiveBg,
  },
  filterPillText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.muted,
  },
  filterPillTextActive: {
    color: colors.filterPillActiveText,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  bookingCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  bookingCardUrgent: {
    borderColor: colors.errorBorder,
  },
  bookingHeader: {
    gap: 4,
  },
  bookingTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  bookingName: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },

  // Status badge
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

  // Meta info
  bookingMeta: {
    gap: 4,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metaText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Action hint
  actionHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  actionHintText: {
    fontSize: fontSize.sm,
    color: colors.buttonGhostText,
    fontWeight: "500",
  },

  // Empty / error
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
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
  footer: {
    paddingVertical: spacing.lg,
  },
}));
