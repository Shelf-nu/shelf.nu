import { describe, expect, it } from "vitest";

import {
  attributeSessionCheckoutToSlices,
  checkoutSessionsToLogsByAsset,
} from "./checkout-attribution";

/**
 * Unit tests for the positional-array checkout-session parser.
 *
 * These lock the positional `bookingAssetIds` contract (spec section D/F):
 * `assetIds[i]` / `quantities[i]` / `bookingAssetIds[i]` describe the same
 * slice; `""` and legacy short/empty arrays mean "greedy" (`bookingAssetId:
 * null`); non-QT assets are excluded.
 */
describe("checkoutSessionsToLogsByAsset", () => {
  it("attributes a tagged slice exactly to its bookingAssetId", () => {
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-qt"],
          quantities: [7],
          bookingAssetIds: ["ba-standalone"],
        },
      ],
      () => true
    );

    expect(result.get("asset-qt")).toEqual([
      { bookingAssetId: "ba-standalone", quantity: 7 },
    ]);
  });

  it("treats the empty-string sentinel as null (greedy)", () => {
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-qt"],
          quantities: [4],
          bookingAssetIds: [""],
        },
      ],
      () => true
    );

    expect(result.get("asset-qt")).toEqual([
      { bookingAssetId: null, quantity: 4 },
    ]);
  });

  it("treats a short/empty bookingAssetIds array as null per index (legacy rows)", () => {
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-a", "asset-b"],
          quantities: [2, 3],
          // Legacy row: column absent → shorter than assetIds.
          bookingAssetIds: [],
        },
      ],
      () => true
    );

    expect(result.get("asset-a")).toEqual([
      { bookingAssetId: null, quantity: 2 },
    ]);
    expect(result.get("asset-b")).toEqual([
      { bookingAssetId: null, quantity: 3 },
    ]);
  });

  it("skips non-QT assets", () => {
    const qtAssetIds = new Set(["asset-qt"]);
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-individual", "asset-qt"],
          quantities: [1, 5],
          bookingAssetIds: ["", "ba-kit"],
        },
      ],
      (assetId) => qtAssetIds.has(assetId)
    );

    expect(result.has("asset-individual")).toBe(false);
    expect(result.get("asset-qt")).toEqual([
      { bookingAssetId: "ba-kit", quantity: 5 },
    ]);
  });

  it("counts one unit per slice when quantities is misaligned with assetIds", () => {
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-a", "asset-b"],
          // Legacy INDIVIDUAL-only session: quantities not aligned 1:1.
          quantities: [],
          bookingAssetIds: ["", ""],
        },
      ],
      () => true
    );

    expect(result.get("asset-a")).toEqual([
      { bookingAssetId: null, quantity: 1 },
    ]);
    expect(result.get("asset-b")).toEqual([
      { bookingAssetId: null, quantity: 1 },
    ]);
  });

  it("accumulates logs for the same asset across multiple sessions", () => {
    const result = checkoutSessionsToLogsByAsset(
      [
        {
          assetIds: ["asset-qt"],
          quantities: [10],
          bookingAssetIds: ["ba-standalone"],
        },
        {
          assetIds: ["asset-qt"],
          quantities: [6],
          bookingAssetIds: [""],
        },
      ],
      () => true
    );

    expect(result.get("asset-qt")).toEqual([
      { bookingAssetId: "ba-standalone", quantity: 10 },
      { bookingAssetId: null, quantity: 6 },
    ]);
  });
});

/**
 * A QUANTITY_TRACKED asset can hold several slices on one booking — a
 * standalone one plus one per kit — so a session's units have to be placed on
 * the right one. The `checkedOutAt` marker makes the same choice from the same
 * comparator and the same capacity; these lock the capacity half, because a
 * slice counted past what it booked, or marked as departed with a count of
 * zero, is a departure nothing downstream can size.
 */
