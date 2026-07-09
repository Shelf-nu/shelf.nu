import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Platform,
  ActionSheetIOS,
  Alert,
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
  bookingCountdown,
  hitSlop,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { BookingListSkeleton } from "@/components/skeleton-loader";
import { useSwipeFilters } from "@/lib/use-swipe-filters";
import { announce } from "@/lib/a11y";
import {
  consumeBookingsListDirty,
  markBookingsListDirty,
} from "@/lib/booking-refresh";

const PAGE_SIZE = 20;
const bookingKeyExtractor = (item: BookingListItem) => item.id;

/**
 * Status filter pills. The mobile list route already accepts any
 * comma-separated subset of statuses, so we expose the field-critical
 * individual statuses (Reserved = upcoming, Ongoing = in progress, Overdue =
 * needs attention) alongside the grouped Active/Completed/All — letting a tech
 * isolate exactly what they care about on a job.
 */
const STATUS_FILTERS: { label: string; value: string }[] = [
  // DRAFT counts as active: a booking being built (e.g. scan-to-add) must
  // not vanish from the default view the moment the user leaves it.
  { label: "Active", value: "DRAFT,RESERVED,ONGOING,OVERDUE" },
  { label: "Reserved", value: "RESERVED" },
  { label: "Ongoing", value: "ONGOING" },
  { label: "Overdue", value: "OVERDUE" },
  { label: "Completed", value: "COMPLETE" },
  {
    label: "All",
    value: "DRAFT,RESERVED,ONGOING,OVERDUE,COMPLETE,ARCHIVED,CANCELLED",
  },
];

/**
 * Sort options surfaced in the sort menu. Each maps to the list route's
 * allowlisted `sortBy`/`sortOrder` params (default = the first entry, which
 * matches the route's own default of `from asc`). Directions are chosen to be
 * the useful one per column (soonest dates first, names A–Z, newest created).
 */
