/**
 * Splits text into its runs of plain text and web links, each with the
 * offset where it starts, so a renderer can key its parts by position in the
 * string instead of by array index.
 *
 * @see {@link file://./linked-text.tsx}
 * @see {@link file://./text-with-link-chips.tsx}
 */
import { segmentText } from "@shelf/links";
import type { TextSegment } from "@shelf/links";

/** One run of `segmentText` with the offset where it starts in the text. */
export interface TextRun {
  /** Offset of the run's first character; unique within one text. */
  start: number;
  segment: TextSegment;
}

/**
 * The runs of `text`, in order, with their offsets.
 *
 * @param text - The text to split
 * @returns Its plain-text and link runs
 */
export function textRuns(text: string): TextRun[] {
  let offset = 0;
  return segmentText(text).map((segment) => {
    const start = offset;
    offset += segment.text.length;
    return { start, segment };
  });
}
