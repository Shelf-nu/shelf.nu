/**
 * CharacterCount shows how many characters a field holds against its limit,
 * for example "1,510 / 5,000", right-aligned under the field. It turns red
 * once the count is over the limit, so the user can see why a save is refused.
 *
 * Display only: it never stops the user typing. The screen's own validation
 * refuses an over-limit save. Matches the web's `CharacterCount` in
 * `apps/webapp/app/components/shared/character-count.tsx`.
 *
 * @see {@link file://../../lib/asset-description.ts} countCharacters and the description limit
 */
import { Text } from "react-native";
import { fontSize } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

/**
 * A live "count / max" line for a text field.
 *
 * @param props - Component props.
 * @param props.count - Characters the field currently holds.
 * @param props.max - The most characters the field accepts.
 * @returns The counter text.
 */
export function CharacterCount({ count, max }: { count: number; max: number }) {
  const styles = useStyles();
  const isOver = count > max;
  const countLabel = count.toLocaleString("en-US");
  const maxLabel = max.toLocaleString("en-US");

  return (
    <Text
      style={[styles.count, isOver && styles.countOver]}
      accessibilityLabel={`${countLabel} of ${maxLabel} characters`}
    >
      {countLabel} / {maxLabel}
    </Text>
  );
}

const useStyles = createStyles((colors) => ({
  count: {
    alignSelf: "flex-end",
    marginTop: 4,
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
    color: colors.muted,
  },
  countOver: {
    color: colors.error,
  },
}));