const SORT_OPTIONS: {
  label: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}[] = [
  { label: "Start date (earliest)", sortBy: "from", sortOrder: "asc" },
  { label: "Due date (soonest)", sortBy: "to", sortOrder: "asc" },
  { label: "Name (A–Z)", sortBy: "name", sortOrder: "asc" },
  { label: "Recently created", sortBy: "createdAt", sortOrder: "desc" },
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
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortIndex, setSortIndex] = useState(0);
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
    async (pageNum: number, reset: boolean): Promise<boolean> => {
      if (!currentOrg) return false;
      const { data, error: fetchErr } = await api.bookings(currentOrg.id, {
        status: STATUS_FILTERS[activeFilter].value,
        search: debouncedSearch || undefined,
        sortBy: SORT_OPTIONS[sortIndex].sortBy,
        sortOrder: SORT_OPTIONS[sortIndex].sortOrder,
        page: pageNum,
        perPage: PAGE_SIZE,
      });
      // Request cancelled (navigation): ignore, treat as not-refreshed.
      if (!data && !fetchErr) return false;
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load bookings");
        return false;
      }
      setError(null);
      setTotalPages(data.totalPages);
      nextPage.current = pageNum + 1;
      if (reset) {
        setBookings(data.bookings);
        lastLoadedCountRef.current = data.bookings.length;
      } else setBookings((prev) => [...prev, ...data.bookings]);
      return true;
    },
    [currentOrg, activeFilter, debouncedSearch, sortIndex]
  );

  // Refresh on tab focus — skip if data is fresh (< 60s old)
  const hasFetchedBookings = useRef(false);
  const lastFetchedAt = useRef(0);
  // Count from the latest successful reset fetch, used for the first-load a11y
  // summary without reading state inside a setBookings updater (impure).
  const lastLoadedCountRef = useRef(0);

  // Reset cache when org changes so useFocusEffect refetches
  useEffect(() => {
    lastFetchedAt.current = 0;
    hasFetchedBookings.current = false;
    setBookings([]);
    setError(null);
    nextPage.current = 1;
  }, [currentOrg?.id]);

  // Debounce the search box (mirrors the assets/kits list debounce).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Re-fetch immediately when the filter, search, or sort changes
  useEffect(() => {
    if (!currentOrg || !hasFetchedBookings.current) return;
    nextPage.current = 1;
    fetchBookings(1, true).finally(() => {
      lastFetchedAt.current = Date.now();
    });
  }, [activeFilter, debouncedSearch, sortIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      // A lifecycle mutation on the detail screen (reserve/cancel/archive/
      // delete/duplicate) marks the list dirty; bypass the freshness gate so we
      // don't show stale rows on return.
      const mustRefresh = consumeBookingsListDirty();
      if (
        !mustRefresh &&
        hasFetchedBookings.current &&
        Date.now() - lastFetchedAt.current < 60_000
      )
        return;
      if (!hasFetchedBookings.current) {
        setIsLoading(true);
      }
      nextPage.current = 1;
      const isFirstLoad = !hasFetchedBookings.current;
      fetchBookings(1, true)
        .then((ok) => {
          // If a forced (list-dirty) refresh failed or was cancelled, re-mark
          // so the next focus retries instead of falling back to the 60s gate.
          if (mustRefresh && !ok) markBookingsListDirty();
          // First-load a11y summary, only when the fetch succeeded so screen
          // readers don't announce "No bookings found" while the error/Retry
          // view is what's actually on screen.
          if (isFirstLoad && ok) {
            announce(
              lastLoadedCountRef.current === 0
                ? "No bookings found"
                : lastLoadedCountRef.current + " bookings loaded"
            );
          }
        })
        .finally(() => {
          setIsLoading(false);
          lastFetchedAt.current = Date.now();
          if (isFirstLoad) {
            hasFetchedBookings.current = true;
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

  // Cross-platform sort picker: native action sheet on iOS, Alert on Android
  // (mirrors the image-source picker pattern in assets/new.tsx).
  const openSortMenu = () => {
    Haptics.selectionAsync();
    const labels = SORT_OPTIONS.map((o) => o.label);
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Sort bookings",
          options: ["Cancel", ...labels],
          cancelButtonIndex: 0,
        },
        (i) => {
          if (i > 0) setSortIndex(i - 1);
        }
      );
    } else {
      Alert.alert("Sort bookings", undefined, [
        { text: "Cancel", style: "cancel" },
        ...SORT_OPTIONS.map((o, i) => ({
          text: o.label,
          onPress: () => setSortIndex(i),
        })),
      ]);
    }
  };

  const renderBooking = useCallback(
    ({ item }: { item: BookingListItem }) => {
      const badge = bookingStatusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };

      const isUrgent = item.status === "OVERDUE";
      const isActive = item.status === "ONGOING" || item.status === "RESERVED";
      const countdown = bookingCountdown(item.from, item.to, item.status);

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

            {countdown && (
              <View style={styles.metaRow}>
                <Ionicons
                  name={countdown.urgent ? "alert-circle" : "time-outline"}
                  size={13}
                  color={countdown.urgent ? colors.error : colors.mutedLight}
                />
                <Text
                  style={[
                    styles.metaText,
                    countdown.urgent && styles.metaTextUrgent,
                  ]}
                >
                  {countdown.text}
                </Text>
              </View>
            )}

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
              {/* A RESERVED booking is only "ready to check out" when it has
                  concrete assets AND no outstanding book-by-model reservations
                  (the server hard-blocks checkout until every reserved unit is
                  assigned). Otherwise the honest next step is to assign/add
                  assets, so the hint points there instead of promising a
                  checkout that isn't possible yet. */}
              <Ionicons
                name={
                  item.status !== "RESERVED"
                    ? "log-in-outline"
                    : (item.outstandingModelCount ?? 0) > 0
                    ? "cube-outline"
                    : item.assetCount > 0
                    ? "log-out-outline"
                    : "add-outline"
                }
                size={14}
                color={colors.iconDefault}
              />
              <Text style={styles.actionHintText}>
                {item.status !== "RESERVED"
                  ? "Tap to check in"
                  : (item.outstandingModelCount ?? 0) > 0
                  ? "Assign assets to check out"
                  : item.assetCount > 0
                  ? "Ready to check out"
                  : "Add assets to check out"}
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
      {/* Keyword search + sort */}
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={colors.mutedLight} />
          <TextInput
            style={styles.searchInput}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search bookings..."
            placeholderTextColor={colors.mutedLight}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Search bookings"
          />
          {searchInput.length > 0 ? (
            <TouchableOpacity
              onPress={() => setSearchInput("")}
              hitSlop={hitSlop.sm}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.mutedLight}
              />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity
          style={styles.sortButton}
          onPress={openSortMenu}
          accessibilityLabel="Sort bookings"
          accessibilityRole="button"
        >
          <Ionicons name="swap-vertical" size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>

      {/* Status filter pills — scrollable: more statuses than fit one row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
        accessibilityRole="tablist"
      >
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
      </ScrollView>

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
                  : activeFilter === 2
                  ? "No bookings"
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

      {/* Create booking — only TEAM workspaces can use bookings (matches the
          server premium gate; personal workspaces 403 on create). */}
      {currentOrg?.type === "TEAM" && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push("/(tabs)/bookings/new");
          }}
          accessibilityLabel="Create booking"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={28} color={colors.primaryForeground} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
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

  // Keyword search box + sort button
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  searchContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.foreground,
    padding: 0,
  },
  sortButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: borderRadius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Filter pills
  filterScroll: {
    flexGrow: 0,
  },
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
  metaTextUrgent: {
    color: colors.error,
    fontWeight: "600",
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
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
  },
}));
