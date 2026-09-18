/**
 * Markdoc delimiter sanitization.
 *
 * Note content is stored as text and rendered through Markdoc, so any `{%` /
 * `%}` sequence in stored content becomes a live tag at render time. Values a
 * user controls (booking names, asset titles, kit names, tag names, free-form
 * note bodies) must therefore be stripped of those delimiters before being
 * spliced into note content as literal text.
 *
 * Lives in its own module rather than in `~/utils/markdoc-wrappers` because
 * `asset-quantity` needs it too and `markdoc-wrappers` already imports from
 * `asset-quantity` — importing back the other way would be a cycle.
 *
 * Prefer a wrapper from `~/utils/markdoc-wrappers` when the value should render
 * as a link or badge; those place it inside a quoted, escaped attribute. Reach
 * for this only when the value must appear as plain text.
 *
 * @see {@link file://./markdoc-wrappers.ts}
 * @see {@link file://./../components/markdown/link-component.tsx} the
 *   render-time guard that also covers content stored before this existed
 */

/** Matches an opening or closing Markdoc tag delimiter. */
const DELIMITER = /\{%|%\}/g;

/**
 * Removes Markdoc tag delimiters (`{%` and `%}`) from user-supplied text and
 * trims it, so the text can neither open nor close a tag once concatenated
 * into note content.
 *
 * Repeats until the string stops changing. A single pass is NOT enough — it
 * can *create* a delimiter out of the characters left behind:
 *
 * ```
 * "{{% … /%}}".replace(/\{%|%\}/g, "")  ===  "{% … /%}"   // a working tag!
 * ```
 *
 * so doubling the delimiters would slip a live tag past a single-pass strip.
 * Each pass strictly shortens the string, so the loop always terminates.
 *
 * Nullish input yields `""` rather than throwing. Many call sites splice
 * optional fields, and a sanitizer that can crash the mutation it guards
 * invites being skipped — mirrors `sanitizeUnitOfMeasureLabel`.
 *
 * @param raw - Untrusted user content
 * @returns The content with every `{%` / `%}` sequence removed, trimmed
 */
export function stripMarkdocDelimiters(raw: string | null | undefined): string {
  let sanitized = raw ?? "";
  let previous: string;

  do {
    previous = sanitized;
    sanitized = sanitized.replace(DELIMITER, "");
  } while (sanitized !== previous);

  return sanitized.trim();
}

/** Matches a whole trusted `{% audit_images ... /%}` tag, attributes and all. */
const AUDIT_IMAGES_TAG = /{%\s*audit_images[^%]*%}/g;

/**
 * Removes the trusted `{% audit_images ... /%}` tag that
 * `buildAuditImagesNoteContent` (`~/modules/audit/note-content.server`)
 * appends to a captioned image-evidence note, leaving the user-authored
 * caption text untouched.
 *
 * Display-only: the tag itself is safe to render (it is appended server-side,
 * never user-controlled — see that module's threat model) and other readers
 * of note content, e.g. the Activity feed and the PDF export, still expand it
 * normally. This helper exists solely for the audit-asset details panel
 * (`AuditAssetNoteItem`), which renders the note body *and* a separate Images
 * grid backed by the same `AuditImage` rows — expanding the tag there
 * duplicated every captioned upload's photos.
 *
 * @param raw - Note content that may contain a trailing `audit_images` tag
 * @returns The content with any `audit_images` tag removed and trimmed
 */
export function stripAuditImagesTag(raw: string | null | undefined): string {
  return (raw ?? "").replace(AUDIT_IMAGES_TAG, "").trim();
}
