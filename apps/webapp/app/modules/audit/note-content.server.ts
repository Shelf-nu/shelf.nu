/**
 * Audit Note Content Helpers
 *
 * Pure (no DB, no IO) helpers for building the body of audit notes that
 * embed images. Centralised so the Markdoc-injection fix lives in exactly
 * one place: the webapp scan route, the mobile evidence route, and any
 * future caller all go through `buildAuditImagesNoteContent`.
 *
 * Threat model: audit note content is rendered through Markdoc — both in
 * the audit feed UI (`audit-asset-note-item.tsx` → `MarkdownViewer`, which
 * runs `@markdoc/markdoc` with the `audit_images` tag component) and via
 * the server-side sanitizer the PDF path depends on. Any `{%` / `%}` in
 * stored note content is therefore interpreted as a Markdoc tag at render
 * time. A user who can persist `{% audit_images ids="..." /%}` can surface
 * another asset's evidence — this is true for plain condition notes too,
 * not only for the image-evidence note that appends a trusted tag.
 *
 * `stripMarkdocDelimiters` neutralizes that for ALL user-authored note
 * content (plain notes and the user text preceding a trusted image tag).
 * `buildAuditImagesNoteContent` additionally appends the one trusted tag.
 * The repo contract is sanitize-at-write: the feed UI renders note content
 * raw, so write-time stripping is what keeps injected tags out.
 *
 * @see {@link file://./helpers.server.ts} createAuditImageEvidenceNote
 * @see {@link file://./../../routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx}
 * @see {@link file://./../../routes/api+/mobile+/audits.image.ts}
 */

/**
 * Removes Markdoc tag delimiters (`{%` and `%}`) from user-supplied text
 * and trims it, so the text cannot open or close a Markdoc tag when it is
 * concatenated before a trusted `{% audit_images %}` tag.
 *
 * @param raw - Untrusted user content
 * @returns The content with all `{%` / `%}` sequences removed, trimmed
 */
export function stripMarkdocDelimiters(raw: string): string {
  return raw.replace(/\{%|%\}/g, "").trim();
}

/**
 * Builds the body of an image-evidence note: the sanitized user content
 * followed by a single trusted `{% audit_images %}` tag listing the
 * uploaded image ids.
 *
 * @param args.content - Untrusted user note text (will be sanitized)
 * @param args.imageIds - Ids of the AuditImage rows to embed
 * @returns The full note content string ready to persist
 */
export function buildAuditImagesNoteContent({
  content,
  imageIds,
}: {
  content: string;
  imageIds: string[];
}): string {
  const safeContent = stripMarkdocDelimiters(content);
  return `${safeContent}\n\n{% audit_images count=${
    imageIds.length
  } ids="${imageIds.join(",")}" /%}`;
}
