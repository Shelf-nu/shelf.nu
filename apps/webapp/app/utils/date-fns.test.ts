import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  dateForDateTimeInputValue,
  getWeekStartingAndEndingDates,
} from "./date-fns";

/**
 * Guard: a datetime-local seed must be rendered in the zone the field is
 * displayed and submitted in — the user's resolved preference zone.
 *
 * This used to convert with `getTimezoneOffset()`, i.e. the DEVICE zone, so a
 * user whose preference differed from their device was seeded a wall-clock off
 * by the difference between the two. These cases pass one fixed instant through
 * several zones, so they assert the parameter actually drives the output and
 * cannot pass by accident on a particular machine.
 */
describe("dateForDateTimeInputValue", () => {
  // 2026-08-19T12:49:00Z — a single unambiguous instant.
  const instant = new Date("2026-08-19T12:49:00.000Z");

  it("renders the wall-clock of the given zone", () => {
    expect(dateForDateTimeInputValue(instant, "UTC")).toBe(
      "2026-08-19T12:49:00"
    );
    // PDT is UTC-7 in August.
    expect(dateForDateTimeInputValue(instant, "America/Los_Angeles")).toBe(
      "2026-08-19T05:49:00"
    );
    // JST is UTC+9, no DST.
    expect(dateForDateTimeInputValue(instant, "Asia/Tokyo")).toBe(
      "2026-08-19T21:49:00"
    );
  });

  it("rolls the calendar date when the zone crosses midnight", () => {
    // 23:30Z is still the 19th in UTC but already the 20th in Tokyo.
    const lateEvening = new Date("2026-08-19T23:30:00.000Z");

    expect(dateForDateTimeInputValue(lateEvening, "UTC")).toBe(
      "2026-08-19T23:30:00"
    );
    expect(dateForDateTimeInputValue(lateEvening, "Asia/Tokyo")).toBe(
      "2026-08-20T08:30:00"
    );
  });

  it("emits the padded shape the DateTimePicker expects", () => {
    // Single-digit month/day/hour must be zero-padded, or the picker's
    // normalisation and the server's DATE_TIME_FORMAT parse both reject it.
    const earlyJanuary = new Date("2026-01-05T09:07:00.000Z");

    expect(dateForDateTimeInputValue(earlyJanuary, "UTC")).toBe(
      "2026-01-05T09:07:00"
    );
  });
});

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
