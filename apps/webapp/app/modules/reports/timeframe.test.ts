import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveTimeframe, toZonedBoundaryISO } from "./timeframe";

/**
 * Guard: the custom-range label must render in the user's OWN date format —
 * numeric-vs-name, order, and separator all follow the pref (no hardcoded
 * shape options). Month-group headers stay English NAMES by design, but the
 * custom range is fully pref-driven.
 *
 * All custom-range assertions use FIXED UTC instants + explicit prefs so they
 * are machine-timezone independent (the resolver anchors boundaries in
 * `prefs.timeZone`, not the machine tz).
 */
describe("resolveTimeframe labels", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a custom range in the user's numeric format for DD_MM_YYYY prefs", () => {
    const from = new Date("2026-04-03T00:00:00.000Z"); // 3 Apr 2026 (UTC)
    const to = new Date("2026-04-10T00:00:00.000Z"); // 10 Apr 2026 (UTC)
    const resolved = resolveTimeframe("custom", from, to, ddmmyyyy);
    // DD_MM_YYYY is a numeric pref → "03/04/2026 – 10/04/2026" (no month name).
    expect(resolved.label).toBe("03/04/2026 – 10/04/2026");
  });

  it("still resolves preset labels without prefs (server fallback)", () => {
    expect(resolveTimeframe("last_7d").label).toBe("Last 7 days");
  });

  // why: preset windows must be wall-clock in the user's pref tz, not machine tz.
  it("anchors 'this_month' start at midnight in the user's pref timezone", () => {
    const tokyo = {
      ...ddmmyyyy,
      timeZone: "Asia/Tokyo",
    } as ResolvedFormatPrefs;
    const { from } = resolveTimeframe(
      "this_month",
      undefined,
      undefined,
      tokyo
    );
    const startInTokyo = DateTime.fromJSDate(from).setZone("Asia/Tokyo");
    expect(startInTokyo.day).toBe(1);
    expect(startInTokyo.hour).toBe(0);
    expect(startInTokyo.minute).toBe(0);
  });
});

/**
 * Guard for E1: the range picker's date-only selection must become a pref-tz
 * boundary instant at URL-serialization time — `from` → start-of-day, `to` →
 * end-of-day IN the pref timezone — so the loader's inclusive `lte` covers the
 * whole last day and the window never shifts with the browser timezone. This
 * conversion lives in `toZonedBoundaryISO`; `resolveTimeframe`'s custom case is
 * a pass-through (it receives these already-anchored instants from the loader
 * AND the picker's raw calendar dates on the client, so it must not transform).
 * `toZonedBoundaryISO` reads the calendar Y/M/D via LOCAL getters, so passing a
 * `new Date(y, m, d)` is machine-timezone independent.
 */
describe("toZonedBoundaryISO", () => {
  it("anchors a calendar day at start/end-of-day in the given timezone (UTC)", () => {
    const day = new Date(2026, 3, 3); // Apr 3 2026, calendar day
    expect(toZonedBoundaryISO(day, "UTC", "start")).toBe(
      "2026-04-03T00:00:00.000Z"
    );
    expect(toZonedBoundaryISO(day, "UTC", "end")).toBe(
      "2026-04-03T23:59:59.999Z"
    );
  });

  it("anchors the whole day in the PREF timezone, not the browser (Tokyo)", () => {
    const day = new Date(2026, 3, 3); // Apr 3 calendar day
    // Apr 3 00:00 Tokyo (UTC+9) = 2026-04-02T15:00Z; end = Apr 3 23:59:59.999 Tokyo.
    expect(toZonedBoundaryISO(day, "Asia/Tokyo", "start")).toBe(
      "2026-04-02T15:00:00.000Z"
    );
    expect(toZonedBoundaryISO(day, "Asia/Tokyo", "end")).toBe(
      "2026-04-03T14:59:59.999Z"
    );
  });

  it("uses the calendar Y/M/D, so the time-of-day of the Date is irrelevant", () => {
    // Two Dates on the same calendar day (different clock times) map identically.
    const morning = new Date(2026, 3, 3, 8, 30);
    const evening = new Date(2026, 3, 3, 20, 15);
    expect(toZonedBoundaryISO(morning, "Asia/Tokyo", "start")).toBe(
      toZonedBoundaryISO(evening, "Asia/Tokyo", "start")
    );
  });
});
