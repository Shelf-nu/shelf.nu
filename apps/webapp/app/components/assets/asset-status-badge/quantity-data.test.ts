/**
 * Tests for the quantity-pool status badge derivation.
 *
 * The cases below are all arithmetic, not opinion: a pool with units sitting on
 * the shelf must never be described as fully gone. That was reachable with one
 * checkout plus one future booking, because the "Partially" test used a number
 * that subtracts reservations, and a reserved unit has not moved.
 *
 * @see {@link file://./quantity-data.ts}
 */

import { describe, expect, it } from "vitest";
import {
  getQuantityBadgeLabelAndColor,
  getQuantityData,
  type QuantityAwareAsset,
} from "./quantity-data";

/** A quantity pool with nothing claimed. Override only what a case is about. */
function asset(
  overrides: Partial<QuantityAwareAsset> = {}
): QuantityAwareAsset {
  return {
    type: "QUANTITY_TRACKED",
    quantity: 10,
    custody: [],
    bookingAssets: [],
    assetKits: [],
    ...overrides,
  };
}

/** One booking slice. */
function slice(
  quantity: number,
  status: string,
  id = `b-${status}-${quantity}`
) {
  return { quantity, assetKitId: null, booking: { id, name: id, status } };
}

/** Resolves the label the badge would render, or null for a non-pool. */
function labelFor(input: QuantityAwareAsset): string | null {
  const data = getQuantityData(input);
  return data ? getQuantityBadgeLabelAndColor(data).label : null;
}

