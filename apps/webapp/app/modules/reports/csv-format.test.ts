/**
 * Regression tests for `formatDateForCsv` — the reports CSV export date cell.
 *
 * Guards the Area 2 fix that moved CSV dates from hardcoded ISO/UTC
 * (`date.toISOString()`) to the acting user's display prefs, and the CSV-safety
 * quoting for month-name formats whose output contains a comma.
 *
 * @see {@link file://./csv-format.ts}
 */
import { describe, expect, it } from "vitest";

import type { ResolvedFormatPrefs } from "~/utils/date-format";

import { formatDateForCsv } from "./csv-format";

/** DD/MM/YYYY, 12h, UTC — a numeric-format user. */
const ddmm: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H12",
  weekStartsOn: 1,
  timeZone: "UTC",
};

/** Month-name format whose output contains a comma ("Jul 6, 2026"). */
const monthName: ResolvedFormatPrefs = { ...ddmm, dateFormat: "MMM_DD_YYYY" };

describe("formatDateForCsv", () => {
  it("renders the date in the user's numeric display format", () => {
    // why: noon-UTC instant + UTC prefs keeps the assertion machine-tz independent.
    expect(formatDateForCsv(new Date(Date.UTC(2026, 6, 6, 12)), ddmm)).toBe(
      "06/07/2026"
    );
  });

  it("appends the time part for datetime columns, quoted (date/time comma)", () => {
    // A datetime renders "06/07/2026, 3:30 PM" — the date/time separator is a
    // comma, so the whole field is quoted to stay one CSV column.
    expect(
      formatDateForCsv(new Date(Date.UTC(2026, 6, 6, 15, 30)), ddmm, {
        includeTime: true,
      })
    ).toBe('"06/07/2026, 3:30 PM"');
  });

  it("quotes a month-name value so its comma doesn't split the CSV column", () => {
    expect(
      formatDateForCsv(new Date(Date.UTC(2026, 6, 6, 12)), monthName)
    ).toBe('"Jul 6, 2026"');
  });

  it("returns an empty string for a null date", () => {
    expect(formatDateForCsv(null, ddmm)).toBe("");
  });
});
