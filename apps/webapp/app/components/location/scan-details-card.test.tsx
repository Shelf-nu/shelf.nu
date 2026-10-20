/**
 * The Last scan card offers the scan history of the item it is on.
 *
 * @see {@link file://./scan-details.tsx}
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { parseScanData } from "~/modules/scan/utils.server";
import { parseScanUserAgent } from "~/modules/scan/utils.server";

import { ScanDetails } from "./scan-details";

// why: the map loads a tile library that needs a real browser canvas.
vi.mock("./map", () => ({ ShelfMap: () => <div>map</div> }));

// why: DateS reads client hints from route context unavailable here.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => <span>{String(date)}</span>,
}));

// why: the sheet has its own tests; here only its placement matters.
vi.mock("~/components/scan/scan-history-sheet", () => ({
  ScanHistoryButton: ({ itemName }: { itemName: string }) => (
    <button type="button">View all scans of {itemName}</button>
  ),
}));

/** A real card payload, typed against the prop so drift fails typecheck. */
const lastScan: NonNullable<ReturnType<typeof parseScanData>> = {
  scannedBy: "Unknown",
  coordinates: "Unknown location",
  locatedAt: null,
  dateTime: new Date("2026-10-16T10:00:00.000Z"),
  // The real parser on an empty user agent, so `ua` matches IResult exactly.
  ua: parseScanUserAgent(null),
  manuallyGenerated: false,
  codeType: "QR",
  code: null,
};

describe("ScanDetails", () => {
  it("offers the scan history of the item the card is on", () => {
    render(
      <ScanDetails
        lastScan={lastScan}
        target={{ assetId: "asset-1" }}
        itemName="Laptop"
      />,
      { wrapper: MemoryRouter }
    );

    expect(
      screen.getByRole("button", { name: "View all scans of Laptop" })
    ).toBeInTheDocument();
  });

  it("starts the history afresh when the card moves to another item", () => {
    // Moving between two assets only changes the route param, so the page
    // keeps this card mounted. The history must not: a new element means its
    // open state and loaded rows started over for the new item.
    const view = render(
      <ScanDetails
        lastScan={lastScan}
        target={{ assetId: "asset-1" }}
        itemName="Laptop"
      />,
      { wrapper: MemoryRouter }
    );
    const first = screen.getByRole("button", { name: /View all scans/ });

    view.rerender(
      <ScanDetails
        lastScan={lastScan}
        target={{ assetId: "asset-2" }}
        itemName="Camera"
      />
    );

    expect(screen.getByRole("button", { name: /View all scans/ })).not.toBe(
      first
    );
  });

  it("offers no history before the first scan", () => {
    render(
      <ScanDetails
        lastScan={null}
        target={{ assetId: "asset-1" }}
        itemName="Laptop"
      />,
      { wrapper: MemoryRouter }
    );

    expect(screen.queryByRole("button", { name: /View all scans/ })).toBeNull();
  });
});
