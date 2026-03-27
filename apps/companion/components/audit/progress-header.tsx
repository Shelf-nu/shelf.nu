import React from "react";
import { View, Text, Animated } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing } from "@/lib/constants";

type ProgressHeaderProps = {
  foundCount: number;
  expectedCount: number;
  unexpectedCount: number;
  progressAnim: Animated.Value;
  progressPercent: number;
};

export function ProgressHeader({
  foundCount,
  expectedCount,
  unexpectedCount,
  progressAnim,
  progressPercent,
}: ProgressHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.progressSection}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>
          {foundCount}/{expectedCount} found
        </Text>
        {unexpectedCount > 0 && (
          <Text style={styles.progressUnexpected}>
            +{unexpectedCount} unexpected
          </Text>
        )}
        <Text style={styles.progressPercent}>{progressPercent}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
              backgroundColor:
                progressPercent === 100 ? colors.success : colors.progressBar,
            },
          ]}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  progressSection: {
    gap: spacing.xs,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  progressLabel: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  progressUnexpected: {
    fontSize: fontSize.xs,
    color: colors.warning,
    fontWeight: "500",
  },
  progressPercent: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.progressBar,
    marginLeft: "auto",
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
}));
