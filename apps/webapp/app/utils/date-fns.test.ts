import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { getWeekStartingAndEndingDates } from "./date-fns";

/**
 * Guard: the calendar week-range subtitle must render its endpoints through
 * the user's resolved prefs (absolute day/month), not the browser default.
 */
describe("getWeekStartingAndEndingDates", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("returns Monday-based start/end labels with day + long month", () => {
    // 2026-04-15 is a Wednesday → week is Mon 13th … Sun 19th April
    const [start, end] = getWeekStartingAndEndingDates(
      new Date(2026, 3, 15),
      prefs
    );
    expect(start).toMatch(/13/);
    expect(start).toMatch(/April/);
    expect(end).toMatch(/19/);
    expect(end).toMatch(/April/);
  });
});
