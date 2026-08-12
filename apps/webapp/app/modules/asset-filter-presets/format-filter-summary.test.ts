import { describe, expect, it } from "vitest";

import type { ResolvedFormatPrefs } from "~/utils/date-format";

import { formatFilterSummary } from "./format-filter-summary";

/**
 * Guard: a date filter chip must render the value in the user's configured
 * order (no hardcoded "en-US"). Uses a minimal date column definition.
 */
describe("formatFilterSummary — date values", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  // Minimal date column; adjust the shape to the real Column type when wiring.
  const columns = [{ name: "createdAt", queryKey: "createdAt", type: "date" }];

  it("renders a date filter value day-first for DD_MM_YYYY prefs", () => {
    const summary = formatFilterSummary(
      "createdAt=is:2026-04-03",
      columns as never,
      undefined,
      prefs
    );
    expect(summary).toMatch(/0?3\D+Apr\D+2026/);
  });
});
