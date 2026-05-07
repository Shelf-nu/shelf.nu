import React, { useCallback } from "react";
import { View, Text, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import type { ScannedItem } from "@/hooks/use-audit-init";

const SCANNED_ITEM_HEIGHT = 52;
const keyExtractor = (item: ScannedItem) => item.assetId;

type ScannedItemsListProps = {
  items: ScannedItem[];
};

export function ScannedItemsList({ items }: ScannedItemsListProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const renderItem = useCallback(
    ({ item }: { item: ScannedItem }) => (
      <View style={styles.scannedItem}>
        <Ionicons
          name={item.isExpected ? "checkmark-circle" : "alert-circle"}
          size={18}
          color={item.isExpected ? colors.success : colors.warning}
        />
        <Text style={styles.scannedItemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.scannedItemBadge}>
          {item.isExpected ? "Found" : "Unexpected"}
        </Text>
      </View>
    ),
    [colors, styles]
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
}));
