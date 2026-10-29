/**
 * LinkedText: text with every http(s) URL in it tappable, the rest left as
 * typed. "Manual: https://x.com/a (rev B)" links only the URL.
 *
 * URLs are found by `segmentText` from `@shelf/links`, the same detector the
 * web app links custom field values with. Markdown is not interpreted: a
 * `[label](url)` reads as typed, with its URL tappable.
 *
 * @see {@link file://./text-with-links.tsx}
 * @see {@link file://../../lib/navigation.ts} `openExternalLink`
 */
import { memo, useMemo } from "react";
import { Text } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { segmentText } from "@shelf/links";
import { openExternalLink } from "@/lib/navigation";
import { createStyles } from "@/lib/create-styles";

/**
 * One `Text` with each URL run as a nested, underlined, pressable `Text`.
 *
 * @param props - Component props.
 * @param props.text - The value to show.
 * @param props.style - Style of the whole text; link runs add color and an
 *   underline on top of it.
 * @param props.numberOfLines - Lines shown before the text is clipped.
 * @returns The text element.
 */
export const LinkedText = memo(function LinkedText({
  text,
  style,
  numberOfLines,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const styles = useStyles();
  const segments = useMemo(() => segmentText(text), [text]);

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <Text
            // why: segments come from one string and never reorder
            key={index}
            style={styles.link}
            onPress={() => void openExternalLink(segment.url)}
            accessibilityRole="link"
          >
            {segment.text}
          </Text>
        ) : (
          segment.text
        )
      )}
    </Text>
  );
});

const useStyles = createStyles((colors) => ({
  link: {
    color: colors.primaryText,
    textDecorationLine: "underline",
  },
}));
