/**
 * Render tests for the reports index page.
 *
 * The loader answers with one of two shapes on `canUseReports`. The locked
 * shape carries no `reportsByCategory` and no `categories`, so the page has to
 * choose the unlock page before it reads either: reading them first would
 * crash every Free workspace's Reports page into the error boundary.
 *
 * @see {@link file://../../../app/routes/_layout+/reports._index.tsx}
 * @see {@link file://../../../app/components/reports/unlock-reports-page.tsx}
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import {
  REPORTS,
  REPORT_CATEGORIES,
  getEnabledReports,
  getReportsByCategory,
} from "~/modules/reports/registry";
import ReportsIndex from "~/routes/_layout+/reports._index";

const header = {
  title: "Reports",
  subHeading: "Track and analyze your asset management operations",
};

/** Renders the index page with `loaderData` as its loader's answer. */
async function renderIndex(loaderData: Record<string, unknown>) {
  const Stub = createRoutesStub([
    {
      path: "/reports",
      Component: ReportsIndex,
      loader: () => loaderData,
    },
  ]);
  render(<Stub initialEntries={["/reports"]} />);
  await screen.findByRole("heading", { name: "Reports" });
}

describe("reports index page", () => {
  it("shows the unlock page for a workspace without reports", async () => {
    await renderIndex({
      canUseReports: false,
      header,
      isOwner: true,
      reports: getEnabledReports(),
    });

    expect(
      screen.getByRole("heading", { name: "Reports are part of Plus and Team" })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeInTheDocument();
    // No report card links: the unlock page lists reports as plain text.
    expect(
      screen.queryByRole("link", { name: /Booking Compliance/ })
    ).toBeNull();
  });

  it("shows the report cards for a workspace with reports", async () => {
    await renderIndex({
      canUseReports: true,
      header,
      reports: REPORTS,
      reportsByCategory: getReportsByCategory(),
      categories: REPORT_CATEGORIES,
    });

    expect(
      screen.getByRole("link", { name: /Booking Compliance/ })
    ).toHaveAttribute("href", "/reports/booking-compliance");
    expect(
      screen.queryByRole("heading", {
        name: "Reports are part of Plus and Team",
      })
    ).toBeNull();
  });
});
