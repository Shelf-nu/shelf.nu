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
};

export function SegmentedControl({
  activeTab,
  onTabChange,
  scannedCount,
  remainingCount,
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
        accessibilityLabel={`Scanned ${scannedCount}`}
      >
        <Text
          style={[
            styles.segmentedOptionText,
            activeTab === "scanned" && styles.segmentedOptionTextActive,
          ]}
        >
          Scanned ({scannedCount})
        </Text>
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
        accessibilityLabel={`Remaining ${remainingCount}`}
      >
        <Text
          style={[
            styles.segmentedOptionText,
            activeTab === "remaining" && styles.segmentedOptionTextActive,
          ]}
        >
          Remaining ({remainingCount})
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: colors.borderLight,
    borderRadius: borderRadius.md,
    padding: 2,
    gap: 2,
  },
  segmentedOption: {
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
