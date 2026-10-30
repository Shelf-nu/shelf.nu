/**
 * Makes text that came from a URL or a third-party page safe to show on a
 * chip. Internal to `@shelf/links`.
 */

/** Longest title or file name a chip shows, in code points. */
const MAX_DISPLAY_LENGTH = 120;

const ELLIPSIS = "\u2026";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Overrides, embeddings, isolates and marks that can reorder what a reader sees. */
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Turns control characters into spaces, removes bidi controls, collapses
 * whitespace and trims.
 */
export function normalizeDisplayText(raw: string): string {
  return raw
    .replace(CONTROL_CHARACTERS, " ")
    .replace(BIDI_CONTROLS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts `text` to the display cap without splitting a surrogate pair. */
export function capDisplayText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= MAX_DISPLAY_LENGTH) return text;
  return characters.slice(0, MAX_DISPLAY_LENGTH).join("").trimEnd();
}

/**
 * Cuts a file name to the display cap at the end of its stem, so the
 * extension that names its kind stays visible: an ellipsis (U+2026) takes the
 * place of the cut end of the stem, and ".pdf" follows it.
 *
 * @param name - A normalized file name whose last dot starts the extension
 */
export function capFileName(name: string): string {
  const characters = Array.from(name);
  if (characters.length <= MAX_DISPLAY_LENGTH) return name;
  const extension = Array.from(name.slice(name.lastIndexOf(".")));
  const stemLength = MAX_DISPLAY_LENGTH - extension.length - 1;
  const stem = characters.slice(0, stemLength).join("").trimEnd();
  return `${stem}${ELLIPSIS}${extension.join("")}`;
}
