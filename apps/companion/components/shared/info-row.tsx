/**
 * InfoRow — a label/value detail row shared across entity detail screens.
 *
 * Renders an icon + label on the left and a value on the right, with an
 * optional chevron + tap affordance when `onPress` is set. Lifted out of the
 * asset detail screen so the asset and kit detail screens render identically.
 *
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} asset detail consumer
 * @see {@link file://../../app/(tabs)/assets/kits/[id].tsx} kit detail consumer
 */
import { memo } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

/**
 * A single label/value row on a detail screen.
 *
 * @param props - Component props.
 * @param props.icon - Ionicons glyph name shown beside the label.
 * @param props.label - The field label.
 * @param props.value - The field value (right-aligned).
 * @param props.onPress - When set, the row becomes tappable and shows a chevron.
 * @param props.accessibilityLabel - A11y label for a tappable row (defaults to `value`).
 * @returns The detail row element.
 */
export const InfoRow = memo(function InfoRow({
  icon,
  label,
  value,
  onPress,
  accessibilityLabel,
}: {
  icon: string;
  label: string;
  value: string;
  /** When set, the row becomes tappable and shows a chevron affordance. */
  onPress?: () => void;
  /** A11y label for the tappable row (defaults to the value text). */
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();

  const content = (
    <>
      <View style={styles.infoLabel}>
        <Ionicons name={icon as any} size={16} color={colors.muted} />
        <Text style={styles.infoLabelText}>{label}</Text>
      </View>
      {/* why: selectable text claims touches — only enable it on static rows */}
      <Text style={styles.infoValue} numberOfLines={2} selectable={!onPress}>
        {value}
      </Text>
      {onPress && (
        <Ionicons name="chevron-forward" size={16} color={colors.mutedLight} />
      )}
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        style={styles.infoRow}
        onPress={onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? value}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.infoRow}>{content}</View>;
});

const useStyles = createStyles((colors) => ({
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  // Label keeps its intrinsic width (no shrink) so the value column starts at a
  // consistent point row-to-row.
  infoLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 0,
  },
  infoLabelText: { fontSize: fontSize.base, color: colors.muted },
  // flex:1 + right-align makes the value hug the right edge — or sit flush
  // against the chevron on tappable rows — instead of floating in the middle.
  // (Previously `justifyContent: space-between` split the leftover space into
  // two gaps once the chevron was added as a third child, so the value drifted
  // to the centre on tappable rows like "Kit".)
  infoValue: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "right",
  },
}));
