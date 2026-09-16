/**
 * CSV formatting shared by the report exports.
 *
 * Cells are formatted RAW by the value helpers and escaped exactly once, in
 * {@link buildCsv}, so a value is never quoted twice. Every report export
 * route builds its document through this module.
 *
 * @see {@link file://../../routes/_layout+/reports.export.$fileName[.csv].tsx}
 * @see {@link file://../../routes/_layout+/reports.builder.export.$fileName[.csv].tsx}
 */

import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";

/**
 * Formats a date for a CSV cell in the acting user's preferences.
 *
 * Returned raw: quoting is {@link buildCsv}'s job, and a pre-quoted value
 * would be quoted a second time there.
 *
 * @param date - The value, or `null` for an empty cell
 * @param prefs - The user's resolved date/time preferences
 * @param opts.includeTime - Append the time of day
 */
export function formatDateForCsv(
  date: Date | null,
  prefs: ResolvedFormatPrefs,
  opts?: { includeTime?: boolean }
): string {
  if (!date) return "";
  return formatDate(date, prefs, { includeTime: opts?.includeTime });
}

/**
 * Builds a CSV document from a header row and data rows.
 *
 * @param headers - Column headers, escaped like any other cell
 * @param rows - Row cells, already stringified and formatted, NOT escaped
 * @returns The complete CSV document
 */
export function buildCsv(headers: string[], rows: string[][]): string {
  return [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ].join("\n");
}

/**
 * Escapes one field for CSV.
 *
 * Neutralizes spreadsheet formula injection (CWE-1236): a value starting with
 * `=`, `+`, `-` or `@` can execute as a formula in Excel or Google Sheets, so
 * such values get a leading single quote and read as literal text. Quotes a
 * field holding a comma, a quote, a newline or a carriage return; a bare
 * carriage return would end the record in consumers that accept CR as a line
 * ending and let a user-controlled value forge a row.
 */
export function escapeCsvField(field: string): string {
  // Excel also treats a formula marker after a leading tab, CR or LF as a
  // formula once the cell is imported, so those prefixes count too.
  const safeField = /^[=+\-@\t\r\n]/.test(field) ? `'${field}` : field;
  if (
    safeField.includes(",") ||
    safeField.includes('"') ||
    safeField.includes("\n") ||
    safeField.includes("\r")
  ) {
    return `"${safeField.replace(/"/g, '""')}"`;
  }
  return safeField;
}
