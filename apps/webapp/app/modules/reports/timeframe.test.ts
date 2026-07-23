import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveTimeframe } from "./timeframe";

/**
 * Guard: the custom-range label must render in the user's OWN date format —
 * numeric-vs-name, order, and separator all follow the pref (no hardcoded
 * shape options). Month-group headers stay English NAMES by design, but the
 * custom range is fully pref-driven.
 */
describe("resolveTimeframe labels", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a custom range in the user's numeric format for DD_MM_YYYY prefs", () => {
    const from = new Date(2026, 3, 3); // 3 Apr 2026
    const to = new Date(2026, 3, 10); // 10 Apr 2026
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
