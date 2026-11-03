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
 * screen, not a document.
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
import type { StyleProp, TextStyle } from "react-native";
import type { TextSegment } from "@shelf/links";
import { linkChip, type LinkChipModel } from "@/lib/custom-field-links";
import { isExternalLink } from "@/lib/open-link";
import { getActiveServer } from "@/lib/server/active-server";
import { findTextLinks } from "@/lib/text-links";
import { spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { ExpandableText } from "../shared/expandable-text";
import { LinkChip } from "./link-chip";
import { LinkedText } from "./linked-text";

/** Chips under one text at most; a longer list of links stays inline only. */
const MAX_CHIPS = 6;

/**
 * The chips for the links to other websites in some runs, one per URL, in
 * the order they appear.
 */
function externalChips(runs: readonly TextSegment[]): LinkChipModel[] {
  const serverUrl = getActiveServer().baseUrl;
  const seen = new Set<string>();
  const chips: LinkChipModel[] = [];
  for (const run of runs) {
    if (run.type !== "link" || seen.has(run.url)) continue;
    if (!isExternalLink(run.url, serverUrl)) continue;
    seen.add(run.url);
    const chip = linkChip(run.url, undefined);
    if (chip) chips.push(chip);
  }
  return chips.slice(0, MAX_CHIPS);
}

/**
 * Text with tappable links and a chip per outside link.
 *
 * @param props - Component props.
 * @param props.text - The text to show. Ignored when `segments` is given,
 *   except as the measured copy of an expandable text.
 * @param props.segments - The text and link runs, when the caller has read
 *   them (an activity note).
 * @param props.style - Text style.
 * @param props.expandable - Clip the text to `numberOfLines` with a "Show
 *   more" toggle; `label` names the text for screen readers.
 * @param props.selectable - Whether the text can be selected and copied.
 * @param props.testID - Test id of the text.
 * @returns The text and its chips.
 */
export const LinkedParagraph = memo(function LinkedParagraph({
  text,
  segments,
  style,
  expandable,
  selectable,
  testID,
}: {
  text: string;
  segments?: readonly TextSegment[];
  style?: StyleProp<TextStyle>;
  expandable?: { label: string; numberOfLines: number };
  selectable?: boolean;
  testID?: string;
}) {
  const styles = useStyles();
  const runs = useMemo(() => segments ?? findTextLinks(text), [segments, text]);
  const chips = useMemo(() => externalChips(runs), [runs]);

  // Nothing but one outside link: its chip says it all.
  const visible = runs.filter(
    (run) => run.type === "link" || run.text.trim() !== ""
  );
  const onlyChip = visible.length === 1 && chips.length === 1;

  return (
    <View style={styles.container}>
      {onlyChip ? null : expandable ? (
        <ExpandableText
          text={runs.map((run) => run.text).join("")}
          segments={runs}
          label={expandable.label}
          numberOfLines={expandable.numberOfLines}
          style={style}
          testID={testID}
        />
      ) : (
        <LinkedText
          segments={runs}
          style={style}
          selectable={selectable}
          testID={testID}
        />
      )}
      {chips.length > 0 ? (
        <View style={styles.chips}>
          {chips.map((chip) => (
            <LinkChip key={chip.url} chip={chip} />
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
