/**
 * @file Client-side CSV validation helpers for the bulk update import flow.
 * Provides lightweight validation and parsing utilities that run in the browser
 * before the file is sent to the server. The server uses `csv-parse` for
 * authoritative parsing — these helpers are for quick feedback only.
 *
 * @see {@link file://./form.tsx} Consumer of these helpers
 * @see {@link file://./../../../utils/csv.server.ts} Server-side CSV parsing
 */
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";

/**
 * Identifier columns we accept, in order of preference. Matched
 * case-insensitively (see `validateCsvClientSide` below) to mirror the
 * server-side `analyzeUpdateHeaders` — this matters because the
 * Import-ready export's identifier header is the lowercase content-importer
 * key `"id"`, not the Standard export's display label `"ID"`.
 */
export const ACCEPTED_ID_COLUMNS = ["Asset ID", "ID"] as const;

/** Maximum number of asset change rows to display in the preview */
export const PREVIEW_DISPLAY_LIMIT = 50;

/** What {@link splitCsvRecords} found in a CSV document. */
export interface CsvRecordSplit {
  /** One string per record, header first. Blank records are dropped. */
  records: string[];
  /**
   * The text ended inside a quoted field, so a `"` is unbalanced. Records
   * after the stray quote were absorbed into one, making the row count wrong.
   */
  unterminatedQuote: boolean;
}

export interface ClientValidation {
  valid: boolean;
  /** Which identifier column was found (null if none) */
  idColumnFound: string | null;
  headerCount: number;
  rowCount: number;
  warnings: string[];
}

/**
 * Validates CSV text client-side before sending to the server.
 * Checks for BOM, identifier columns, and basic structure.
 */
export function validateCsvClientSide(text: string): ClientValidation {
  // Strip BOM that Excel adds to UTF-8 CSVs
  const cleanText = text.replace(/^\uFEFF/, "");
  const { records, unterminatedQuote } = splitCsvRecords(cleanText);
  if (records.length === 0) {
    return {
      valid: false,
      idColumnFound: null,
      headerCount: 0,
      rowCount: 0,
      warnings: ["File appears to be empty."],
    };
  }

  // Parse the header record (simple CSV split — handles most cases)
  const headers = parseSimpleCsvLine(records[0]);
  const headerTrimmed = headers.map((h) => h.trim());

  // Find best available identifier column (priority order). Case-insensitive
  // so the Import-ready export's lowercase "id" header is recognized here
  // the same way `analyzeUpdateHeaders` recognizes it server-side.
  const idColumnFound =
    ACCEPTED_ID_COLUMNS.find((col) =>
      headerTrimmed.some((h) => h.toLowerCase() === col.toLowerCase())
    ) ?? null;

  const rowCount = Math.max(0, records.length - 1);
  const warnings: string[] = [];

  if (!idColumnFound) {
    warnings.push(
      "No identifier column found. Your CSV needs an Asset ID or ID column to match rows to existing assets."
    );
  }

  if (unterminatedQuote) {
    // Say what is wrong rather than reporting the symptom. A stray quote
    // absorbs every following row into one record, so without this the file
    // looks empty or short — and the real cause is nowhere on screen.
    warnings.push(
      'Unbalanced quote: a " is opened and never closed, so the rows after it run together. Write a literal quote as two ("").'
    );
  } else if (rowCount === 0) {
    warnings.push("No data rows found — only a header row.");
  }

  return {
    valid: !!idColumnFound && rowCount > 0 && !unterminatedQuote,
    idColumnFound,
    headerCount: headerTrimmed.filter(Boolean).length,
    rowCount,
    warnings,
  };
}

/**
 * Splits CSV text into records, honouring quoted fields.
 *
 * A quoted field may contain line breaks — a description typed with paragraph
 * breaks is the common case — and such a field spans several lines of the file
 * while still being ONE record. Splitting on newlines alone counts each of
 * those lines as a row, so a file of 174 assets reports hundreds.
 *
 * Quotes are preserved in the returned records, because {@link
 * parseSimpleCsvLine} splits on the delimiters they protect. Blank records are
 * dropped.
 *
 * @param text - Full CSV text, BOM already stripped
 * @returns The records (header first) and whether the text ended mid-quote
 */
export function splitCsvRecords(text: string): CsvRecordSplit {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      // A doubled quote is an escaped quote, not a boundary.
      //
      // Redundant by construction: two adjacent quotes toggle `inQuotes` twice,
      // which lands on the state this branch keeps, and no line break can sit
      // between them — so removing it changes no output. It is kept because it
      // states the intent, and because a future splitter that reads `inQuotes`
      // mid-field would need it. Do not read it as load-bearing today.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      // Consume CRLF as a single break. Also redundant on its own — the blank
      // check below already drops the empty record a lone `\n` would push —
      // but it keeps the boundary explicit rather than incidental.
      if (char === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) records.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) records.push(current);

  // Ending inside a quoted field means a `"` was opened and never closed.
  // Everything after it was absorbed into one record, so the count is wrong and
  // the file will not parse server-side either.
  return { records, unterminatedQuote: inQuotes };
}

/**
 * Simple CSV parser for one record, for client-side validation.
 * Handles quoted values (via {@link stripQuotes}) and both `,` and `;` delimiters.
 *
 * Takes a single record, not a slice of the file: record boundaries are
 * {@link splitCsvRecords}'s job, because a quoted field can carry line breaks.
 *
 * Note: This is intentionally simplified for quick client-side checks.
 * It does not handle encoding/BOM detection or leading whitespace trimming.
 * The server uses `csv-parse` with full encoding detection and edge-case
 * handling as the source of truth.
 */
export function parseSimpleCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Handle escaped quotes ("") inside quoted fields
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === "," || char === ";") && !inQuotes) {
      result.push(stripQuotes(current.trim()));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(stripQuotes(current.trim()));
  return result;
}

/**
 * Formats an unrecognized-column header for display in the preview's
 * "we skipped these columns" chips.
 *
 * A `cf:<Name>,type:<TYPE>` header (content-importer / import-ready export
 * vocabulary) landing in `unrecognizedColumns` means it names a custom
 * field that doesn't exist in THIS workspace (see `analyzeUpdateHeaders`).
 * Rendering the raw header there made the "create a matching Custom Field"
 * advice point at creating a field literally named `cf:Serial,type:TEXT`
 * instead of `Serial`. Parse it down to just the field name so the chip
 * (and the advice next to it) reflect what the user should actually create.
 *
 * @param header - Raw unrecognized CSV header
 * @returns The custom-field name for a `cf:` header, or the header unchanged
 */
export function formatUnrecognizedColumnLabel(header: string): string {
  // Same length + prefix guard as `analyzeUpdateHeaders` — avoids the
  // non-null assertion inside `getDefinitionFromCsvHeader` for a
  // malformed `cf:` header with no name segment.
  if (header.length > 3 && header.slice(0, 3).toLowerCase() === "cf:") {
    return getDefinitionFromCsvHeader(header).name;
  }
  return header;
}

/** Strip enclosing double-quotes from a CSV value */
function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Escape a value for CSV output — wraps in quotes if needed.
 * Also prefixes spreadsheet formula triggers (`=`, `+`, `-`, `@`)
 * with a single quote to prevent formula injection in Excel/Sheets.
 */
export function escapeCsvValue(value: string): string {
  // Prevent spreadsheet formula injection — always quote so the
  // leading apostrophe stays inside the quoted field
  if (/^[=+\-@]/.test(value)) {
    const safe = `'${value}`;
    return `"${safe.replace(/"/g, '""')}"`;
  }
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