describe("attributeSessionCheckoutToSlices", () => {
  /** Standalone 5 units, kit-driven 5 units, same asset, same booking. */
  const TWO_SLICES = [
    { id: "s1", assetId: "x", quantity: 5, assetKitId: null },
    { id: "s2", assetId: "x", quantity: 5, assetKitId: "ak" },
  ];

  it("fills the standalone slice before the kit-driven one", () => {
    const out = attributeSessionCheckoutToSlices({
      sliceRows: TWO_SLICES,
      committedRemainingBySlice: new Map([
        ["s1", 5],
        ["s2", 5],
      ]),
      claims: [{ assetId: "x", bookingAssetId: null, quantity: 5 }],
    });
    expect(out.get("s1")).toBe(5);
    expect(out.get("s2")).toBeUndefined();
  });

  it("credits the next slice once an earlier one has nothing left to give", () => {
    // The state after a first session took all 5 of the standalone slice.
    const out = attributeSessionCheckoutToSlices({
      sliceRows: TWO_SLICES,
      committedRemainingBySlice: new Map([
        ["s1", 0],
        ["s2", 5],
      ]),
      claims: [{ assetId: "x", bookingAssetId: null, quantity: 5 }],
    });
    // Capping by booked quantity instead of remaining puts all 5 back on s1,
    // which is both double its booked total and not the slice the marker
    // stamped.
    expect(out.get("s1")).toBeUndefined();
    expect(out.get("s2")).toBe(5);
  });

  it("splits one claim across slices when the first cannot absorb it", () => {
    const out = attributeSessionCheckoutToSlices({
      sliceRows: TWO_SLICES,
      committedRemainingBySlice: new Map([
        ["s1", 2],
        ["s2", 5],
      ]),
      claims: [{ assetId: "x", bookingAssetId: null, quantity: 3 }],
    });
    expect(out.get("s1")).toBe(2);
    expect(out.get("s2")).toBe(1);
  });

  it("does not spend the same capacity twice when a session mixes tagged and untagged claims", () => {
    const out = attributeSessionCheckoutToSlices({
      sliceRows: TWO_SLICES,
      committedRemainingBySlice: new Map([
        ["s1", 5],
        ["s2", 5],
      ]),
      claims: [
        { assetId: "x", bookingAssetId: "s1", quantity: 4 },
        { assetId: "x", bookingAssetId: null, quantity: 3 },
      ],
    });
    // s1 has 1 of its 5 left after the tagged claim, so the untagged 3 puts 1
    // there and the rest on s2. Ignoring the tagged claim would report 7 units
    // on a slice that booked 5.
    expect(out.get("s1")).toBe(5);
    expect(out.get("s2")).toBe(2);
  });

  it("keeps one asset's untagged claim out of another asset's slices", () => {
    const out = attributeSessionCheckoutToSlices({
      sliceRows: [
        { id: "a1", assetId: "a", quantity: 2, assetKitId: null },
        { id: "b1", assetId: "b", quantity: 9, assetKitId: null },
      ],
      committedRemainingBySlice: new Map([
        ["a1", 2],
        ["b1", 9],
      ]),
      claims: [{ assetId: "a", bookingAssetId: null, quantity: 5 }],
    });
    expect(out.get("a1")).toBe(2);
    expect(out.get("b1")).toBeUndefined();
  });

  it("falls back to booked quantity for a slice the remaining map does not carry", () => {
    // The map covers QUANTITY_TRACKED slices only; an INDIVIDUAL slice is
    // absent, and a zero default would refuse to count it at all.
    const out = attributeSessionCheckoutToSlices({
      sliceRows: [{ id: "i1", assetId: "i", quantity: 1, assetKitId: null }],
      committedRemainingBySlice: new Map(),
      claims: [{ assetId: "i", bookingAssetId: null, quantity: 1 }],
    });
    expect(out.get("i1")).toBe(1);
  });
});
