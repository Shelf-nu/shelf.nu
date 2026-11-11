/**
 * Tests for {@link REPORT_ICONS}: every icon a report names in the registry
 * has an entry, so no report silently falls back to the document icon.
 *
 * @see {@link file://./report-icon.tsx}
 */
import { describe, expect, it } from "vitest";
import { REPORTS } from "~/modules/reports/registry";
import { REPORT_ICONS } from "./report-icon";

describe("REPORT_ICONS", () => {
  it("holds every icon the report registry names", () => {
    const missing = REPORTS.map((report) => report.icon).filter(
      (name) => !(name in REPORT_ICONS)
    );

    expect(missing).toEqual([]);
  });
});
