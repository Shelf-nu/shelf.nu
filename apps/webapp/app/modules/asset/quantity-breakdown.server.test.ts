import { describe, expect, it, vi } from "vitest";

// why: importing the module pulls in `~/database/db.server`, which opens a
// Prisma client at import time; the function under test is pure and never
// touches it.
vi.mock("~/database/db.server", () => ({ db: {} }));

const { toStillOutBookingRows } = await import("./quantity-breakdown.server");

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
});
