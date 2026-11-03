/**
 * Asset Activity report body: the Details column.
 *
 * The report row's description is the one place a reader sees what changed
 * ("Location set to Leeds unit") without downloading the CSV, so the table
 * must show it under its own header.
 *
 * @see {@link file://./asset-activity-content.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssetActivityRow } from "~/modules/reports/types";

import { AssetActivityContent } from "./asset-activity-content";

// why: the Date & Time cell formats through this hook, which reads the root
// route loader; there is no router in a unit test, and dates are not what
// this case is about.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    formatDate: () => "15/10/2026",
    formatTime: () => "10:00",
    formatDateTime: () => "15/10/2026, 10:00",
  }),
}));

const row: AssetActivityRow = {
  id: "evt-1",
  assetId: "asset-1",
  samId: "SAM-0017",
  qrId: "qr-17",
  assetName: "Pallet 17",
  thumbnailImage: null,
  mainImage: null,
  assetModel: null,
  activityType: "LOCATION_CHANGED",
  description: "Location set to Leeds unit",
  changedFrom: null,
  changedTo: "Leeds unit",
  occurredAt: new Date("2026-10-15T10:00:00Z"),
  performedBy: "Sam Mover",
  context: null,
};

describe("AssetActivityContent", () => {
  it("shows each change's description under a Details header", () => {
    render(<AssetActivityContent rows={[row]} kpis={[]} totalRows={1} />);

    expect(
      screen.getByRole("columnheader", { name: /Details/ })
    ).toBeInTheDocument();
    const [, dataRow] = screen.getAllByRole("row");
    expect(
      within(dataRow).getByText("Location set to Leeds unit")
    ).toHaveAttribute("title", "Location set to Leeds unit");
  });
});
