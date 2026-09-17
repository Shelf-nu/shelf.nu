import { describe, expect, it } from "vitest";
import { computeBookingSliceUnitCounts } from "./booking-slice-unit-counts.server";

// @vitest-environment node

/** A quantity-tracked asset with a 3-unit standalone slice and a 2-unit kit slice. */
const batteries = new Map([
  [
    "batteries",
    [
      { id: "ba-kit", quantity: 2, assetKitId: "ak-power" },
      { id: "ba-standalone", quantity: 3, assetKitId: null },
    ],
  ],
]);

describe("computeBookingSliceUnitCounts", () => {
  it("credits a check-out entry to the slice it names and spreads an untagged one standalone first", () => {
    const { checkedOutByBookingAsset } = computeBookingSliceUnitCounts({
      bookingAssetRowsByAsset: batteries,
      dispositionLogs: [],
      checkoutSessions: [
        {
          assetIds: ["batteries"],
          quantities: [1],
          bookingAssetIds: ["ba-kit"],
        },
        { assetIds: ["batteries"], quantities: [4], bookingAssetIds: [""] },
      ],
    });

    // The untagged 4 fill the standalone slice's 3, then 1 more of the kit's.
    expect(Object.fromEntries(checkedOutByBookingAsset)).toEqual({
      "ba-kit": 2,
      "ba-standalone": 3,
    });
  });

  it("spreads untagged dispositions across one shared capacity per slice", () => {
    const { dispositionedByBookingAsset, breakdownByBookingAsset } =
      computeBookingSliceUnitCounts({
        bookingAssetRowsByAsset: batteries,
        dispositionLogs: [
          {
            assetId: "batteries",
            bookingAssetId: null,
            category: "RETURN",
            quantity: 2,
          },
          {
            assetId: "batteries",
            bookingAssetId: null,
            category: "LOSS",
            quantity: 2,
          },
        ],
        checkoutSessions: [],
      });

    // The standalone slice takes 2 returned + 1 lost, filling its 3; the lost
    // unit left over lands on the kit slice rather than overfilling.
    expect(Object.fromEntries(dispositionedByBookingAsset)).toEqual({
      "ba-kit": 1,
      "ba-standalone": 3,
    });
    expect(breakdownByBookingAsset.get("ba-standalone")).toEqual({
      returned: 2,
      consumed: 0,
      lost: 1,
      damaged: 0,
    });
    expect(breakdownByBookingAsset.get("ba-kit")).toEqual({
      returned: 0,
      consumed: 0,
      lost: 1,
      damaged: 0,
    });
  });

  it("counts only the assets it is given, with a zero entry for every slice nothing names", () => {
    const counts = computeBookingSliceUnitCounts({
      bookingAssetRowsByAsset: batteries,
      dispositionLogs: [
        // Not a disposition: a check-out log names no returned unit.
        {
          assetId: "batteries",
          bookingAssetId: "ba-standalone",
          category: "CHECKOUT",
          quantity: 3,
        },
        {
          assetId: "tripod",
          bookingAssetId: "ba-tripod",
          category: "RETURN",
          quantity: 1,
        },
      ],
      checkoutSessions: [
        { assetIds: ["tripod"], quantities: [1], bookingAssetIds: [""] },
      ],
    });

    expect(Object.fromEntries(counts.checkedOutByBookingAsset)).toEqual({
      "ba-kit": 0,
      "ba-standalone": 0,
    });
    expect(Object.fromEntries(counts.dispositionedByBookingAsset)).toEqual({
      "ba-kit": 0,
      "ba-standalone": 0,
    });
    expect(counts.breakdownByBookingAsset.has("ba-tripod")).toBe(false);
  });
});
