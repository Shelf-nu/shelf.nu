import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
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
import { announce } from "@/lib/a11y";

const custodyKeyExtractor = (item: AssetListItem) => item.id;

const PAGE_SIZE = 20;

export default function MyCustodyScreen() {
  return (
    <ErrorBoundary screenName="My Custody">
      <MyCustodyContent />
    </ErrorBoundary>
  );
}

function MyCustodyContent() {
  const router = useRouter();
  const { currentOrg, isLoading: orgLoading, error: orgError } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();
  const [assets, setAssets] = useState<AssetListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const nextPage = useRef(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchAssets = useCallback(
    async (pageNum: number, reset: boolean) => {
      if (!currentOrg) return;
      const { data, error: fetchErr } = await api.assets(currentOrg.id, {
        search: debouncedSearch || undefined,
        page: pageNum,
        perPage: PAGE_SIZE,
        myCustody: true,
      });
      // Request cancelled (navigation) — ignore
      if (!data && !fetchErr) return;
      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load custody items");
        return;
      }
      setError(null);
      setTotalPages(data.totalPages);
      setTotalCount(data.totalCount);
      nextPage.current = pageNum + 1;
      if (reset) setAssets(data.assets);
      else setAssets((prev) => [...prev, ...data.assets]);
    },
    [currentOrg, debouncedSearch]
  );

  // Refresh on search change (including clearing search)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!currentOrg) return;
    setIsLoading(true);
    nextPage.current = 1;
    fetchAssets(1, true).finally(() => setIsLoading(false));
  }, [debouncedSearch]);

  // Refresh on tab focus — skip if data is fresh (< 60s old)
  const hasFetchedCustody = useRef(false);
  const lastFetchedAt = useRef(0);

  // Reset cache when org changes so useFocusEffect refetches
  useEffect(() => {
    lastFetchedAt.current = 0;
    hasFetchedCustody.current = false;
    setAssets([]);
    setError(null);
    nextPage.current = 1;
  }, [currentOrg?.id]);
  useFocusEffect(
    useCallback(() => {
      if (!currentOrg) return;
      if (
        hasFetchedCustody.current &&
        Date.now() - lastFetchedAt.current < 60_000
      )
        return;
      if (!hasFetchedCustody.current) {
        setIsLoading(true);
      }
      nextPage.current = 1;
      fetchAssets(1, true).finally(() => {
        setIsLoading(false);
        lastFetchedAt.current = Date.now();
        hasFetchedCustody.current = true;
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
        <ActivityIndicator size="large" color={colors.muted} />
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header info */}
      <View style={styles.headerInfo}>
        <Ionicons name="hand-left-outline" size={18} color={colors.inCustody} />
        <Text style={styles.headerInfoText}>
          {isLoading
            ? "Loading..."
            : `${totalCount} item${
                totalCount !== 1 ? "s" : ""
              } in your custody`}
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search your items..."
          placeholderTextColor={colors.placeholderText}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search custody items"
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
            accessibilityLabel="Retry loading custody"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading && assets.length === 0 ? (
        <AssetListSkeleton />
      ) : assets.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="hand-left-outline" size={48} color={colors.border} />
          <Text style={styles.emptyTitle}>No items in your custody</Text>
          <Text style={styles.emptyText}>
            {debouncedSearch
              ? "No custody items match your search"
              : "Assets assigned to you will appear here"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={assets}
          renderItem={renderAsset}
          keyExtractor={custodyKeyExtractor}
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
              tintColor={colors.muted}
              accessibilityLabel="Pull to refresh"
            />
          }
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator style={styles.footer} color={colors.muted} />
            ) : null
          }
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

  // Header info
  headerInfo: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  headerInfoText: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: "500",
  },

  // Search
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
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

  // List
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
