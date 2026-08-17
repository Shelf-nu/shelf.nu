import { AUDIT_ASSET_STATUS_LABELS } from "@shelf/labels";
import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { createStyles } from "@/lib/create-styles";
import { fontSize, borderRadius } from "@/lib/constants";

export type ListTab = "scanned" | "remaining";

type SegmentedControlProps = {
  activeTab: ListTab;
  onTabChange: (tab: ListTab) => void;
  scannedCount: number;
  remainingCount: number;
  /**
   * How many scanned items were NOT on this audit. Surfaced on the tab itself
   * because an unexpected asset is the finding an audit exists to produce, and
   * it was previously discoverable only by reading every row.
   */
  unexpectedCount?: number;
  /** True while the Scanned list is filtered to unexpected items only. */
  unexpectedFilterActive?: boolean;
  /**
   * Toggles that filter. The badge is the control: tapping the count is how a
   * user asks to see just the exceptions, which is why the exceptions are NOT
   * reordered into the feed — see the scan screen for that reasoning.
   */
  onUnexpectedPress?: () => void;
};

export function SegmentedControl({
  activeTab,
  onTabChange,
  scannedCount,
  remainingCount,
  unexpectedCount = 0,
  unexpectedFilterActive = false,
  onUnexpectedPress,
}: SegmentedControlProps) {
  const styles = useStyles();

  return (
    <View style={styles.segmentedControl} accessibilityRole="tablist">
      <TouchableOpacity
        style={[
          styles.segmentedOption,
          activeTab === "scanned" && styles.segmentedOptionActive,
        ]}
        onPress={() => onTabChange("scanned")}
        activeOpacity={0.7}
        accessibilityRole="tab"
        accessibilityState={{ selected: activeTab === "scanned" }}
        accessibilityLabel={`Scanned ${scannedCount}${
          unexpectedCount > 0 ? `, ${unexpectedCount} not on this audit` : ""
        }`}
      >
        <Text
          style={[
            styles.segmentedOptionText,
            activeTab === "scanned" && styles.segmentedOptionTextActive,
          ]}
        >
          Scanned ({scannedCount})
        </Text>
        {/* why: a count that only appears when it is non-zero reads as an
            alert rather than a permanent decoration. */}
        {unexpectedCount > 0 ? (
          <TouchableOpacity
            onPress={onUnexpectedPress}
            activeOpacity={0.7}
            // why: a bare count reads as decoration. Naming the action in the
            // label is what tells a screen-reader user it filters.
            accessibilityRole="button"
            accessibilityState={{ selected: unexpectedFilterActive }}
            accessibilityLabel={`${unexpectedCount} not on this audit. ${
              unexpectedFilterActive ? "Showing only these" : "Show only these"
            }`}
            // why: the count is small, so widen the touch target rather than
            // the pill — 44pt is the minimum comfortable tap area.
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.unexpectedPill,
              unexpectedFilterActive && styles.unexpectedPillActive,
            ]}
          >
            <Text style={styles.unexpectedPillText}>{unexpectedCount}</Text>
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.segmentedOption,
          activeTab === "remaining" && styles.segmentedOptionActive,
        ]}
        onPress={() => onTabChange("remaining")}
        activeOpacity={0.7}
        accessibilityRole="tab"
        accessibilityState={{ selected: activeTab === "remaining" }}
        accessibilityLabel={`${AUDIT_ASSET_STATUS_LABELS.PENDING} ${remainingCount}`}
      >
        <Text
          style={[
            styles.segmentedOptionText,
            activeTab === "remaining" && styles.segmentedOptionTextActive,
          ]}
        >
          {AUDIT_ASSET_STATUS_LABELS.PENDING} ({remainingCount})
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  unexpectedPill: {
    marginLeft: 6,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  unexpectedPillActive: {
    // why: an active filter must look pressed, or tapping it again to clear is
    // not discoverable.
    borderWidth: 2,
    borderColor: colors.foreground,
  },
  unexpectedPillText: {
    fontSize: fontSize.xs,
    fontWeight: "700",
    color: colors.white,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: colors.borderLight,
    borderRadius: borderRadius.md,
    padding: 2,
    gap: 2,
  },
  segmentedOption: {
    flexDirection: "row",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: borderRadius.sm,
  },
  segmentedOptionActive: {
    backgroundColor: colors.filterPillActiveBg,
  },
  segmentedOptionText: {
    fontSize: fontSize.sm,
    fontWeight: "600" as const,
    color: colors.muted,
  },
  segmentedOptionTextActive: {
    color: colors.filterPillActiveText,
  },
}));
