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
import userEvent from "@testing-library/user-event";
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
    ).toBeInTheDocument();
    // Text that fits needs no button.
    expect(
      within(dataRow).queryByRole("button", { name: "Show more" })
    ).not.toBeInTheDocument();
  });

  it("lets keyboard and touch users open text cut off at three lines, without opening the row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    // why: happy-dom does no layout, so a clamped cell must report a taller
    // content box than its visible box itself.
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(120);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(60);
    const long = "Description changed: " + "Dry goods ".repeat(60);

    render(
      <AssetActivityContent
        rows={[{ ...row, description: long }]}
        kpis={[]}
        totalRows={1}
        onRowClick={onRowClick}
      />
    );

    const text = screen.getByText(long.trim());
    expect(text).toHaveClass("line-clamp-3");
    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    toggle.focus();
    await user.keyboard("{Enter}");

    expect(text).not.toHaveClass("line-clamp-3");
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(onRowClick).not.toHaveBeenCalled();

    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });
});
