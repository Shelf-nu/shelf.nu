/**
 * Registry ↔ filter bar contract.
 *
 * A filter the registry declares must either have a control in the bar or be
 * explicitly listed as URL-only; otherwise a report claims a filter nobody
 * can set on screen.
 *
 * @see {@link file://./report-filter-bar.tsx}
 * @see {@link file://../../modules/reports/registry.ts}
 */

import { describe, expect, it } from "vitest";
import { REPORTS } from "~/modules/reports/registry";
import {
  RENDERED_FILTER_TYPES,
  URL_ONLY_FILTER_TYPES,
} from "./report-filter-bar";

describe("report filter bar ↔ registry", () => {
  it("renders or explicitly excludes every filter type a report declares", () => {
    const handled = new Set([
      ...RENDERED_FILTER_TYPES,
      ...URL_ONLY_FILTER_TYPES,
    ]);

    const unhandled = REPORTS.flatMap((report) =>
      report.filters
        .filter((f) => !handled.has(f.type))
        .map((f) => `${report.id}:${f.type}`)
    );

    expect(unhandled).toEqual([]);
  });

  it("offers the custom-field and asset-model filters on every asset-based report", () => {
    const assetBased = REPORTS.filter(
      (r) => r.id !== "top-booked-kits" && r.enabled
    );

    for (const report of assetBased) {
      const types = report.filters.map((f) => f.type);
      expect(types, report.id).toContain("custom_field");
      expect(types, report.id).toContain("asset_model");
    }
  });
});
