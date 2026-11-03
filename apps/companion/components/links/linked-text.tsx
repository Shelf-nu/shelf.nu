/**
 * LinkedText: text with every web link in it tappable, the rest left as
 * typed. "Manual: https://x.com/a (rev B)" links only the URL, and a bare
 * domain such as "canon.com/r5.pdf" links too.
 *
 * Links are found by `findTextLinks` (`lib/text-links.ts`), which builds on
 * `segmentText` from `@shelf/links`, the detector the web app links custom
 * field values with. A caller that already has the runs (an activity note,
 * whose Markdoc `link` tags name Shelf pages) passes `segments` instead.
 *
 * A tap opens the link through `openLink`: a Shelf screen the app has, or
 * the in-app browser. A long-press shows Copy link and Share, except in
 * selectable text, where it selects text as everywhere else. Link runs are
 * Shelf orange (`primaryText`, AA on every surface) and underlined, and keep
 * the text's font metrics, so a clipped copy measured without links wraps
 * identically.
 *
 * @see {@link file://./linked-paragraph.tsx} text plus link chips
 * @see {@link file://./text-with-links.tsx}
 * @see {@link file://../../lib/link-actions.ts} `openLink`, `showLinkMenu`
 */
import { memo, useMemo } from "react";
import { Text } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { segmentText, type TextSegment } from "@shelf/links";
import { LINK_HINT, useLinkHandlers } from "@/lib/link-actions";
import { findTextLinks } from "@/lib/text-links";
import { createStyles } from "@/lib/create-styles";

/**
 * One `Text` with each link run as a nested, pressable `Text`.
 *
 * @param props - Component props.
 * @param props.text - The value to show. Ignored when `segments` is given.
 * @param props.segments - The text and link runs to show, when the caller
 *   has already read them.
 * @param props.style - Style of the whole text; link runs add the link
 *   color on top of it.
 * @param props.numberOfLines - Lines shown before the text is clipped.
 * @param props.selectable - Whether the text can be selected and copied.
 * @param props.bareDomains - Whether a bare domain links too. False for
 *   custom field values, which link only http(s) URLs, as on the web.
 * @param props.inModal - True inside a React Native `Modal`, where a Shelf
 *   screen link opens its web page instead.
 * @param props.testID - Test id of the outer text.
 * @returns The text element.
 */
export const LinkedText = memo(function LinkedText({
  text,
  segments,
  style,
  numberOfLines,
  selectable,
  bareDomains = true,
  inModal,
  testID,
}: {
  text?: string;
  segments?: readonly TextSegment[];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  bareDomains?: boolean;
  inModal?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const { open, showMenu } = useLinkHandlers({ inModal });
  const runs = useMemo(
    () =>
      segments ??
      (bareDomains ? findTextLinks(text ?? "") : segmentText(text ?? "")),
    [segments, text, bareDomains]
  );

  return (
    <Text
      style={style}
      numberOfLines={numberOfLines}
      selectable={selectable}
      testID={testID}
    >
      {runs.map((segment, index) =>
        segment.type === "link" ? (
          <Text
            // why: runs come from one string and never reorder
            key={index}
            style={styles.link}
            onPress={() => open(segment.url)}
            // why: in selectable text a long-press starts the system's text
            // selection, and a second menu on top of its Copy callout is
            // noise; the link's chip (LinkedParagraph) still has the menu.
            onLongPress={selectable ? undefined : () => showMenu(segment.url)}
            accessibilityRole="link"
            accessibilityHint={selectable ? undefined : LINK_HINT}
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
  // why: underlined as well as orange, so a link is not told apart by
  // colour alone (WCAG 1.4.1); an underline leaves the line metrics alone.
  link: { color: colors.primaryText, textDecorationLine: "underline" },
}));
