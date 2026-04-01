/**
 * @file Client-side CSV validation helpers for the bulk update import flow.
 * Provides lightweight validation and parsing utilities that run in the browser
 * before the file is sent to the server. The server uses `csv-parse` for
 * authoritative parsing — these helpers are for quick feedback only.
 *
 * @see {@link file://./form.tsx} Consumer of these helpers
 * @see {@link file://./../../../utils/csv.server.ts} Server-side CSV parsing
 */

/** Identifier columns we accept, in order of preference */
export const ACCEPTED_ID_COLUMNS = ["Asset ID", "ID"] as const;

/** Maximum number of asset change rows to display in the preview */
export const PREVIEW_DISPLAY_LIMIT = 50;

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
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return {
      valid: false,
      idColumnFound: null,
      headerCount: 0,
      rowCount: 0,
      warnings: ["File appears to be empty."],
    };
  }

  // Parse first line as headers (simple CSV split — handles most cases)
  const headers = parseSimpleCsvLine(lines[0]);
  const headerTrimmed = headers.map((h) => h.trim());

  // Find best available identifier column (priority order)
  const idColumnFound =
    ACCEPTED_ID_COLUMNS.find((col) => headerTrimmed.includes(col)) ?? null;

  const rowCount = Math.max(0, lines.length - 1);
  const warnings: string[] = [];

  if (!idColumnFound) {
    warnings.push(
      "No identifier column found. Your CSV needs an Asset ID or ID column to match rows to existing assets."
    );
  }

  if (rowCount === 0) {
    warnings.push("No data rows found — only a header row.");
  }

  return {
    valid: !!idColumnFound && rowCount > 0,
    idColumnFound,
    headerCount: headerTrimmed.filter(Boolean).length,
    rowCount,
    warnings,
  };
}

/**
 * Simple CSV line parser for client-side validation.
 * Handles quoted values (via {@link stripQuotes}) and both `,` and `;` delimiters.
 *
 * Note: This is intentionally simplified for quick client-side checks.
 * It does not handle multi-line quoted values, encoding/BOM detection,
 * or leading whitespace trimming. The server uses `csv-parse` with full
 * encoding detection and edge-case handling as the source of truth.
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
