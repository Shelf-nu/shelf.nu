/**
 * BatchDrawer: the bottom drawer that lists scanned items with submit and
 * clear controls. Used by the batch scan modes and the booking scan modes.
 *
 * A row can carry a quantity (quantity-tracked assets in the custody modes):
 * it then shows a "n / max" chip that opens the caller's quantity sheet. A row
 * the last submit refused shows the server's reason under its title.
 *
 * Tapping the header collapses the list so the camera is free again during a
 * long run; blockers and the submit button stay. While collapsed, a newly
 * scanned row is named in the header for a moment, so every scan still shows.
 * The drawer height is capped against the window (see
 * `lib/batch-drawer-layout.ts`) so it never reaches the camera controls.
 *
 * @see {@link file://./../../app/(tabs)/scanner.tsx} the host screen
 * @see {@link file://./batch-blockers.tsx} the blocker card above the submit
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { BlockerGroup } from "@/lib/batch-blockers";
import {
  ADDED_FLASH_MS,
  batchDrawerMaxHeight,
  nextAddedFlash,
} from "@/lib/batch-drawer-layout";
import { createStyles } from "@/lib/create-styles";
import {
  fontSize,
  spacing,
  borderRadius,
  hitSlop,
  formatStatus,
} from "@/lib/constants";
import { formatQuantity } from "@/lib/quantity-format";
import { useTheme } from "@/lib/theme-context";
import { BatchBlockers } from "./batch-blockers";

type ScannedItem = {
  /** Entity kind — kits batch alongside assets, mirroring the web scanner. */
  type: "asset" | "kit";
  qrId: string;
  /** Asset id for type=asset, kit id for type=kit. */
  targetId: string;
  title: string;
  status: string;
  mainImage: string | null;
  category: string | null;
  /** Assets only: set when the asset belongs to a kit (part-of-kit blocker). */
  kitId: string | null;
  /** Kits only: number of contained assets (shown in the row meta line). */
  assetCount?: number;
  /**
   * Quantity rows only: the units this row will move, out of `max`. When set,
   * the row shows a chip that calls `onEditQuantity`.
   */
  quantity?: { value: number; max: number; unitOfMeasure: string | null };
  /** Why the last submit did not move this row, shown under its title. */
  error?: string;
};

