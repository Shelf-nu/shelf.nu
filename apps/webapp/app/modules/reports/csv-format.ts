/**
 * CSV date formatting for report exports.
 *
 * Extracted from the CSV export route so it can be unit-tested without importing
 * the route's server graph (`helpers.server` → Prisma). Depends only on the pure
 * {@link formatDate}, so the export cells render in exactly the same format the
 * user sees in the UI.
 *
 * @see {@link file://../../routes/_layout+/reports.export.$fileName[.csv].tsx}
 * @see {@link file://../../utils/date-format.ts} formatDate — the pure formatter
 */
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";

/**
 * Format a date for CSV export in the acting user's display format.
 *
 * Renders the value through {@link formatDate} with the resolved prefs so the
 * exported cell matches what the user sees in the UI (numeric-vs-name order,
 * separator, timezone). No shape options are passed, so the user's preference —
 * not a hardcoded style — decides the output.
 *
 * @param date - the date to format, or `null` (renders an empty cell)
 * @param prefs - the acting user's resolved date/time format preferences
 * @param opts - optional flags; `includeTime` appends the time part for datetime
 *   columns (leave unset for date-only columns)
 * @returns the CSV-safe formatted string; empty string for `null`. Month-name
 *   prefs produce a comma (e.g. "Jul 6, 2026"), which would break CSV columns,
 *   so any value containing a comma is wrapped in double quotes.
 */
export function formatDateForCsv(
  date: Date | null,
  prefs: ResolvedFormatPrefs,
  opts?: { includeTime?: boolean }
): string {
  if (!date) return "";
  const formatted = formatDate(date, prefs, { includeTime: opts?.includeTime });
  // Month-name prefs emit a comma ("Jul 6, 2026"); quote so it stays one field.
  return formatted.includes(",") ? `"${formatted}"` : formatted;
}
