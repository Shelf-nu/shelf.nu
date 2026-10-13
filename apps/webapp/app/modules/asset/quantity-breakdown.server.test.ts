import { describe, expect, it } from "vitest";

import { toStillOutBookingRows } from "./quantity-breakdown.server";

/** One booking slice as the loaders select it. */
function slice(
  bookingId: string,
  status: string,
  quantity: number,
  assetKitId: string | null = null
) {
  return {
    quantity,
    assetKitId,
    booking: { id: bookingId, status, name: `Booking ${bookingId}` },
  };
}

describe("toStillOutBookingRows", () => {
  it("passes RESERVED rows through as booked", () => {
    const rows = toStillOutBookingRows(
      [slice("r1", "RESERVED", 12)],
      new Map()
    );

    expect(rows).toEqual([slice("r1", "RESERVED", 12)]);
  });

  it("gives an active booking the units still out, not the units booked", () => {
    // 10 booked and sent out, 4 checked back in: 6 are still out.
    const rows = toStillOutBookingRows(
      [slice("b1", "ONGOING", 10)],
      new Map([["b1", { total: 6 }]])
    );

    expect(rows).toEqual([{ ...slice("b1", "ONGOING", 6), assetKitId: null }]);
  });

  it("collapses a booking's loose and kit slices into one line", () => {
    const rows = toStillOutBookingRows(
      [slice("b1", "OVERDUE", 5), slice("b1", "OVERDUE", 5, "ak1")],
      new Map([["b1", { total: 3 }]])
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 3, assetKitId: null });
  });

  it("drops an active booking whose units have all come back", () => {
    const rows = toStillOutBookingRows(
      [slice("r1", "RESERVED", 2), slice("b1", "ONGOING", 10)],
      new Map([["b1", { total: 0 }]])
    );

    expect(rows.map((row) => row.booking.id)).toEqual(["r1"]);
  });

  it("builds an active booking's line from the booking alone, not from one of its slices", () => {
    // The kit slice is listed first, so a row copied from it would carry that
    // slice's id and departure stamp onto a line that stands for the booking.
    const kitSlice = {
      ...slice("b1", "ONGOING", 5, "ak1"),
      id: "slice-kit",
      checkedOutAt: new Date("2026-10-01T09:00:00Z"),
    };
    const looseSlice = { ...slice("b1", "ONGOING", 5), id: "slice-loose" };

    const rows = toStillOutBookingRows(
      [kitSlice, looseSlice],
      new Map([["b1", { total: 7 }]])
    );

    expect(rows).toEqual([
      { quantity: 7, assetKitId: null, booking: kitSlice.booking },
    ]);
  });
});
