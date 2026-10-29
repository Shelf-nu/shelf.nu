/**
 * Makes text that came from a URL or a third-party page safe to show on a
 * chip. Internal to `@shelf/links`.
 */

/** Longest title or file name a chip shows, in code points. */
const MAX_DISPLAY_LENGTH = 120;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Overrides, embeddings, isolates and marks that can reorder what a reader sees. */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

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
