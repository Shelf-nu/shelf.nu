import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, type Location } from "@/lib/api";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

type Props = {
  visible: boolean;
  orgId: string;
  currentLocationId?: string;
  onSelect: (location: Location) => void;
  onClose: () => void;
};

const locationKeyExtractor = (item: LocationNode) => item.id;

/** Location with depth info for hierarchical rendering */
type LocationNode = Location & {
  depth: number;
  hasChildren: boolean;
};

/**
 * Build a hierarchical tree from a flat list of locations using parentId,
 * then flatten it back with depth information for indented FlatList rendering.
 *
 * When a location's parentId references a location not in the current list
 * (e.g. filtered out by search), it's treated as a root node.
 */
function buildLocationTree(locations: Location[]): LocationNode[] {
  const locationMap = new Map<string, Location>();
  const childrenMap = new Map<string, Location[]>();

  // Index all locations by ID
  for (const loc of locations) {
    locationMap.set(loc.id, loc);
  }

  // Group children under their parents
  for (const loc of locations) {
    if (loc.parentId && locationMap.has(loc.parentId)) {
      const siblings = childrenMap.get(loc.parentId) ?? [];
      siblings.push(loc);
      childrenMap.set(loc.parentId, siblings);
    }
  }

  // Identify root nodes (no parent, or parent not in current list)
  const roots = locations.filter(
    (loc) => !loc.parentId || !locationMap.has(loc.parentId)
  );

  // Recursively flatten tree with depth info
  const result: LocationNode[] = [];

  function walk(nodes: Location[], depth: number) {
    // Sort alphabetically at each level
    const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
    for (const node of sorted) {
      const children = childrenMap.get(node.id) ?? [];
      result.push({ ...node, depth, hasChildren: children.length > 0 });
      if (children.length > 0) {
        walk(children, depth + 1);
      }
    }
  }

  walk(roots, 0);
  return result;
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
  },
  closeButton: {
    padding: spacing.xs,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
  list: {
    paddingBottom: spacing.lg,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
    paddingLeft: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  locationRowCurrent: {
    backgroundColor: colors.primaryBg,
    borderBottomColor: colors.primaryBg,
  },

  // Depth connector for nested items
  depthConnector: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  depthLine: {
    fontSize: fontSize.sm,
    color: colors.gray300,
    lineHeight: 20,
  },

  // Icon styles
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  iconCircleCurrent: {
    backgroundColor: colors.iconActive,
  },
  iconCircleChild: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },

  // Location info
  locationInfo: {
    flex: 1,
    gap: 2,
  },
  locationName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  locationNameChild: {
    fontSize: fontSize.base,
    fontWeight: "500",
  },
  locationDescription: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  currentBadge: {
    backgroundColor: colors.availableBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.md,
  },
  currentBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.available,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  errorText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: "center",
    paddingHorizontal: spacing.xxxl,
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
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
}));

export function LocationPicker({
  visible,
  orgId,
  currentLocationId,
  onSelect,
  onClose,
}: Props) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { colors } = useTheme();
  const styles = useStyles();

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchLocations = useCallback(async () => {
    if (!orgId) return;
    setIsLoading(true);
    setError(null);

    const { data, error: fetchErr } = await api.locations(
      orgId,
      debouncedSearch || undefined
    );

    if (fetchErr || !data) {
      setError(fetchErr || "Failed to load locations");
    } else {
      setLocations(data.locations);
    }
    setIsLoading(false);
  }, [orgId, debouncedSearch]);

  // Track when the initial (non-search) data was last fetched
  const lastFetchedAt = useRef(0);
  const PICKER_CACHE_TTL = 5 * 60_000; // 5 minutes

  useEffect(() => {
    if (visible) {
      // Always fetch when searching; cache only the initial load
      if (debouncedSearch) {
        fetchLocations();
      } else {
        const isStale = Date.now() - lastFetchedAt.current > PICKER_CACHE_TTL;
        if (locations.length === 0 || isStale) {
          fetchLocations().then(() => {
            lastFetchedAt.current = Date.now();
          });
        }
      }
    } else {
      // Reset search but keep locations cached for fast re-open
      setSearch("");
      setDebouncedSearch("");
    }
    // why: PICKER_CACHE_TTL is a module constant; debouncedSearch and locations.length
    // are read only inside the visibility branch and listing them would re-fire the
    // effect on every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fetchLocations]);

  // Build hierarchy when not searching; keep flat for search results
  const displayLocations = useMemo(() => {
    if (debouncedSearch) {
      // Flat list when searching — results are already filtered by the API
      return locations.map((loc) => ({
        ...loc,
        depth: 0,
        hasChildren: false,
      }));
    }
    return buildLocationTree(locations);
  }, [locations, debouncedSearch]);

  const renderLocation = ({ item }: { item: LocationNode }) => {
    const isCurrent = item.id === currentLocationId;
    const indent = item.depth * 28; // 28px per nesting level

    return (
      <TouchableOpacity
        style={[
          styles.locationRow,
          isCurrent && styles.locationRowCurrent,
          { paddingLeft: spacing.lg + indent },
        ]}
        onPress={() => onSelect(item)}
        activeOpacity={0.7}
        accessibilityLabel={`${item.name}${
          item.depth > 0 ? `, sub-location level ${item.depth}` : ""
        }${isCurrent ? ", current location" : ""}`}
        accessibilityRole="button"
      >
        {/* Depth connector line for nested items */}
        {item.depth > 0 && (
          <View
            style={[styles.depthConnector, { left: spacing.lg + indent - 16 }]}
          >
            <Text style={styles.depthLine}>└</Text>
          </View>
        )}

        <View
          style={[
            styles.iconCircle,
            isCurrent && styles.iconCircleCurrent,
            item.depth > 0 && styles.iconCircleChild,
          ]}
        >
          <Ionicons
            name={item.hasChildren ? "folder" : "location"}
            size={item.depth > 0 ? 14 : 18}
            color={isCurrent ? "#fff" : colors.muted}
          />
        </View>
        <View style={styles.locationInfo}>
          <Text
            style={[
              styles.locationName,
              item.depth > 0 && styles.locationNameChild,
            ]}
          >
            {item.name}
          </Text>
          {item.description && (
            <Text style={styles.locationDescription} numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        {isCurrent ? (
          <View style={styles.currentBadge}>
            <Text style={styles.currentBadgeText}>Current</Text>
          </View>
        ) : (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.mutedLight}
          />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Select Location</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close location picker"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color={colors.mutedLight} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search locations..."
            placeholderTextColor={colors.placeholderText}
            autoCorrect={false}
            autoFocus
            accessibilityLabel="Search locations"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              accessibilityLabel="Clear search"
              accessibilityRole="button"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.mutedLight}
              />
            </TouchableOpacity>
          )}
        </View>

        {/* Content */}
        {error ? (
          <View style={styles.centered}>
            <Ionicons
              name="alert-circle-outline"
              size={48}
              color={colors.error}
            />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={fetchLocations}
              accessibilityLabel="Retry loading locations"
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.muted} />
          </View>
        ) : displayLocations.length === 0 ? (
          <View style={styles.centered}>
            <Ionicons
              name="location-outline"
              size={48}
              color={colors.mutedLight}
            />
            <Text style={styles.emptyText}>
              {debouncedSearch
                ? "No locations match your search"
                : "No locations found"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayLocations}
            renderItem={renderLocation}
            keyExtractor={locationKeyExtractor}
            removeClippedSubviews
            initialNumToRender={15}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
