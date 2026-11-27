/**
 * Quantity tooltip: a reserved booking with planned sources lists them under
 * its bullet; one without sources, and checked-out bookings, show none.
 *
 * @see {@link file://./quantity-tooltip-content.tsx}
 */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getQuantityData } from "./quantity-data";
import { QuantityTooltipContent } from "./quantity-tooltip-content";

// why: DateS reads the user's date preferences from route data that is not
// mounted here; the booking start is not under test.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}));

afterEach(() => {
  cleanup();
});

/** Ends far ahead, so no reservation reads as expired. */
const FUTURE_FROM = "2099-01-01T09:00:00.000Z";
const FUTURE_TO = "2099-01-05T09:00:00.000Z";

/** Renders the tooltip for a pool of 40 with the given booking rows. */
function renderTooltip(
  bookingAssets: NonNullable<
    Parameters<typeof getQuantityData>[0]
  >["bookingAssets"]
) {
  const data = getQuantityData({
    type: "QUANTITY_TRACKED",
    quantity: 40,
    custody: [],
    assetKits: [],
    bookingAssets,
  });
  if (!data) throw new Error("expected a breakdown");
  render(
    <MemoryRouter>
      <QuantityTooltipContent data={data} />
    </MemoryRouter>
  );
}

describe("QuantityTooltipContent sources", () => {
  it("lists the planned sources of a reserved booking", () => {
    renderTooltip([
      {
        quantity: 15,
        assetKitId: null,
        sourceSummary: "Demo Warehouse 8 · Unplaced 7",
        booking: {
          id: "b-1",
          name: "Shoot",
          status: "RESERVED",
          from: FUTURE_FROM,
          to: FUTURE_TO,
        },
      },
    ]);

    expect(
      screen.getByText("Sources: Demo Warehouse 8 · Unplaced 7")
    ).toBeInTheDocument();
  });

  it("shows no sources line for a reserved booking without planned sources", () => {
    renderTooltip([
      {
        quantity: 5,
        assetKitId: null,
        booking: {
          id: "b-1",
          name: "Shoot",
          status: "RESERVED",
          from: FUTURE_FROM,
          to: FUTURE_TO,
        },
      },
    ]);

    expect(screen.queryByText(/^Sources:/)).not.toBeInTheDocument();
  });
});
