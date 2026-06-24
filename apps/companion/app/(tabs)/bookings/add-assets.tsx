/**
 * Availability-aware asset/kit picker for a booking.
 *
 * Browses the assets (and kits) that are AVAILABLE for the booking's date
 * window and lets the user multi-select and add them. The availability filter
 * is computed server-side (`available-assets` / `available-kits` reuse the web
 * date-overlap where-clause), so items already reserved / in custody / checked
 * out for the window never appear. Selected items are added via the existing
 * `add-scanned-assets` endpoint (kits expand to their assets server-side).
 *
 * The non-availability path (scan a physical label) lives on the scanner; this
 * is the "browse and pick" complement. Reached via
 * `/(tabs)/bookings/add-assets?bookingId=...&bookingName=...&from=...&to=...`.
 *
 * @see {@link file://./[id].tsx} the booking detail that launches this.
 */

import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, type AvailableAsset, type AvailableKit } from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { markBookingDirty } from "@/lib/booking-refresh";
import { fontSize, spacing, borderRadius, hitSlop } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

type Mode = "assets" | "kits";

const assetKeyExtractor = (item: AvailableAsset) => item.id;
const kitKeyExtractor = (item: AvailableKit) => item.id;

export default function AddBookingAssetsScreen() {
  const router = useRouter();
  const { bookingId, from, to } = useLocalSearchParams<{
    bookingId: string;
    bookingName?: string;
    from: string;
    to: string;
  }>();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  const [mode, setMode] = useState<Mode>("assets");
  const [assets, setAssets] = useState<AvailableAsset[]>([]);
  const [kits, setKits] = useState<AvailableKit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedKitIds, setSelectedKitIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Debounce search (mirrors the list screens)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (!currentOrg || !from || !to) return;
    setIsLoading(true);
    setError(null);
    if (mode === "assets") {
      const { data, error: err } = await api.availableAssets(currentOrg.id, {
        bookingFrom: from,
        bookingTo: to,
        // Keep THIS booking's own assets selectable when editing (otherwise they
        // filter out as "unavailable" against their own reservation).
        unhideBookingId: bookingId,
        search: debouncedSearch || undefined,
      });
      if (err) setError(err);
      else if (data) setAssets(data.assets);
    } else {
      const { data, error: err } = await api.availableKits(currentOrg.id, {
        bookingFrom: from,
        bookingTo: to,
        // REQUIRED: enables the kit conflict filter (else already-booked kits
        // show as available) and keeps this booking's own kits selectable.
        currentBookingId: bookingId,
        search: debouncedSearch || undefined,
      });
      if (err) setError(err);
      else if (data) setKits(data.kits);
    }
    setIsLoading(false);
  }, [currentOrg, from, to, mode, debouncedSearch, bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAsset = useCallback((assetId: string) => {
    setSelectedAssetIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);

  const toggleKit = useCallback((kitId: string) => {
    setSelectedKitIds((prev) => {
      const next = new Set(prev);
      if (next.has(kitId)) next.delete(kitId);
      else next.add(kitId);
      return next;
    });
  }, []);

  const totalSelected = selectedAssetIds.size + selectedKitIds.size;

  const handleAdd = async () => {
    if (!currentOrg || !bookingId || totalSelected === 0) return;
    setIsSubmitting(true);
    const { error: err } = await api.addScannedToBooking(
      currentOrg.id,
      bookingId,
      Array.from(selectedAssetIds),
      Array.from(selectedKitIds)
    );
    setIsSubmitting(false);
    if (err) {
      Alert.alert("Couldn't add to booking", err);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    markBookingDirty(bookingId);
    router.back();
  };

  const renderAsset = useCallback(
    ({ item }: { item: AvailableAsset }) => {
      const selected = selectedAssetIds.has(item.id);
      return (
        <TouchableOpacity
          style={[styles.row, selected && styles.rowSelected]}
          onPress={() => toggleAsset(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`${item.title}${selected ? ", selected" : ""}`}
        >
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            {selected && (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.primaryForeground}
              />
            )}
          </View>
          {item.mainImage ? (
            <Image
              source={{ uri: item.mainImage }}
              style={styles.thumb}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="cube-outline" size={18} color={colors.gray300} />
            </View>
          )}
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.title}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectedAssetIds, toggleAsset, colors, styles]
  );

  const renderKit = useCallback(
    ({ item }: { item: AvailableKit }) => {
      const selected = selectedKitIds.has(item.id);
      return (
        <TouchableOpacity
          style={[styles.row, selected && styles.rowSelected]}
          onPress={() => toggleKit(item.id)}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={`Kit ${item.name}${selected ? ", selected" : ""}`}
        >
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            {selected && (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.primaryForeground}
              />
            )}
          </View>
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="albums-outline" size={18} color={colors.gray300} />
          </View>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {item.name}
          </Text>
        </TouchableOpacity>
      );
    },
    [selectedKitIds, toggleKit, colors, styles]
  );

  return (
    <View style={styles.container}>
      {/* Segmented Assets / Kits */}
      <View style={styles.segment}>
        {(["assets", "kits"] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segmentItem, mode === m && styles.segmentItemActive]}
            onPress={() => setMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            accessibilityLabel={m === "assets" ? "Assets" : "Kits"}
          >
            <Text
              style={[
                styles.segmentText,
                mode === m && styles.segmentTextActive,
              ]}
            >
              {m === "assets" ? "Assets" : "Kits"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={colors.mutedLight} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={`Search available ${mode}...`}
          placeholderTextColor={colors.mutedLight}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel={`Search available ${mode}`}
        />
        {searchInput.length > 0 ? (
          <TouchableOpacity
            onPress={() => setSearchInput("")}
            hitSlop={hitSlop.sm}
            accessibilityLabel="Clear search"
            accessibilityRole="button"
          >
            <Ionicons name="close-circle" size={18} color={colors.mutedLight} />
          </TouchableOpacity>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Ionicons
            name="alert-circle-outline"
            size={40}
            color={colors.error}
          />
          <Text style={styles.emptyText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : mode === "assets" ? (
        <FlatList
          data={assets}
          renderItem={renderAsset}
          keyExtractor={assetKeyExtractor}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons
                name="checkmark-done-outline"
                size={40}
                color={colors.border}
              />
              <Text style={styles.emptyText}>
                No assets available for these dates
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={kits}
          renderItem={renderKit}
          keyExtractor={kitKeyExtractor}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons
                name="checkmark-done-outline"
                size={40}
                color={colors.border}
              />
              <Text style={styles.emptyText}>
                No kits available for these dates
              </Text>
            </View>
          }
        />
      )}

      {/* Add bar */}
      {totalSelected > 0 && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={handleAdd}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={`Add ${totalSelected} selected to booking`}
          >
            {isSubmitting ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <>
                <Ionicons
                  name="add-circle"
                  size={20}
                  color={colors.primaryForeground}
                />
                <Text style={styles.addButtonText}>
                  Add {totalSelected} to Booking
                </Text>
              </>
            )}
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
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxxl,
  },
  segment: {
    flexDirection: "row",
    margin: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.lg,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: borderRadius.md,
  },
  segmentItemActive: {
    backgroundColor: colors.white,
    ...shadows.sm,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
  },
  segmentTextActive: {
    color: colors.foreground,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
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
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },
  row: {
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
  rowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  rowTitle: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
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
  thumb: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
  },
  thumbPlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
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
  },
  retryText: {
    color: colors.primaryForeground,
    fontWeight: "600",
    fontSize: fontSize.base,
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.lg,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: borderRadius.md,
    gap: spacing.sm,
  },
  addButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
