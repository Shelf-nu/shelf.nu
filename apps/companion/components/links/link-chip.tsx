/**
 * LinkChip: a stored link shown as a tappable card row, the phone's version
 * of the web app's link chip. Kind icon, the main words (a title, a file name
 * or the kind), a muted line naming the kind and where it lives, and an
 * "opens elsewhere" glyph. Tapping opens the link through `openExternalLink`.
 *
 * @see {@link file://../../lib/custom-field-links.ts} `linkChip` builds the model
 * @see {@link file://../../lib/navigation.ts} `openExternalLink`
 */
import { memo, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LinkChipModel } from "@/lib/custom-field-links";
import { openExternalLink } from "@/lib/navigation";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import { LinkIcon } from "./link-icon";

/**
 * A full-width chip for one link.
 *
 * @param props - Component props.
 * @param props.chip - What to draw and open, from `linkChip`.
 * @returns The pressable chip.
 */
export const LinkChip = memo(function LinkChip({
  chip,
}: {
  chip: LinkChipModel;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { url } = chip;
  const open = useCallback(() => void openExternalLink(url), [url]);

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      accessibilityRole="link"
      accessibilityLabel={chip.label}
    >
      <View style={styles.iconBox}>
        <LinkIcon icon={chip.icon} size={18} color={colors.iconActive} />
      </View>
      <View style={styles.words}>
        <Text style={styles.primary} numberOfLines={2}>
          {chip.primary}
        </Text>
        {chip.meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {chip.meta}
          </Text>
        ) : null}
      </View>
      <Ionicons name="open-outline" size={16} color={colors.mutedLight} />
    </Pressable>
  );
});

const useStyles = createStyles((colors) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.white,
  },
  chipPressed: { backgroundColor: colors.backgroundTertiary },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    backgroundColor: colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  words: { flex: 1, gap: 2 },
  primary: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  meta: { fontSize: fontSize.xs, color: colors.muted },
}));
