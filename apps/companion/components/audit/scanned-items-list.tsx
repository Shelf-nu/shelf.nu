/**
 * ScannedItemsList — the "Scanned" tab of the audit scanner.
 *
 * Each row is a tap target that opens the evidence sheet for that scan, so the
 * trailing element must SAY so: a scan carries an optional condition note and
 * photos, and when the only affordance was a muted chevron, field workers
 * finished audits without ever discovering it. Rows therefore end in an
 * explicit "Add photo/note" action, which becomes the evidence count once
 * something is attached.
 *
 * @see {@link file://./evidence-modal.tsx} what a row opens
 * @see {@link file://./evidence-coachmark.tsx} the one-time hint above the list
 */
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
          {/* The row's whole point beyond "found": attach evidence. Say it in
              words until there is a count to show instead. */}
          {hasEvidence ? (
            <View style={styles.evidenceBadge}>
              <Ionicons name="attach" size={12} color={colors.primaryText} />
              <Text style={styles.evidenceCount}>{evidenceCount}</Text>
            </View>
          ) : (
            <View style={styles.addEvidenceChip}>
              <Ionicons
                name="camera-outline"
                size={13}
                color={colors.primaryText}
              />
              <Text style={styles.addEvidenceText} numberOfLines={1}>
                Add photo/note
              </Text>
            </View>
          )}
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
    // why: the name is the ONLY element allowed to give up width — a squeezed
    // "Add photo/note" chip would wrap or clip and stop reading as an action
    flexShrink: 1,
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foreground,
  },
  scannedItemBadge: {
    flexShrink: 0,
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },
  addEvidenceChip: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xs,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  addEvidenceText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.primaryText,
  },
  evidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 2,
    backgroundColor: colors.primaryBg,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  evidenceCount: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.primaryText,
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
