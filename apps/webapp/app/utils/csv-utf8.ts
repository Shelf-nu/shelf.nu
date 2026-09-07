/**
 * @file UTF-8 encoding helpers for CSV downloads.
 *
 * Spreadsheet applications do not assume UTF-8 when they open a `.csv`
 * file. Excel in particular decodes a CSV with the machine's legacy
 * locale codepage unless the file opens with a UTF-8 byte order mark, so
 * any non-Latin content (Arabic, Cyrillic, Greek, CJK, accented Latin)
 * renders as mojibake. Every CSV Shelf hands to a user therefore starts
 * with the BOM and declares `charset=utf-8`.
 *
 * Shelf's own CSV parsers strip a leading BOM, so an exported file stays
 * re-importable.
 *
 * @see {@link file://./csv.server.ts} parseCsv — import side, `bom: true`
 */

/** UTF-8 byte order mark (U+FEFF), encoded as UTF-8 when the string is sent. */
export const UTF8_BOM = "\uFEFF";

/** The content type every CSV download is served with. */
export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/**
 * Prefix a CSV document with the UTF-8 BOM.
 *
 * Idempotent: a document that already carries the mark is returned as-is,
 * so a caller can apply it without knowing what its input did.
 *
 * @param csv - the CSV document
 * @returns the document with exactly one leading BOM
 */
export function withUtf8Bom(csv: string): string {
  return csv.startsWith(UTF8_BOM) ? csv : `${UTF8_BOM}${csv}`;
}

/**
 * Build the `Response` for a CSV download.
 *
 * Adds the BOM and sets `content-type`, so a route only supplies the
 * headers that are its own — `content-disposition`, caching, and so on.
 * Routing every CSV loader through here keeps the encoding a property of
 * the download itself rather than a per-route decision.
 *
 * @param csv - the CSV document, without a BOM
 * @param init - response init; its headers are merged, and `content-type`
 *   is always the UTF-8 one
 * @returns a 200 `Response` carrying the encoded document
 */
export function csvResponse(csv: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", CSV_CONTENT_TYPE);

  return new Response(withUtf8Bom(csv), {
    status: 200,
    ...init,
    headers,
  });
}
