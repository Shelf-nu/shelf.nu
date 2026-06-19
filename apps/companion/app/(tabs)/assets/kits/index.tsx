/**
 * Kits list screen — searchable, status-filterable, infinite-scrolling list
 * of the workspace's kits. Mirrors the Assets list conventions (debounced
 * search, filter pills, pull-to-refresh, themed status badges) and lives in
 * the Assets stack behind the segmented Assets|Kits switcher.
 *
 * @see {@link file://../index.tsx} the asset twin of this screen
 * @see {@link file://../../../../lib/api/kits.ts} data source
 */
import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { api } from "@/lib/api";
import type { KitListItem } from "@/lib/api/types";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius, formatStatus } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { InventorySegment } from "@/components/kits/inventory-segment";

const PAGE_SIZE = 20;

/** Filter pills — status filters plus the special "My Custody" filter. */
type KitFilter = { label: string; status: string; myCustody?: boolean };
const FILTERS: KitFilter[] = [
  { label: "All", status: "" },
  { label: "My Custody", status: "", myCustody: true },
  { label: "Available", status: "AVAILABLE" },
  { label: "In Custody", status: "IN_CUSTODY" },
  { label: "Checked Out", status: "CHECKED_OUT" },
];

const kitKeyExtractor = (item: KitListItem) => item.id;

/**
 * Kits list screen. Renders the workspace's kits with debounced search, status
 * filter pills, pull-to-refresh, and infinite scroll, and routes to a kit's
 * detail on row press. Rendered inside the Assets stack under the Kits segment.
 *
 * @returns The kits list screen element.
 */
export default function KitsListScreen() {
  const router = useRouter();
  const { currentOrg } = useOrg();
  const { colors, statusBadge } = useTheme();
  const styles = useStyles();

  const [kits, setKits] = useState<KitListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState(0);
  const nextPageRef = useRef(2);
  const hasMoreRef = useRef(true);
  // Re-entrancy guard for pagination. A ref (not the isLoadingMore state) so
  // the check is always current inside fetchKits without putting the value in
  // the callback's deps (which would re-create it mid-pagination).
  const isLoadingMoreRef = useRef(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchKits = useCallback(
    async (mode: "initial" | "refresh" | "more") => {
      if (!currentOrg) return;
      if (mode === "initial") setIsLoading(true);
      if (mode === "refresh") setIsRefreshing(true);
      if (mode === "more") {
        if (!hasMoreRef.current || isLoadingMoreRef.current) return;
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
      }
      setError(null);

      const page = mode === "more" ? nextPageRef.current : 1;
      const filter = FILTERS[activeFilter];
      const { data, error: fetchErr } = await api.kits(currentOrg.id, {
        search: debouncedSearch || undefined,
        status: filter.status || undefined,
        myCustody: filter.myCustody || undefined,
        page,
        perPage: PAGE_SIZE,
      });

      if (fetchErr || !data) {
        setError(fetchErr || "Failed to load kits");
      } else {
        setKits((prev) =>
          mode === "more" ? [...prev, ...data.kits] : data.kits
        );
        hasMoreRef.current = data.page < data.totalPages;
        nextPageRef.current = data.page + 1;
      }

      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
      isLoadingMoreRef.current = false;
    },
    [currentOrg, debouncedSearch, activeFilter]
  );

  // Initial load + reload on search/filter change
  useEffect(() => {
    fetchKits("initial");
  }, [fetchKits]);

  const renderKit = useCallback(
    ({ item }: { item: KitListItem }) => {
      const badge = statusBadge[item.status] ?? {
        bg: colors.backgroundTertiary,
        text: colors.muted,
      };
      return (
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push(`/(tabs)/assets/kits/${item.id}`)}
          activeOpacity={0.7}
          accessibilityLabel={`View kit ${item.name}`}
          accessibilityRole="button"
        >
          {item.image ? (
            <Image
              source={{ uri: item.image }}
              style={styles.rowImage}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.rowImage, styles.rowImagePlaceholder]}>
              <Ionicons name="albums-outline" size={18} color={colors.muted} />
            </View>
          )}
          <View style={styles.rowInfo}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <View style={styles.rowMeta}>
              <Text style={styles.rowCount} numberOfLines={1}>
                {item._count.assets} asset
                {item._count.assets === 1 ? "" : "s"}
                {item.category ? ` • ${item.category.name}` : ""}
              </Text>
              {item.location ? (
                <View style={styles.locationRow}>
                  <Ionicons
                    name="location-outline"
                    size={11}
                    color={colors.mutedLight}
                  />
                  <Text style={styles.rowLocation} numberOfLines={1}>
                    {item.location.name}
                  </Text>
                </View>
              ) : null}
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
    [statusBadge, colors, styles, router]
  );

  return (
    <View style={styles.container}>
      {/* Assets | Kits switcher */}
      <InventorySegment active="kits" />

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search kits..."
          placeholderTextColor={colors.placeholderText}
          autoCorrect={false}
          accessibilityLabel="Search kits"
        />
        {searchInput.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchInput("")}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Ionicons name="close-circle" size={18} color={colors.mutedLight} />
          </TouchableOpacity>
        )}
      </View>

      {/* Status filter pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterRowContent}
      >
        {FILTERS.map((f, i) => (
          <TouchableOpacity
            key={f.label}
            style={[
              styles.filterPill,
              activeFilter === i && styles.filterPillActive,
            ]}
            onPress={() => setActiveFilter(i)}
            accessibilityLabel={`Filter: ${f.label}`}
            accessibilityRole="button"
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

      {/* Content */}
      {error ? (
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={colors.error}
          />
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => fetchKits("initial")}
            accessibilityLabel="Retry loading kits"
            accessibilityRole="button"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : kits.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="albums-outline" size={48} color={colors.mutedLight} />
          <Text style={styles.stateText}>
            {debouncedSearch
              ? "No kits match your search"
              : FILTERS[activeFilter].myCustody
              ? "No kits in your custody"
              : FILTERS[activeFilter].status
              ? `No ${formatStatus(
                  FILTERS[activeFilter].status
                ).toLowerCase()} kits`
              : "No kits yet. Create kits in the web app to group assets."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={kits}
          renderItem={renderKit}
          keyExtractor={kitKeyExtractor}
          contentContainerStyle={styles.list}
          removeClippedSubviews
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={10}
          onEndReached={() => fetchKits("more")}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => fetchKits("refresh")}
              tintColor={colors.muted}
            />
          }
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator
                size="small"
                color={colors.muted}
                style={styles.footerSpinner}
              />
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
    backgroundColor: colors.background,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
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
  filterRow: {
    flexGrow: 0,
    marginTop: spacing.md,
  },
  filterRowContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
  },
  filterPillActive: {
    backgroundColor: colors.foreground,
    borderColor: colors.foreground,
  },
  filterPillText: {
    fontSize: fontSize.sm,
    color: colors.foreground,
    fontWeight: "500",
  },
  filterPillTextActive: {
    color: colors.white,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.sm,
  },
  rowImage: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundTertiary,
  },
  rowImagePlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowMeta: {
    gap: 2,
  },
  rowCount: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  rowLocation: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.pill,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xxl,
  },
  stateText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: 10,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
  footerSpinner: {
    paddingVertical: spacing.lg,
  },
}));
