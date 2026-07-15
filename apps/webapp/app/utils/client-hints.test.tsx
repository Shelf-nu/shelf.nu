import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDateBasedOnLocaleOnly } from "./client-hints";

/**
 * Regression guard: the custom-field date spine must render date-only values
 * using the caller's resolved prefs (absolute, no timezone conversion), NOT
 * the browser default locale it used before the configurable-format work.
 */
describe("formatDateBasedOnLocaleOnly", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  const mmddyyyy: ResolvedFormatPrefs = {
    ...ddmmyyyy,
    dateFormat: "MM_DD_YYYY",
  };

  it("renders day-month-year order for DD_MM_YYYY prefs", () => {
    // components appear in order regardless of the separator the formatter uses
    expect(formatDateBasedOnLocaleOnly("2026-04-03", ddmmyyyy)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("renders month-day-year order for MM_DD_YYYY prefs", () => {
    expect(formatDateBasedOnLocaleOnly("2026-04-03", mmddyyyy)).toMatch(
      /^0?4\D+0?3\D+2026$/
    );
  });
});
