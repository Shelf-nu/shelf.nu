/**
 * Which link chips a paragraph of free text (a description, a note) shows
 * under it, and whether the text itself is still worth showing.
 *
 * Each link to another website gets one chip, in the order the links
 * appear, at most `MAX_PARAGRAPH_CHIPS`. Links to Shelf itself (the claimed
 * host or the connected server) get none: they open an app screen or a
 * Shelf page, not a document. A text that is nothing but one such link
 * shows only its chip.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../components/links/linked-paragraph.tsx}
 * @see {@link file://./paragraph-links.test.ts}
 */

import type { TextSegment } from "@shelf/links";
import { linkChip, type LinkChipModel } from "./custom-field-links";
import { isExternalLink } from "./open-link";

/** Chips under one text at most; a longer list of links stays inline only. */
export const MAX_PARAGRAPH_CHIPS = 6;

/** The chips under a paragraph, and whether its text is shown. */
export type ParagraphLinks = {
  readonly chips: readonly LinkChipModel[];
  /** True when the text is one outside link and nothing else. */
  readonly onlyChip: boolean;
};

/**
 * Reads the chips for a paragraph's text and link runs.
 *
 * @param runs - The paragraph's runs, from `findTextLinks` or a note reader.
 * @param serverUrl - Base URL of the connected Shelf server.
 * @returns The chips and whether the chip stands in for the whole text.
 */
export function paragraphLinks(
  runs: readonly TextSegment[],
  serverUrl: string
): ParagraphLinks {
  const seen = new Set<string>();
  const chips: LinkChipModel[] = [];
  for (const run of runs) {
    if (run.type !== "link" || seen.has(run.url)) continue;
    if (!isExternalLink(run.url, serverUrl)) continue;
    seen.add(run.url);
    const chip = linkChip(run.url, undefined);
    if (chip) chips.push(chip);
  }

  const visible = runs.filter(
    (run) => run.type === "link" || run.text.trim() !== ""
  );
  return {
    chips: chips.slice(0, MAX_PARAGRAPH_CHIPS),
    onlyChip: visible.length === 1 && chips.length === 1,
  };
}
