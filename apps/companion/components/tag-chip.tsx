/**
 * Read-only tag chip.
 *
 * One rendering for a tag wherever the app *displays* one, so the same tag does
 * not look like a different thing on two screens. This is deliberately NOT the
 * chip used by the tag pickers (`bookings/new.tsx`, `bookings/edit.tsx`,
 * `components/asset-edit/tag-picker-field.tsx`): those carry selection and
 * remove affordances, and their fill encodes selected-vs-not rather than the
 * tag's own colour.
 *
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} — booking detail
 */

import { Text, View } from "react-native";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

/** A tag as the mobile API returns it. `color` is absent on older payloads. */
type TagChipTag = {
  id: string;
  name: string;
  color?: string | null;
};

/**
 * React Native throws on a malformed colour string on Android rather than
 * ignoring it, and `Tag.color` is workspace data we do not control, so the
 * value is only used once it looks like a hex colour.
 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Renders a tag as a chip with its workspace colour shown as a leading dot.
 *
 * The colour is carried by the dot rather than by the text or fill (which is
 * how the webapp badge does it) because the webapp derives its text colour by
 * darkening the tag hue — that assumes a light background, and this app has a
 * dark theme. A dot keeps the colour legible in both themes while text contrast
 * stays owned by the palette.
 *
 * @param tag - The tag to render; a missing or malformed `color` renders the
 *   chip without a dot rather than failing
 */
export function TagChip({ tag }: { tag: TagChipTag }) {
  const styles = useStyles();
  const color = tag.color?.trim();
  const dotColor = color && HEX_COLOR.test(color) ? color : null;

  return (
    <View style={styles.chip}>
      {dotColor ? (
        // Decorative: the name right next to it already carries the meaning.
        <View
          accessible={false}
          importantForAccessibility="no"
          style={[styles.dot, { backgroundColor: dotColor }]}
        />
      ) : null}
      <Text style={styles.text}>{tag.name}</Text>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontSize: fontSize.xs,
    color: colors.foregroundSecondary,
  },
}));
