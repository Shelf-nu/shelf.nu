/**
 * LinkedParagraph: free text a person typed (a description, a note), with
 * its links tappable in the text and every link to another website repeated
 * as a link chip under it.
 *
 * The chips are the phone's version of the link chips the web app shows in
 * descriptions and notes: a kind icon, the words the URL says (PDF, Google
 * Drive folder, the file name) and a full 44pt touch target, so a document
 * behind a link reads as a document, not a raw URL. A text that is nothing
 * but one such link shows only its chip. Links to Shelf itself (a booking a
 * note names, `app.shelf.nu/assets/...`) stay inline: they open an app
 * screen, not a document. The rule lives in `lib/paragraph-links.ts`.
 *
 * Use this for any user text that can hold a link. Single-line custom field
 * values use `TextWithLinks`, which titles a chip from the stored page title.
 *
 * @see {@link file://./linked-text.tsx}
 * @see {@link file://./link-chip.tsx}
 * @see {@link file://../shared/expandable-text.tsx}
 */
import { memo, useMemo } from "react";
import { View } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import type { TextSegment } from "@shelf/links";
import { paragraphLinks } from "@/lib/paragraph-links";
import { getActiveServer } from "@/lib/server/active-server";
import { findTextLinks } from "@/lib/text-links";
import { spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { ExpandableText } from "../shared/expandable-text";
import { LinkChip } from "./link-chip";
import { LinkedText } from "./linked-text";

/**
 * Text with tappable links and a chip per outside link.
 *
 * @param props - Component props.
 * @param props.text - The text to show. Ignored when `segments` is given.
 * @param props.segments - The text and link runs, when the caller has read
 *   them (an activity note).
 * @param props.style - Text style.
 * @param props.containerStyle - Style of the wrapper around the text and
 *   its chips; put the screen's padding here so the chips line up with
 *   the text.
 * @param props.expandable - Clip the text to `numberOfLines` with a "Show
 *   more" toggle; `label` names the text for screen readers.
 * @param props.selectable - Whether the text can be selected and copied.
 * @param props.inModal - True inside a React Native `Modal`, where a Shelf
 *   screen link opens its web page instead.
 * @param props.testID - Test id of the text (of the chip's wrapper when the
 *   chip stands in for the text).
 * @returns The text and its chips.
 */
export const LinkedParagraph = memo(function LinkedParagraph({
  text,
  segments,
  style,
  containerStyle,
  expandable,
  selectable,
  inModal,
  testID,
}: {
  text: string;
  segments?: readonly TextSegment[];
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  expandable?: { label: string; numberOfLines: number };
  selectable?: boolean;
  inModal?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const runs = useMemo(() => segments ?? findTextLinks(text), [segments, text]);
  const { chips, onlyChip } = useMemo(
    () => paragraphLinks(runs, getActiveServer().baseUrl),
    [runs]
  );

  return (
    <View
      style={[styles.container, containerStyle]}
      testID={onlyChip ? testID : undefined}
    >
      {onlyChip ? null : expandable ? (
        <ExpandableText
          text={runs.map((run) => run.text).join("")}
          segments={runs}
          label={expandable.label}
          numberOfLines={expandable.numberOfLines}
          style={style}
          inModal={inModal}
          testID={testID}
        />
      ) : (
        <LinkedText
          segments={runs}
          style={style}
          selectable={selectable}
          inModal={inModal}
          testID={testID}
        />
      )}
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <LinkChip key={chip.url} chip={chip} inModal={inModal} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

const useStyles = createStyles(() => ({
  container: { gap: spacing.sm },
  chips: { gap: spacing.xs },
}));
