import { describe, expect, it } from "vitest";

import { checkoutSessionsToLogsByAsset } from "./checkout-attribution";

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