type BatchDrawerProps = {
  items: ScannedItem[];
  /** Key extractor field: "qrId" for batch scan, "targetId" for booking */
  keyField: "qrId" | "targetId";
  title: string;
  submitLabel: string;
  submitIcon: string;
  isSubmitting: boolean;
  onRemove: (id: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  /** Whether to show status in the item meta line */
  showStatus?: boolean;
  /**
   * Blocker groups for the current action (see lib/batch-blockers.ts).
   * While non-empty the submit button is disabled and the groups render
   * above it with one-tap "Remove" fixes.
   */
  blockers?: BlockerGroup[];
  /** Removes one blocker group's items from the scan list. */
  onResolveBlocker?: (group: BlockerGroup) => void;
  /** Removes every blocked item from the scan list. */
  onResolveAllBlockers?: () => void;
  /** Opens the quantity sheet for a row, by its key field. */
  onEditQuantity?: (id: string) => void;
};

/**
 * Bottom drawer showing a list of scanned items with submit and clear
 * controls. Used by both batch scan and booking check-in modes.
 */
export function BatchDrawer({
  items,
  keyField,
  title,
  submitLabel,
  submitIcon,
  isSubmitting,
  onRemove,
  onClear,
  onSubmit,
  showStatus = true,
  blockers = [],
  onResolveBlocker,
  onResolveAllBlockers,
  onEditQuantity,
}: BatchDrawerProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const hasBlockers = blockers.length > 0;
  const [collapsed, setCollapsed] = useState(false);
  const { flash: flashTitle, clear: clearFlash } = useAddedFlash(
    items,
    keyField,
    title,
    collapsed
  );
  const toggleCollapsed = () => {
    if (collapsed) clearFlash();
    setCollapsed((prev) => !prev);
  };

  return (
    <View
      style={[
        styles.batchDrawer,
        { maxHeight: batchDrawerMaxHeight(windowHeight, hasBlockers) },
      ]}
    >
      {/* Drawer header: the title row folds the list away */}
      <View style={styles.drawerHeader}>
        <View style={styles.drawerToggle}>
          <TouchableOpacity
            testID="batch-drawer-toggle"
            onPress={toggleCollapsed}
            hitSlop={hitSlop.md}
            accessibilityRole="button"
            accessibilityLabel={
              collapsed ? "Expand scanned items" : "Collapse scanned items"
            }
            accessibilityState={{ expanded: !collapsed }}
          >
            <Ionicons
              name={collapsed ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.muted}
            />
          </TouchableOpacity>
          {/* The title toggles too, for a bigger target, but stays plain
              text to assistive tech so the count is read as written. */}
          <Text
            style={styles.drawerTitle}
            numberOfLines={1}
            onPress={toggleCollapsed}
            suppressHighlighting
          >
            {flashTitle ?? title}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClear}
          accessibilityLabel="Clear all scanned items"
          accessibilityRole="button"
        >
          <Text style={styles.drawerClear}>Clear all</Text>
        </TouchableOpacity>
      </View>

      {/* Item list, unmounted while collapsed */}
      {!collapsed && (
        <FlatList
          data={items}
          keyExtractor={(item) => item[keyField]}
          style={styles.drawerList}
          renderItem={({ item }) => (
            <View style={styles.drawerItem}>
              {item.mainImage ? (
                <Image
                  source={{ uri: item.mainImage }}
                  style={styles.drawerItemImage}
                  contentFit="cover"
                />
              ) : (
                <View
                  style={[
                    styles.drawerItemImage,
                    styles.drawerItemImagePlaceholder,
                  ]}
                >
                  <Ionicons
                    name={
                      item.type === "kit" ? "albums-outline" : "cube-outline"
                    }
                    size={16}
                    color={colors.muted}
                  />
                </View>
              )}
              <View style={styles.drawerItemInfo}>
                <Text style={styles.drawerItemTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.drawerItemMeta}>
                  {/* Kits show their size; assets show their category. */}
                  {(() => {
                    const label =
                      item.type === "kit"
                        ? `Kit \u2022 ${item.assetCount ?? 0} asset${
                            item.assetCount === 1 ? "" : "s"
                          }`
                        : item.category || "Asset";
                    return showStatus
                      ? `${label} \u2022 ${formatStatus(item.status)}`
                      : label;
                  })()}
                </Text>
                {item.error ? (
                  <Text
                    style={styles.drawerItemError}
                    accessibilityRole="alert"
                  >
                    {item.error}
                  </Text>
                ) : null}
              </View>
              {item.quantity && onEditQuantity ? (
                <TouchableOpacity
                  testID={`batch-quantity-${item[keyField]}`}
                  style={styles.quantityChip}
                  onPress={() => onEditQuantity(item[keyField])}
                  hitSlop={hitSlop.md}
                  accessibilityRole="button"
                  accessibilityLabel={`Units for ${item.title}: ${
                    item.quantity.value
                  } of ${maxLabel(item.quantity)}`}
                  accessibilityHint="Opens a sheet to change the number of units"
                >
                  <Text style={styles.quantityChipValue}>
                    {item.quantity.value}
                  </Text>
                  <Text style={styles.quantityChipMax}>
                    {`/ ${maxLabel(item.quantity)}`}
                  </Text>
                  <Ionicons name="pencil" size={12} color={colors.muted} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={() => onRemove(item[keyField])}
                hitSlop={hitSlop.md}
                accessibilityLabel={`Remove ${item.title}`}
                accessibilityRole="button"
              >
                <Ionicons name="close-circle" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Blockers — submit stays disabled until the list is clean */}
      {hasBlockers && onResolveBlocker && onResolveAllBlockers && (
        <BatchBlockers
          blockers={blockers}
          onResolve={onResolveBlocker}
          onResolveAll={onResolveAllBlockers}
        />
      )}

      {/* Submit button */}
      <TouchableOpacity
        testID="batch-drawer-submit"
        style={[
          styles.drawerSubmitBtn,
          (isSubmitting || hasBlockers) && { opacity: 0.6 },
        ]}
        onPress={onSubmit}
        disabled={isSubmitting || hasBlockers}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={submitLabel}
        accessibilityState={{ disabled: isSubmitting || hasBlockers }}
      >
        {isSubmitting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name={submitIcon as any} size={20} color="#fff" />
            <Text style={styles.drawerSubmitText}>{submitLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

/**
 * While the drawer is collapsed, names the row a scan just added for
 * `ADDED_FLASH_MS`, then falls back to the plain title.
 *
 * @param items - The drawer rows, newest first.
 * @param keyField - Which field identifies a row.
 * @param title - The drawer's normal title.
 * @param collapsed - Whether the list is folded away.
 * @returns The flash title while one is showing (otherwise null), and a
 *   `clear` the drawer calls when it expands: the list then shows the new row
 *   itself, and a later collapse must not bring back an old flash.
 */
function useAddedFlash(
  items: ScannedItem[],
  keyField: "qrId" | "targetId",
  title: string,
  collapsed: boolean
): { flash: string | null; clear: () => void } {
  const [flash, setFlash] = useState<string | null>(null);
  const previousKeys = useRef<Set<string>>(
    new Set(items.map((item) => item[keyField]))
  );
  // The latest render's values, read when the key list changes.
  const latest = useRef({ items, keyField, title, collapsed });
  useLayoutEffect(() => {
    latest.current = { items, keyField, title, collapsed };
  });
  // The host rebuilds `items` on every render; the key list only changes
  // when rows are added or removed, which is what this reacts to.
  const keySignature = items.map((item) => item[keyField]).join("\n");

  useEffect(() => {
    const now = latest.current;
    const next = nextAddedFlash({
      previousKeys: previousKeys.current,
      rows: now.items.map((item) => ({
        key: item[now.keyField],
        title: item.title,
      })),
      collapsed: now.collapsed,
      title: now.title,
    });
    previousKeys.current = next.keys;
    if (next.flash) setFlash(next.flash);
  }, [keySignature]);

  // Each new flash text restarts the clock; unmounting clears it.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), ADDED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  const clear = useCallback(() => setFlash(null), []);
  return { flash: collapsed ? flash : null, clear };
}

/** "46 m" for a row's cap, or "46" when the asset has no unit. */
function maxLabel(quantity: { max: number; unitOfMeasure: string | null }) {
  return (
    formatQuantity(quantity.max, quantity.unitOfMeasure) ?? String(quantity.max)
  );
}

const useStyles = createStyles((colors, shadows) => ({
  batchDrawer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    // why: must out-rank the scanner's paused overlay (zIndex 5) in hit
    // testing — otherwise the drawer's buttons go dead while the camera is
    // auto-paused, even though the drawer draws on top of the dim layer.
    zIndex: 10,
    ...shadows.md,
  },
  drawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  drawerToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginRight: spacing.md,
    minHeight: 32,
  },
  drawerTitle: {
    flexShrink: 1,
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
  },
  drawerClear: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: "600",
  },
  drawerList: {
    maxHeight: 140,
    // Gives way first when the window cap is tight, so blockers and the
    // submit button stay inside the drawer.
    flexShrink: 1,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  drawerItemImage: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.backgroundTertiary,
  },
  drawerItemImagePlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  drawerItemInfo: {
    flex: 1,
  },
  drawerItemTitle: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  drawerItemMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 1,
  },
  drawerItemError: {
    fontSize: fontSize.xs,
    color: colors.errorText,
    marginTop: 2,
  },
  quantityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
  },
  quantityChipValue: {
    fontSize: fontSize.base,
    fontWeight: "700",
    color: colors.foreground,
  },
  quantityChipMax: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  drawerSubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
  },
  drawerSubmitText: {
    color: "#fff",
    fontSize: fontSize.lg,
    fontWeight: "700",
  },
}));
