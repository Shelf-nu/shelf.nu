import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect, useScrollToTop } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { api, type AssetListItem } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import {
  fontSize,
  spacing,
  borderRadius,
  formatStatus,
  hitSlop,
} from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { ErrorBoundary } from "@/components/error-boundary";
import { AssetListSkeleton } from "@/components/skeleton-loader";
import { useSwipeFilters } from "@/lib/use-swipe-filters";
import { announce } from "@/lib/a11y";

const PAGE_SIZE = 20;
const keyExtractor = (item: AssetListItem) => item.id;

/** Filter config — supports status filters and the special "My Custody" filter */
type FilterConfig = { label: string; status: string; myCustody?: boolean };
const FILTERS: FilterConfig[] = [
  { label: "All", status: "" },
  { label: "My Custody", status: "", myCustody: true },
  { label: "Available", status: "AVAILABLE" },
  { label: "In Custody", status: "IN_CUSTODY" },
  { label: "Checked Out", status: "CHECKED_OUT" },
];
const MY_CUSTODY_INDEX = 1;

export default function AssetsListScreen() {
  return (
    <ErrorBoundary screenName="Assets">
      <AssetsListContent />
    </ErrorBoundary>
  );
}

function AssetsListContent() {
  const router = useRouter();
  const { myCustody: myCustodyParam } = useLocalSearchParams<{
    myCustody?: string;
  }>();
  const {
    currentOrg,
    isLoading: orgLoading,
    error: orgError,
    refresh: refreshOrg,
  } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState(
    myCustodyParam === "true" ? MY_CUSTODY_INDEX : 0
  );
  const [totalPages, setTotalPages] = useState(0);
  const nextPage = useRef(1);
  const listRef = useRef<FlatList>(null);
  useScrollToTop(listRef);

  // Swipe-to-filter gesture (Instagram-style horizontal swipe between filters)
  const {
    panHandlers: swipePanHandlers,
    animatedStyle: swipeAnimatedStyle,
    syncIndex,
  } = useSwipeFilters(FILTERS.length, (newIndex) => {
    Haptics.selectionAsync();
    setActiveFilter(newIndex);
  });

  // Keep swipe hook in sync + auto-scroll pills to keep active one visible
  const filterScrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    syncIndex(activeFilter);
    // ~80px avg pill width — scroll to rough center of active pill
    filterScrollRef.current?.scrollTo({
      x: Math.max(0, activeFilter * 80 - 40),
      animated: true,
    });
  }, [activeFilter, syncIndex]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchAssets = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!currentOrg) return;
      const filter = FILTERS[activeFilter];
      const { data, error: fetchErr } = await api.assets(currentOrg.id, {
        search: debouncedSearch || undefined,
        page: pageNum,
        perPage: PAGE_SIZE,
        status: filter.status || undefined,
        myCustody: filter.myCustody || undefined,
      });
      if (!data && !fetchErr) return; // Request cancelled (navigation) — ignore
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load assets");
        return;
      }
      setError(null);
      setTotalPages(data.totalPages);
      nextPage.current = pageNum + 1;
      if (reset) setAssets(data.assets);
      else
        setAssets((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newItems = data.assets.filter((a) => !existingIds.has(a.id));
          return [...prev, ...newItems];
        });
    },
    [currentOrg, debouncedSearch, activeFilter]
  );

  // Track whether we've done the initial load so we can skip the skeleton
  // on subsequent tab-focus revisits (stale-while-revalidate pattern)
  const hasFetchedAssets = useRef(false);
  const lastFetchedAt = useRef(0);

  // Refresh on search/filter change — resets the stale timer so useFocusEffect picks it up
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!currentOrg) return;
    setIsLoading(true);
    nextPage.current = 1;
    lastFetchedAt.current = 0; // force fresh fetch
    fetchAssets(1, true).finally(() => {
      setIsLoading(false);
      lastFetchedAt.current = Date.now();
    });
  }, [debouncedSearch, activeFilter]);

  // Refresh on tab focus — skip if data is fresh (< 60s old) to avoid double-fetches
  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      // Skip if data was fetched recently (avoids double-fetch with search/filter effect)
      if (
        hasFetchedAssets.current &&
        Date.now() - lastFetchedAt.current < 60_000
      )
        return;
      if (!hasFetchedAssets.current) {
        setIsLoading(true);
      }
      nextPage.current = 1;
      const isFirstLoad = !hasFetchedAssets.current;
      fetchAssets(1, true).finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        if (isFirstLoad) {
          hasFetchedAssets.current = true;
          setAssets((current) => {
            announce(
              current.length === 0
                ? "No assets found"
                : current.length + " assets loaded"
            );
            return current;
          });
        }
      });
    }, [currentOrg?.id, fetchAssets])
  );

  const onRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsRefreshing(true);
    nextPage.current = 1;
    await fetchAssets(1, true);
    setIsRefreshing(false);
    announce("Content refreshed");
  };

  const onEndReached = async () => {
    if (isLoadingMore || nextPage.current > totalPages) return;
    setIsLoadingMore(true);
    await fetchAssets(nextPage.current, false);
    setIsLoadingMore(false);
  };

  const renderAsset = useCallback(
    ({ item }: { item: AssetListItem }) => {
      const badge = statusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };

      return (
        <TouchableOpacity
          style={styles.assetCard}
          onPress={() => router.push(`/(tabs)/assets/${item.id}`)}
          activeOpacity={0.6}
          accessibilityLabel={`${item.title}, ${formatStatus(item.status)}${
            item.category ? `, ${item.category.name}` : ""
          }${item.location ? `, ${item.location.name}` : ""}`}
          accessibilityRole="button"
        >
          {item.thumbnailImage || item.mainImage ? (
            <Image
              source={{ uri: item.thumbnailImage || item.mainImage! }}
              style={styles.assetImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.assetImage, styles.assetImagePlaceholder]}>
              <Ionicons name="cube-outline" size={22} color={colors.gray300} />
            </View>
          )}

          <View style={styles.assetInfo}>
            <Text style={styles.assetTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={styles.assetMeta}>
              {item.category && (
                <Text style={styles.assetCategory} numberOfLines={1}>
                  {item.category.name}
                </Text>
              )}
              {item.location && (
                <View style={styles.locationRow}>
                  <Ionicons
                    name="location-outline"
                    size={11}
                    color={colors.mutedLight}
                  />
                  <Text style={styles.assetLocation} numberOfLines={1}>
                    {item.location.name}
                  </Text>
                </View>
              )}
            </View>
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
    [router, colors, statusBadge, styles]
  );

  if (orgLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Loading assets"
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
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search assets..."
          placeholderTextColor={colors.placeholderText}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search assets"
        />
        {searchInput.trim() !== debouncedSearch && searchInput.length > 0 && (
          <ActivityIndicator size="small" color={colors.mutedLight} />
        )}
        {searchInput.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchInput("")}
            hitSlop={hitSlop.md}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills — auto-scrolls to keep active pill visible during swipe */}
      <ScrollView
        ref={filterScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
        accessibilityRole="tablist"
      >
        {FILTERS.map((f, i) => (
          <TouchableOpacity
            key={f.myCustody ? "myCustody" : f.status || "all"}
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
                accessibilityLabel="Retry loading assets"
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : isLoading && assets.length === 0 ? (
            <AssetListSkeleton />
          ) : assets.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="cube-outline" size={48} color={colors.border} />
              <Text style={styles.emptyTitle}>
                {debouncedSearch
                  ? "No results found"
                  : activeFilter > 0
                  ? `No ${FILTERS[activeFilter].label.toLowerCase()} assets`
                  : "No assets yet"}
              </Text>
              <Text style={styles.emptyText}>
                {debouncedSearch
                  ? "Try a different search term or clear filters"
                  : activeFilter > 0
                  ? "Try selecting a different status filter"
                  : "Create your first asset to start tracking"}
              </Text>
              {!debouncedSearch && activeFilter === 0 && (
                <TouchableOpacity
                  style={styles.emptyAction}
                  onPress={() => router.push("/(tabs)/assets/new")}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={18}
                    color={colors.primaryForeground}
                  />
                  <Text style={styles.emptyActionText}>Create Asset</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={assets}
              renderItem={renderAsset}
              keyExtractor={keyExtractor}
              contentContainerStyle={styles.list}
              keyboardDismissMode="on-drag"
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
              onEndReached={onEndReached}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isLoadingMore ? (
                  <ActivityIndicator
                    style={styles.footer}
                    color={colors.primary}
                    accessibilityLabel="Loading more assets"
                  />
                ) : null
              }
            />
          )}
        </Animated.View>
      </View>

      {/* FAB — Quick Asset Create */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push("/(tabs)/assets/new");
        }}
        activeOpacity={0.85}
        accessibilityLabel="Create new asset"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={28} color={colors.primaryForeground} />
      </TouchableOpacity>
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

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: spacing.sm,
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.foreground,
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterPillText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.muted,
  },
  filterPillTextActive: {
    color: colors.primaryForeground,
  },

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100, // extra space to prevent FAB overlapping last items
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  assetImage: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.sm,
  },
  assetImagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  assetInfo: {
    flex: 1,
    gap: 3,
  },
  assetTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  assetMeta: {
    gap: 2,
  },
  assetCategory: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  assetLocation: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },

  // Status badge — pill shape like webapp
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

  // Empty / error states
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
  emptyAction: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  emptyActionText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
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

  // FAB
  fab: {
    position: "absolute",
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.md,
  },
}));
