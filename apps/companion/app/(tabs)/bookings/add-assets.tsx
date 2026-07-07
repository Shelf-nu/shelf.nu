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

import { useState, useEffect, useCallback, useRef } from "react";
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
import {
  api,
  type AvailableAsset,
  type AvailableKit,
  type AvailableModel,
  type AvailableModelExistingRequest,
} from "@/lib/api";
import { useOrg } from "@/lib/org-context";
import { markBookingDirty } from "@/lib/booking-refresh";
import { fontSize, spacing, borderRadius, hitSlop } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { QuantityInputSheet } from "@/components/quantity-input-sheet";

type Mode = "assets" | "kits" | "models";

const assetKeyExtractor = (item: AvailableAsset) => item.id;
const kitKeyExtractor = (item: AvailableKit) => item.id;
const modelKeyExtractor = (item: AvailableModel) => item.id;

export default function AddBookingAssetsScreen() {
  const router = useRouter();
  const {
    bookingId,
    from,
    to,
    mode: initialMode,
  } = useLocalSearchParams<{
    bookingId: string;
    bookingName?: string;
    from: string;
    to: string;
    /** When "models", open straight to the book-by-model tab (from detail). */
    mode?: string;
  }>();
  const { currentOrg } = useOrg();
  const { colors } = useTheme();
  const styles = useStyles();

  const [mode, setMode] = useState<Mode>(
    initialMode === "models" ? "models" : "assets"
  );
  const [assets, setAssets] = useState<AvailableAsset[]>([]);
  const [kits, setKits] = useState<AvailableKit[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  // This booking's existing model reservations, keyed by model id, so each row
  // knows its current reserved amount and fulfilled count.
  const [modelRequestsById, setModelRequestsById] = useState<
    Record<string, AvailableModelExistingRequest>
  >({});
  const [totalModelCount, setTotalModelCount] = useState(0);
  // The model whose quantity sheet is open (null = closed).
  const [activeModel, setActiveModel] = useState<AvailableModel | null>(null);
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

  // Monotonic id so a slow earlier fetch (e.g. an old search/mode) can't
  // overwrite the newest results with stale availability.
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    if (!currentOrg || !from || !to) return;
    const reqId = ++requestIdRef.current;
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
      if (reqId !== requestIdRef.current) return; // superseded by a newer load
      if (err) setError(err);
      else if (data) setAssets(data.assets);
    } else if (mode === "kits") {
      const { data, error: err } = await api.availableKits(currentOrg.id, {
        bookingFrom: from,
        bookingTo: to,
        // REQUIRED: enables the kit conflict filter (else already-booked kits
        // show as available) and keeps this booking's own kits selectable.
        currentBookingId: bookingId,
        search: debouncedSearch || undefined,
      });
      if (reqId !== requestIdRef.current) return; // superseded by a newer load
      if (err) setError(err);
      else if (data) setKits(data.kits);
    } else {
      // Book-by-model: availability is computed server-side over the booking's
      // window. Search is ALSO server-side (the list is capped at ~50, so a
      // client-only filter could never reach a model that sorts past the cap).
      const { data, error: err } = await api.availableModels(
        currentOrg.id,
        bookingId,
        debouncedSearch || undefined
      );
      if (reqId !== requestIdRef.current) return; // superseded by a newer load
      if (err) setError(err);
      else if (data) {
        setModels(data.assetModels ?? []);
        setTotalModelCount(data.totalAssetModels ?? 0);
        setModelRequestsById(
          Object.fromEntries(
            (data.modelRequests ?? []).map((mr) => [mr.assetModelId, mr])
          )
        );
      }
    }
    if (reqId === requestIdRef.current) setIsLoading(false);
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

  // ── Book-by-model reserve / edit / remove ────────────────────────────────

  /**
   * Upper bound for reserving a model: what's free in the window PLUS the units
   * this booking has already had assigned (they can't be re-reserved away but
   * the total can't drop below them). Mirrors the server cap in
   * `upsertBookingModelRequest` (available + existingFulfilled).
   */
  const reserveMax = (model: AvailableModel) => {
    const existing = modelRequestsById[model.id];
    return model.available + (existing?.fulfilledQuantity ?? 0);
  };

  const handleReserveSubmit = async (quantity: number) => {
    if (!currentOrg || !bookingId || !activeModel) return;
    const model = activeModel;
    setActiveModel(null); // the sheet's confirm IS the confirmation step
    setIsSubmitting(true);
    const { error: err } = await api.upsertModelRequest(
      currentOrg.id,
      bookingId,
      model.id,
      quantity
    );
    setIsSubmitting(false);
    if (err) {
      Alert.alert("Couldn't reserve model", err);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    markBookingDirty(bookingId);
    load(); // refresh availability + the reserved amounts
  };

  // Memoized so `renderModel` (which references it) keeps a stable identity
  // across renders — avoids the FlatList row remount churn the render-stability
  // rule warns about.
  const handleRemoveModel = useCallback(
    (model: AvailableModel) => {
      if (!currentOrg || !bookingId) return;
      Alert.alert(
        "Remove reservation",
        `Remove the reservation for ${model.name}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              setIsSubmitting(true);
              const { error: err } = await api.removeModelRequest(
                currentOrg.id,
                bookingId,
                model.id
              );
              setIsSubmitting(false);
              if (err) {
                Alert.alert("Couldn't remove reservation", err);
                return;
              }
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
              markBookingDirty(bookingId);
              load();
            },
          },
        ]
      );
    },
    [currentOrg, bookingId, load]
  );

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

  const renderModel = useCallback(
    ({ item }: { item: AvailableModel }) => {
      const existing = modelRequestsById[item.id];
      const reserved = existing?.quantity ?? 0;
      const max = item.available + (existing?.fulfilledQuantity ?? 0);
      // Nothing free to reserve AND nothing already reserved → can't act.
      const canReserve = max >= 1;
      return (
        <View style={styles.row}>
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="cube-outline" size={18} color={colors.gray300} />
          </View>
          <View style={styles.modelInfo}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.modelMeta}>
              {item.available} of {item.total} available
              {reserved > 0 ? ` · ${reserved} reserved here` : ""}
            </Text>
          </View>
          {reserved > 0 && (
            <TouchableOpacity
              style={styles.modelRemoveButton}
              onPress={() => handleRemoveModel(item)}
              disabled={isSubmitting}
              hitSlop={hitSlop.sm}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name} reservation`}
            >
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.modelReserveButton,
              !canReserve && styles.modelReserveButtonDisabled,
            ]}
            onPress={() => setActiveModel(item)}
            disabled={!canReserve || isSubmitting}
            accessibilityRole="button"
            accessibilityLabel={
              reserved > 0
                ? `Edit ${item.name} reservation, currently ${reserved}`
                : `Reserve units of ${item.name}`
            }
          >
            <Text
              style={[
                styles.modelReserveText,
                !canReserve && styles.modelReserveTextDisabled,
              ]}
            >
              {reserved > 0 ? "Edit" : "Reserve"}
            </Text>
          </TouchableOpacity>
        </View>
      );
    },
    [modelRequestsById, isSubmitting, colors, styles, handleRemoveModel]
  );

  return (
    <View style={styles.container}>
      {/* Segmented Assets / Kits / Models */}
      <View style={styles.segment}>
        {(["assets", "kits", "models"] as Mode[]).map((m) => {
          const label =
            m === "assets" ? "Assets" : m === "kits" ? "Kits" : "Models";
          return (
            <TouchableOpacity
              key={m}
              style={[
                styles.segmentItem,
                mode === m && styles.segmentItemActive,
              ]}
              onPress={() => setMode(m)}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === m }}
              accessibilityLabel={label}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === m && styles.segmentTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
      ) : mode === "kits" ? (
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
      ) : (
        <FlatList
          data={models}
          renderItem={renderModel}
          keyExtractor={modelKeyExtractor}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            // The picker returns the first 50 (by name); when there are more and
            // the user hasn't searched, nudge them to search — which now filters
            // server-side, so any model past the cap is reachable.
            !debouncedSearch && totalModelCount > models.length ? (
              <Text style={styles.modelsFooter}>
                Showing {models.length} of {totalModelCount} models. Search by
                name to find the rest.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Ionicons name="cube-outline" size={40} color={colors.border} />
              <Text style={styles.emptyText}>
                {debouncedSearch
                  ? "No models match your search"
                  : "This workspace has no asset models yet"}
              </Text>
            </View>
          }
        />
      )}

      {/* Reserve/edit quantity sheet for book-by-model */}
      <QuantityInputSheet
        visible={activeModel !== null}
        title={
          activeModel && modelRequestsById[activeModel.id]
            ? "Edit reservation"
            : "Reserve model"
        }
        subtitle={activeModel?.name}
        max={activeModel ? reserveMax(activeModel) : 1}
        defaultValue={
          activeModel ? modelRequestsById[activeModel.id]?.quantity ?? 1 : 1
        }
        confirmLabel="Reserve"
        onSubmit={handleReserveSubmit}
        onClose={() => setActiveModel(null)}
      />

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
  // Book-by-model rows
  modelInfo: {
    flex: 1,
    gap: 2,
  },
  modelMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  modelReserveButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primaryBg,
  },
  modelReserveButtonDisabled: {
    backgroundColor: colors.backgroundTertiary,
  },
  modelReserveText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primary,
  },
  modelReserveTextDisabled: {
    color: colors.muted,
  },
  modelRemoveButton: {
    padding: spacing.xs,
  },
  modelsFooter: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: spacing.md,
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
