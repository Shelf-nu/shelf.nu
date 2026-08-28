/**
 * Report timeframes: how a preset or a pair of custom boundaries becomes the
 * range a report is run over, and the label shown for it.
 *
 * Two things are pinned here. The label must render in the acting user's own
 * date format, so the assertions use fixed UTC instants with explicit prefs
 * and never read the machine clock. And a boundary that cannot be read must
 * not reach a formatter — the query string is user-supplied, and an
 * unparseable date is an object rather than a throw.
 *
 * @see {@link file://./timeframe.ts}
 */
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
 * are machine-timezone independent. The resolver does NOT anchor the custom
 * boundaries — it passes them through as given, and `toZonedBoundaryISO`
 * performs that conversion once, when the picker serializes them into the URL.
 * What follows the prefs here is the LABEL.
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

describe("resolveTimeframe — unreadable custom boundaries", () => {
  /**
   * `from` and `to` arrive from the query string, so anything can be in them.
   * `new Date("garbage")` answers with an Invalid Date rather than throwing,
   * and that value is an object — truthy, and indistinguishable from a real
   * boundary until something tries to format it.
   */
  it("falls back to the default range when a boundary cannot be read", () => {
    const result = resolveTimeframe(
      "custom",
      new Date("not-a-date"),
      new Date("2026-08-01")
    );

    expect(result.preset).toBe("last_30d");
    expect(Number.isNaN(result.from.getTime())).toBe(false);
    expect(Number.isNaN(result.to.getTime())).toBe(false);
  });

  it("falls back when the second boundary is the unreadable one", () => {
    const result = resolveTimeframe(
      "custom",
      new Date("2026-08-01"),
      new Date("also-not-a-date")
    );

    expect(result.preset).toBe("last_30d");
    expect(Number.isNaN(result.to.getTime())).toBe(false);
  });

  it("produces a label that can actually be rendered", () => {
    // The PDF route hands `from`/`to` to `Intl.DateTimeFormat.format`, which
    // throws a RangeError on an invalid date — so a bad query string became a
    // 500 rather than a report over the default range.
    const result = resolveTimeframe("custom", new Date("x"), new Date("y"));

    expect(() =>
      new Intl.DateTimeFormat("en").format(result.from)
    ).not.toThrow();
    expect(() => new Intl.DateTimeFormat("en").format(result.to)).not.toThrow();
  });

  it("still honours two readable boundaries", () => {
    const from = new Date("2026-08-01T00:00:00.000Z");
    const to = new Date("2026-08-10T00:00:00.000Z");

    const result = resolveTimeframe("custom", from, to);

    expect(result.preset).toBe("custom");
    expect(result.from).toEqual(from);
    expect(result.to).toEqual(to);
  });
});
