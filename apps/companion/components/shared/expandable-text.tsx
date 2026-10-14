/**
 * ExpandableText: text a person typed, clipped to a few lines, with a
 * "Show more" toggle when it runs longer.
 *
 * When the text fits, it renders like a plain `<Text numberOfLines>`. When it
 * does not, a "Show more" button under it reveals the full text and "Show
 * less" clips it again. Use it for free text, where a few line breaks can hide
 * most of what was written; the `local-rules/no-clipped-user-text` lint rule
 * points clipped user text here. `label` names the text for screen readers,
 * so the toggle reads "Show more description" or "Show more note".
 *
 * Overflow is measured on a hidden, unclipped copy laid out at the same width
 * and style. The clipped Text's own `onTextLayout` cannot answer it: Android
 * reports only the visible lines, iOS reports all of them. Before that
 * measurement arrives, the line breaks in the text are a lower bound on its
 * line count, so text with more breaks than `numberOfLines` (the usual case:
 * a short list) shows the toggle on the first frame and nothing below it
 * moves. Only text that overflows by wrapping alone gains the toggle a frame
 * later.
 *
 * @see {@link file://../../eslint-local-rules/no-clipped-user-text.cjs}
 * @see {@link file://../../app/(tabs)/bookings/[id].tsx} booking description
 * @see {@link file://../../app/(tabs)/audits/[id].tsx} audit description
 */
import { memo, useCallback, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, TextLayoutEvent, TextStyle } from "react-native";
import { fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

/**
 * Text clipped to `numberOfLines`, expandable when it overflows.
 *
 * @param props - Component props.
 * @param props.text - The text to show.
 * @param props.label - What the text is, for screen readers ("description",
 *   "note"). The toggle is announced as "Show more <label>".
 * @param props.numberOfLines - Lines shown while collapsed.
 * @param props.style - Text style. The hidden measuring copy uses it too, so
 *   font size and line height belong here, not on a wrapper.
 * @param props.testID - Test id of the text. The toggle gets `<testID>-toggle`.
 * @returns The text, plus the toggle when the text overflows.
 */
export const ExpandableText = memo(function ExpandableText({
  text,
  label,
  numberOfLines,
  style,
  testID,
}: {
  text: string;
  label: string;
  numberOfLines: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState(() => countLineBreaks(text));

  const handleMeasure = useCallback((event: TextLayoutEvent) => {
    setLineCount(event.nativeEvent.lines.length);
  }, []);
  const toggle = useCallback(() => setExpanded((open) => !open), []);

  return (
    <View>
      <Text
        style={style}
        numberOfLines={expanded ? undefined : numberOfLines}
        testID={testID}
      >
        {text}
      </Text>
      {/* Reports again whenever its lines change: new text or a new width.
          Trailing whitespace is left out: Android can lay out a final line
          break as an empty extra line, which would ask for a toggle that
          reveals nothing. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={style} onTextLayout={handleMeasure}>
          {text.trimEnd()}
        </Text>
      </View>
      {lineCount > numberOfLines ? (
        <TouchableOpacity
          style={styles.toggle}
          onPress={toggle}
          hitSlop={TOGGLE_HIT_SLOP}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${
            expanded ? "Show less" : "Show more"
          } ${label}`}
          accessibilityState={{ expanded }}
          testID={testID ? `${testID}-toggle` : undefined}
        >
          <Text style={styles.toggleText}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

/**
 * Touch area around the toggle. Nothing above it: the text's last visible line
 * sits right there, and a tap meant for the text must not toggle it.
 */
const TOGGLE_HIT_SLOP = { top: 0, bottom: 12, left: 12, right: 12 } as const;

/**
 * The number of lines the text has before any wrapping: one per line break,
 * trailing whitespace left out to match the measured copy.
 *
 * @param text - The text to count.
 * @returns The line count, at least 1.
 */
function countLineBreaks(text: string) {
  return text.trimEnd().split("\n").length;
}

const useStyles = createStyles((colors) => ({
  measure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
  toggle: {
    alignSelf: "flex-start",
    paddingTop: spacing.xs,
  },
  toggleText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primaryText,
  },
}));
