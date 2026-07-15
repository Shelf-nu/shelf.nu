import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveTimeframe } from "./timeframe";

/**
 * Guard: custom-range and month timeframe labels must render in the caller's
 * configured order (no hardcoded "en-US"). Month/day names stay English by
 * design (the formatter reassembles en-US parts), only ORDER is prefs-driven.
 */
describe("resolveTimeframe labels", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a custom range with day-first order for DD_MM_YYYY prefs", () => {
    const from = new Date(2026, 3, 3); // 3 Apr 2026
    const to = new Date(2026, 3, 10); // 10 Apr 2026
    const resolved = resolveTimeframe("custom", from, to, ddmmyyyy);
    // "3 Apr 2026 – 10 Apr 2026" — day appears before the month token
    expect(resolved.label).toMatch(/^0?3\D+Apr\D+2026\s*–\s*10\D+Apr\D+2026$/);
  });

  it("still resolves preset labels without prefs (server fallback)", () => {
    expect(resolveTimeframe("last_7d").label).toBe("Last 7 days");
  });
});
