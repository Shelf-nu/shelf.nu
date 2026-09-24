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
    // why: THE regression. 5 out on a booking, 5 reserved for next month, 10
    // owned. The reservation-aware number hits zero and the badge used to read
    // "Checked out", while five units were physically present, and the
    // Free now column on the same row correctly said 5.
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
    // once commitments exceed the pool and used to print "-2 free right now".
    const data = getQuantityData(
      asset({ quantity: 10, bookingAssets: [slice(12, "RESERVED")] })
    );

    expect(data?.freeNow).toBe(10);
    expect(data?.available).toBeLessThan(0);
  });
});
