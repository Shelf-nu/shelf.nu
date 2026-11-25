/**
 * `shortPoolAssetIds`: which scanned pools the check-out drawer blocks.
 *
 * @see {@link file://./short-pools.ts}
 */

import { describe, expect, it } from "vitest";

import { shortPoolAssetIds } from "./short-pools";

describe("shortPoolAssetIds", () => {
  it("lists the asset of a short standalone slice once", () => {
    expect(
      shortPoolAssetIds(
        [
          { id: "ba-1", assetId: "cables", assetKitId: null },
          { id: "ba-2", assetId: "cables", assetKitId: null },
          { id: "ba-3", assetId: "tape", assetKitId: null },
        ],
        new Map([
          ["ba-1", { short: true }],
          ["ba-2", { short: true }],
          ["ba-3", { short: false }],
        ])
      )
    ).toEqual(["cables"]);
  });

  it("ignores kit slices and slices with no summary", () => {
    expect(
      shortPoolAssetIds(
        [
          { id: "ba-kit", assetId: "cables", assetKitId: "ak-1" },
          { id: "ba-legacy", assetId: "tape", assetKitId: null },
        ],
        new Map([["ba-kit", { short: true }]])
      )
    ).toEqual([]);
  });
});
