/**
 * ExpandableText: text a person typed, clipped to a few lines, with a
 * "Show more" toggle when it runs longer.
 *
 * When the text fits, it renders like a plain `<Text numberOfLines>`. When it
 * does not, a "Show more" button under it reveals the full text and "Show
 * less" clips it again. Use it for free text, where a few line breaks can hide
 * most of what was written; the `local-rules/no-clipped-user-text` lint rule
 * points clipped user text here. The toggle's screen-reader label says
 * "description", so text of another kind needs a label prop first.
 *
 * Overflow is measured on a hidden, unclipped copy laid out at the same width
 * and style. The clipped Text's own `onTextLayout` cannot answer it: Android
 * reports only the visible lines, iOS reports all of them.
 *
 * @see {@link file://../../eslint-local-rules/no-clipped-user-text.cjs}
 * @see {@link file://../../app/(tabs)/bookings/[id].tsx} booking description
 * @see {@link file://../../app/(tabs)/audits/[id].tsx} audit description
 */
import { memo, useCallback, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { StyleProp, TextLayoutEvent, TextStyle } from "react-native";
import { fontSize, hitSlop, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

/**
 * Text clipped to `numberOfLines`, expandable when it overflows.
 *
 * @param props - Component props.
 * @param props.text - The text to show.
 * @param props.numberOfLines - Lines shown while collapsed.
 * @param props.style - Text style. The hidden measuring copy uses it too, so
 *   font size and line height belong here, not on a wrapper.
 * @param props.testID - Test id of the text. The toggle gets `<testID>-toggle`.
 * @returns The text, plus the toggle when the text overflows.
 */
export const ExpandableText = memo(function ExpandableText({
  text,
  numberOfLines,
  style,
  testID,
}: {
  text: string;
  numberOfLines: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(false);
  const [lineCount, setLineCount] = useState(0);

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
      {/* Reports again whenever its lines change: new text or a new width. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={style} onTextLayout={handleMeasure}>
          {text}
        </Text>
      </View>
      {lineCount > numberOfLines ? (
        <TouchableOpacity
          style={styles.toggle}
          onPress={toggle}
          hitSlop={hitSlop.lg}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Show less description" : "Show more description"
          }
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
