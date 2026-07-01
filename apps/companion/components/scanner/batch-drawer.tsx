import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { BlockerGroup } from "@/lib/batch-blockers";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius, hitSlop } from "@/lib/constants";
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
};

function formatStatus(status: string) {
  if (status === "IN_CUSTODY") return "In Custody";
  if (status === "AVAILABLE") return "Available";
  return status.replace(/_/g, " ");
}

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
}: BatchDrawerProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const hasBlockers = blockers.length > 0;

  return (
    // why: blocker rows add up to ~3 extra rows; without the taller cap the
    // fixed maxHeight clips the submit button out of view
    <View style={[styles.batchDrawer, hasBlockers && { maxHeight: 400 }]}>
      {/* Drawer header */}
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>{title}</Text>
        <TouchableOpacity
          onPress={onClear}
          accessibilityLabel="Clear all scanned items"
          accessibilityRole="button"
        >
          <Text style={styles.drawerClear}>Clear all</Text>
        </TouchableOpacity>
      </View>

      {/* Item list */}
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
                  name={item.type === "kit" ? "albums-outline" : "cube-outline"}
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
            </View>
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

const useStyles = createStyles((colors, shadows) => ({
  batchDrawer: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: 280,
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
  drawerTitle: {
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