describe("quantity pool status label", () => {
  it("says Partially checked out while units remain on the shelf", () => {
    // why: 5 out on a booking, 5 reserved for next month, 10 owned. The
    // reservation-aware number hits zero, but five units are physically
    // present, so the badge must not read "Checked out" while the Free now
    // column on the same row says 5.
    const label = labelFor(
      asset({
        quantity: 10,
        bookingAssets: [slice(5, "ONGOING"), slice(5, "RESERVED")],
      })
    );

    expect(label).toBe("Partially checked out");
  });

  it("says Checked out only when nothing is left on the shelf", () => {
    const label = labelFor(
      asset({ quantity: 10, bookingAssets: [slice(10, "ONGOING")] })
    );

    expect(label).toBe("Checked out");
  });

  it("counts custody toward the shelf being empty", () => {
    // why: 4 out + 6 in custody = nothing free, even though neither claim
    // alone empties the pool.
    const label = labelFor(
      asset({
        quantity: 10,
        custody: [{ quantity: 6 }],
        bookingAssets: [slice(4, "ONGOING")],
      })
    );

    expect(label).toBe("Checked out");
  });

  it("counts kit-allocated units toward the shelf being empty", () => {
    // why: `freeNow` must match the server's Free now figure, which excludes
    // kit units. If it did not, the index and the asset page would disagree
    // for any asset that belongs to a kit.
    const label = labelFor(
      asset({
        quantity: 10,
        assetKits: [
          { id: "ak1", quantity: 6, kit: { id: "k1", name: "Kit A" } },
        ],
        bookingAssets: [slice(4, "ONGOING")],
      })
    );

    expect(label).toBe("Checked out");
  });

  it("says Partial custody while units remain on the shelf", () => {
    const label = labelFor(
      asset({
        quantity: 10,
        custody: [{ quantity: 4 }],
        bookingAssets: [slice(6, "RESERVED")],
      })
    );

    expect(label).toBe("Partial custody");
  });

  it("keeps the reservation-aware test on the reserved branch", () => {
    // why: deliberately NOT switched to the physical number. This branch asks
    // whether every unit is spoken for at some point, so commitments belong in
    // it. 12 promised against 10 owned reads as fully reserved even though all
    // ten are on the shelf.
    const label = labelFor(
      asset({ quantity: 10, bookingAssets: [slice(12, "RESERVED")] })
    );

    expect(label).toBe("Reserved");
  });

  it("says Partially reserved when some units are still uncommitted", () => {
    const label = labelFor(
      asset({ quantity: 200, bookingAssets: [slice(6, "RESERVED")] })
    );

    expect(label).toBe("Partially reserved");
  });

  it("never reports a negative free-now figure", () => {
    // why: the tooltip footer renders this number. `available` goes negative
    // once commitments exceed the pool, and "-2 free right now" is never true.
    const data = getQuantityData(
      asset({ quantity: 10, bookingAssets: [slice(12, "RESERVED")] })
    );

    expect(data?.freeNow).toBe(10);
    expect(data?.available).toBeLessThan(0);
  });

  it("quotes the engine's free-now figure when the loader passes it", () => {
    // A kit of 10 in custody: the rows carry the kit's custody AND the kit's
    // units, so a recount from rows subtracts the same 10 units twice. The
    // loader passes the engine's figure, 20, and the tooltip must use it.
    const kitInCustody = asset({
      quantity: 30,
      custody: [{ quantity: 10 }],
      assetKits: [{ id: "ak1", quantity: 10 }],
    });

    expect(getQuantityData({ ...kitInCustody, freeNow: 20 })?.freeNow).toBe(20);
    expect(getQuantityData(kitInCustody)?.freeNow).toBe(10);
  });

  describe("expired reservations", () => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const inADay = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const inTwoDays = new Date(Date.now() + 48 * 60 * 60 * 1000);

    /** A RESERVED slice with an explicit window. */
    function reservedSlice(
      quantity: number,
      id: string,
      window: { from: Date; to: Date }
    ) {
      return {
        quantity,
        assetKitId: null,
        booking: { id, name: id, status: "RESERVED", ...window },
      };
    }

    it("leaves a reservation whose end date has passed out of the reserved count", () => {
      // why: nothing in the lifecycle moves a RESERVED booking nobody checked
      // out, so it stayed RESERVED forever and kept colouring the asset. It
      // claims no units (conflicts are judged by window), so it must not
      // count. It is still named, so the card agrees with the bookings list.
      const data = getQuantityData(
        asset({
          quantity: 10,
          bookingAssets: [
            reservedSlice(3, "dead", { from: twoDaysAgo, to: dayAgo }),
            reservedSlice(2, "live", { from: inADay, to: inTwoDays }),
          ],
        })
      );

      expect(data?.reserved).toBe(2);
      expect(data?.expiredReserved).toBe(3);
      expect(data?.expiredReservedBookings).toBe(1);
      expect(data?.available).toBe(8);
    });

    it("counts one expired reservation once across its slices", () => {
      const data = getQuantityData(
        asset({
          quantity: 10,
          bookingAssets: [
            reservedSlice(3, "dead", { from: twoDaysAgo, to: dayAgo }),
            {
              ...reservedSlice(1, "dead", { from: twoDaysAgo, to: dayAgo }),
              assetKitId: "ak1",
            },
            reservedSlice(2, "live", { from: inADay, to: inTwoDays }),
          ],
        })
      );

      expect(data?.expiredReserved).toBe(4);
      expect(data?.expiredReservedBookings).toBe(1);
    });

    it("falls back to the plain badge when only expired reservations remain", () => {
      // why: with nothing live claimed, there is nothing to put on a card and
      // the asset reads Available, which is what the shelf says.
      expect(
        labelFor(
          asset({
            quantity: 10,
            bookingAssets: [
              reservedSlice(3, "dead", { from: twoDaysAgo, to: dayAgo }),
            ],
          })
        )
      ).toBeNull();
    });

    it("still counts a reservation past its start while its end is ahead", () => {
      // why: a late pickup is a live claim; only the end date decides.
      const data = getQuantityData(
        asset({
          quantity: 10,
          bookingAssets: [
            reservedSlice(3, "late", { from: dayAgo, to: inADay }),
          ],
        })
      );

      expect(data?.reserved).toBe(3);
      expect(data?.expiredReserved).toBe(0);
    });

    it("keeps counting a RESERVED slice that carries no end date", () => {
      // why: a loader that selects no `to` must get today's behaviour, not a
      // silently emptier card.
      const data = getQuantityData(
        asset({ quantity: 10, bookingAssets: [slice(3, "RESERVED")] })
      );

      expect(data?.reserved).toBe(3);
      expect(data?.expiredReserved).toBe(0);
    });
  });
});
