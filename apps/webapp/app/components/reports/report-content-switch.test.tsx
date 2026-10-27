/**
 * Empty state of {@link ReportContentSwitch}.
 *
 * When the filter bar narrows a report to nothing, the page must say that
 * nothing matches the filters, not that nothing happened in the timeframe.
 *
 * @see {@link file://./report-content-switch.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ResolvedTimeframe } from "~/modules/reports/types";

import { ReportContentSwitch } from "./report-content-switch";
import type { ReportRowHandlers } from "./use-report-row-handlers";

const TIMEFRAME = {
  preset: "last_30d",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
  label: "Last 30 days",
} as ResolvedTimeframe;

const HANDLERS = {} as ReportRowHandlers;

describe("ReportContentSwitch empty state", () => {
  it("says nothing matches the filters when filters are active", () => {
    render(
      <ReportContentSwitch
        reportId="top-booked-kits"
        rows={[]}
        kpis={[]}
        totalRows={0}
        timeframe={TIMEFRAME}
        handlers={HANDLERS}
        hasActiveFilters
      />
    );

    expect(screen.getByText("No matching results")).toBeInTheDocument();
  });
});
