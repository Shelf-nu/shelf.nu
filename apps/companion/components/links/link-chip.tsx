/**
 * LinkChip: a stored link shown as a tappable card row, the phone's version
 * of the web app's link chip. Kind icon, the main words (a title, a file name
 * or the kind), a muted line naming the kind and where it lives, and an
 * "opens elsewhere" glyph. Tapping opens the link through `openLink` (the
 * in-app browser for another website); a long-press shows Copy link and
 * Share. At least 44pt tall, so it is the link's full-size touch target
 * wherever it sits under text.
 *
 * @see {@link file://../../lib/custom-field-links.ts} `linkChip` builds the model
 * @see {@link file://../../lib/link-actions.ts} `openLink`, `showLinkMenu`
 */
import { memo, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { LinkChipModel } from "@/lib/custom-field-links";
import { LINK_HINT, useLinkHandlers } from "@/lib/link-actions";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import { LinkIcon } from "./link-icon";
import type { LeaveHandler } from "@/lib/link-dispatch";

/**
 * A full-width chip for one link.
 *
 * @param props - Component props.
 * @param props.chip - What to draw and open, from `linkChip`.
 * @param props.onLeave - Inside a React Native `Modal`: closes it before a
 *   Shelf link opens its app screen underneath.
 * @returns The pressable chip.
 */
export const LinkChip = memo(function LinkChip({
  chip,
  onLeave,
}: {
  chip: LinkChipModel;
  onLeave?: LeaveHandler;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { url } = chip;
  const links = useLinkHandlers({ onLeave });
  const open = useCallback(() => links.open(url), [links, url]);
  const showMenu = useCallback(() => links.showMenu(url), [links, url]);

  return (
    <Pressable
      onPress={open}
      onLongPress={showMenu}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
      accessibilityRole="link"
      accessibilityLabel={chip.label}
      accessibilityHint={LINK_HINT}
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
