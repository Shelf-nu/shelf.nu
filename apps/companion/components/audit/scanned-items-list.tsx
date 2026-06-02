import React, { useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import type { ScannedItem } from "@/hooks/use-audit-init";

const SCANNED_ITEM_HEIGHT = 52;
const keyExtractor = (item: ScannedItem) => item.assetId;

type ScannedItemsListProps = {
  items: ScannedItem[];
  /** Called when a scanned item is tapped to open evidence modal */
  onItemPress?: (item: ScannedItem) => void;
};

export function ScannedItemsList({
  items,
  onItemPress,
}: ScannedItemsListProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const renderItem = useCallback(
    ({ item }: { item: ScannedItem }) => {
      const evidenceCount = (item.notesCount ?? 0) + (item.imagesCount ?? 0);
      const hasEvidence = evidenceCount > 0;
      const syncFailed = item.syncFailed === true;

      return (
        <TouchableOpacity
          style={styles.scannedItem}
          onPress={() => onItemPress?.(item)}
          activeOpacity={0.7}
          accessibilityLabel={`${item.name}, ${
            item.isExpected ? "found" : "unexpected"
          }${hasEvidence ? `, ${evidenceCount} evidence items` : ""}${
            syncFailed ? ", not synced" : ""
          }. Tap to add notes or photos.`}
          accessibilityRole="button"
        >
          <Ionicons
            name={item.isExpected ? "checkmark-circle" : "alert-circle"}
            size={18}
            color={item.isExpected ? colors.success : colors.warning}
          />
          <Text style={styles.scannedItemName} numberOfLines={1}>
            {item.name}
          </Text>
          {hasEvidence && (
            <View style={styles.evidenceBadge}>
              <Ionicons name="attach" size={12} color={colors.muted} />
              <Text style={styles.evidenceCount}>{evidenceCount}</Text>
            </View>
          )}
          {syncFailed ? (
            <View style={styles.syncFailedBadge}>
              <Ionicons
                name="cloud-offline-outline"
                size={12}
                color={colors.warning}
              />
              <Text style={styles.syncFailedText}>Not synced</Text>
            </View>
          ) : (
            <Text style={styles.scannedItemBadge}>
              {item.isExpected ? "Found" : "Unexpected"}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </TouchableOpacity>
      );
    },
    [colors, styles, onItemPress]
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: SCANNED_ITEM_HEIGHT,
      offset: SCANNED_ITEM_HEIGHT * index,
      index,
    }),
    []
  );

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="scan-outline" size={24} color={colors.border} />
        <Text style={styles.emptyText}>Scan a code to begin</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      removeClippedSubviews
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={10}
      style={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const useStyles = createStyles((colors) => ({
  list: {
    flex: 1,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  scannedItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    height: SCANNED_ITEM_HEIGHT,
  },
  scannedItemName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foreground,
  },
  scannedItemBadge: {
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },
  evidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.borderLight,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  evidenceCount: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.foregroundSecondary,
  },
  syncFailedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  syncFailedText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.warning,
  },
}));
