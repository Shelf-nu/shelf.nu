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
 * Row anatomy, and why it is asymmetric:
 * - EXPECTED rows carry NO "Found" label. The tab is already called Scanned
 *   and the green tick already says it, so a third copy of the same fact
 *   spent the row's best space on nothing. That space now shows the asset's
 *   LOCATION, which is what a person standing in a room actually needs.
 * - UNEXPECTED rows keep their word, because there it carries information:
 *   this asset was not on the list. They are NOT reordered into the feed —
 *   the scan list stays newest-first so a fresh scan confirms itself. The
 *   exception count on the tab is the filter instead (see the scan screen).
 *
 * @see {@link file://./evidence-modal.tsx} what a row opens
 * @see {@link file://./evidence-coachmark.tsx} the one-time hint above the list
 */
import React, { useCallback } from "react";
import { View, Text, FlatList, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import type { ScannedItem } from "@/hooks/use-audit-init";

const SCANNED_ITEM_HEIGHT = 58;
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
          // why: the visible "Found" label was removed as redundant, but a
          // screen reader has no tab context and no colour, so the state stays
          // in the spoken label along with the location.
          accessibilityLabel={`${item.name?.trim() || "Untitled asset"}, ${
            item.isExpected ? "found" : "unexpected, not on this audit"
          }${item.locationName ? `, at ${item.locationName}` : ""}${
            hasEvidence ? `, ${evidenceCount} evidence items` : ""
          }${syncFailed ? ", not synced" : ""}. Tap to add notes or photos.`}
          accessibilityRole="button"
        >
          <Ionicons
            name={item.isExpected ? "checkmark-circle" : "alert-circle"}
            size={18}
            color={item.isExpected ? colors.success : colors.warning}
          />
          {item.thumbnailImage ? (
            <Image
              source={{ uri: item.thumbnailImage }}
              style={styles.scannedItemThumb}
              resizeMode="cover"
            />
          ) : null}
          <View style={styles.scannedItemText}>
            <Text style={styles.scannedItemName} numberOfLines={1}>
              {/* why: an older scan can arrive with an empty title (deleted or
                  never-titled asset). Falling through to a blank line loses the
                  row entirely, so name the state instead. */}
              {item.name?.trim() ? item.name : "Untitled asset"}
            </Text>
            {/* The second line is the row's new job: WHERE, not "was it
                scanned". Unexpected assets say so here, because for them that
                IS the useful fact; expected ones show their location. */}
            {item.isExpected ? (
              item.locationName ? (
                <View style={styles.scannedItemMetaRow}>
                  <Ionicons
                    name="location-outline"
                    size={11}
                    color={colors.mutedLight}
                  />
                  <Text style={styles.scannedItemMeta} numberOfLines={1}>
                    {item.locationName}
                  </Text>
                </View>
              ) : null
            ) : (
              <Text style={styles.scannedItemUnexpected} numberOfLines={1}>
                {item.locationName
                  ? `Not on this audit \u00b7 ${item.locationName}`
                  : "Not on this audit"}
              </Text>
            )}
          </View>
          {syncFailed ? (
            <View style={styles.syncFailedBadge}>
              <Ionicons
                name="cloud-offline-outline"
                size={12}
                color={colors.warning}
              />
              <Text style={styles.syncFailedText}>Not synced</Text>
            </View>
          ) : null}
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
  scannedItemThumb: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.border,
    flexShrink: 0,
  },
  scannedItemText: {
    // why: the text column is the ONLY element allowed to give up width — a
    // squeezed "Add photo/note" chip would wrap or clip and stop reading as
    // an action.
    flex: 1,
    flexShrink: 1,
    gap: 1,
  },
  scannedItemName: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foreground,
  },
  scannedItemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  scannedItemMeta: {
    flexShrink: 1,
    fontSize: fontSize.xs,
    // why: `mutedLight` is the icon/large-text grey (4.35:1 light, 3.77:1
    // dark) — it misses 4.5:1 at this 12px size. `muted` keeps the second
    // line quieter than the name and still clears the bar in both themes.
    color: colors.muted,
  },
  scannedItemUnexpected: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    // why: NOT `warning` — that is the badge FILL token and reads 2.35:1 as
    // text on the white row. `warningText` is the foreground twin (7.09:1
    // light) and aliases `warning` in dark mode, so dark is unchanged.
    color: colors.warningText,
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
