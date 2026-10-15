/**
 * ArchivedNotice: the calm grey line that says something on screen is
 * archived and why it cannot be changed.
 *
 * Shown on an archived asset's own screen, which archiving turns read-only.
 * The words come from `@shelf/labels` (`archivedAssetBlockedReason`), which
 * makes them role-aware.
 * An optional action (Reinstate, for members who hold `asset: archive`) sits
 * on the right.
 *
 * Deliberately not an error or a warning colour: archiving is a normal,
 * reversible state, not a fault.
 *
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} the consumer
 */
import { memo } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";

/**
 * The archived notice.
 *
 * @param props - Component props.
 * @param props.message - The sentence to show (from `lib/archived-assets.ts`).
 * @param props.actionLabel - Label of the optional action button.
 * @param props.actionAccessibilityLabel - Screen-reader label for the action.
 * @param props.onAction - Called when the action is tapped. No button without it.
 * @param props.busy - Shows a spinner in place of the action while it runs.
 * @returns The notice element.
 */
export const ArchivedNotice = memo(function ArchivedNotice({
  message,
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  busy = false,
}: {
  message: string;
  actionLabel?: string;
  actionAccessibilityLabel?: string;
  onAction?: () => void;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.notice}>
      <Ionicons name="archive-outline" size={18} color={colors.muted} />
      <Text style={styles.message}>{message}</Text>
      {onAction && actionLabel ? (
        busy ? (
          <ActivityIndicator size="small" color={colors.muted} />
        ) : (
          <TouchableOpacity
            style={styles.action}
            onPress={onAction}
            // The visible pill is compact; the slop brings the touch target
            // to the 44pt minimum.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
});

const useStyles = createStyles((colors) => ({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  message: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.gray700,
  },
  action: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.gray300,
    backgroundColor: colors.white,
  },
  actionText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.gray700,
  },
}));
