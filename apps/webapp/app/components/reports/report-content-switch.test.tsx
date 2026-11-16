/**
 * Empty states of {@link ReportContentSwitch}.
 *
 * An empty table has three different causes, and each gets its own message:
 * the filters match nothing, the URL's page is past the last page, or the
 * report has no data at all.
 *
 * @see {@link file://./report-content-switch.tsx}
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

/** Renders an empty page of the kits report at `url`. */
function renderEmpty({
  url,
  totalRows,
  hasActiveFilters,
}: {
  url: string;
  totalRows: number;
  hasActiveFilters: boolean;
}) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReportContentSwitch
        reportId="top-booked-kits"
        rows={[]}
        kpis={[]}
        totalRows={totalRows}
        timeframe={TIMEFRAME}
        handlers={HANDLERS}
        hasActiveFilters={hasActiveFilters}
      />
    </MemoryRouter>
  );
}

describe("ReportContentSwitch empty state", () => {
  it("says nothing matches the filters when filters are active", () => {
    renderEmpty({
      url: "/reports/top-booked-kits?location=loc-1",
      totalRows: 0,
      hasActiveFilters: true,
    });

    expect(screen.getByText("No matching results")).toBeInTheDocument();
  });

  it("links back to page 1 when the page is past the last one", () => {
    renderEmpty({
      url: "/reports/top-booked-kits?location=loc-1&page=2",
      totalRows: 3,
      hasActiveFilters: true,
    });

    expect(screen.queryByText("No matching results")).not.toBeInTheDocument();
    expect(screen.getByText("No results on this page")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to page 1" }).getAttribute("href")
    ).toBe("/reports/top-booked-kits?location=loc-1");
  });
});
