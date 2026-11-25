/**
 * `shortPoolAssetIds`: which scanned pools the check-out drawer blocks.
 *
 * @see {@link file://./short-pools.ts}
 */

import { describe, expect, it } from "vitest";

import { shortPoolAssetIds } from "./short-pools";
import type { ShortPoolSummary } from "./short-pools";

type Part = ShortPoolSummary["parts"][number];

/** A display part with nothing out yet. */
function part(
  kind: Part["kind"],
  planned: number,
  short: boolean,
  out = 0
): Part {
  return { kind, planned, out, short };
}

/** A summary, short when any part is. */
function summary(...parts: Part[]): ShortPoolSummary {
  return { short: parts.some((p) => p.short), parts };
}

describe("shortPoolAssetIds", () => {
  it("blocks a pool when every source with pending units is short", () => {
    expect(
      shortPoolAssetIds(
        [
          { id: "ba-1", assetId: "cables", assetKitId: null },
          { id: "ba-2", assetId: "cables", assetKitId: null },
          { id: "ba-3", assetId: "tape", assetKitId: null },
        ],
        new Map([
          [
            "ba-1",
            summary(
              part("LOCATION", 6, true),
              part("UNASSIGNED", 2, true),
              // Fully out: nothing pending here, so it lets nothing go.
              part("LOCATION", 3, false, 3)
            ),
          ],
          ["ba-2", summary(part("UNPLACED", 4, true))],
          ["ba-3", summary(part("LOCATION", 5, false))],
        ])
      )
    ).toEqual(["cables"]);
  });

  it("does not block an AUTO slice of 10 with Studio 7 healthy and 3 on Needs a location", () => {
    expect(
      shortPoolAssetIds(
        [{ id: "ba-1", assetId: "cables", assetKitId: null }],
        new Map([
          [
            "ba-1",
            summary(part("LOCATION", 7, false), part("UNASSIGNED", 3, true)),
          ],
        ])
      )
    ).toEqual([]);
  });

  it("does not block when Studio is short but Warehouse has pending units and is not", () => {
    expect(
      shortPoolAssetIds(
        [{ id: "ba-1", assetId: "cables", assetKitId: null }],
        new Map([
          [
            "ba-1",
            summary(part("LOCATION", 4, true), part("LOCATION", 6, false)),
          ],
        ])
      )
    ).toEqual([]);
  });

  it("does not block when another standalone slice of the asset has a healthy source", () => {
    expect(
      shortPoolAssetIds(
        [
          { id: "ba-1", assetId: "cables", assetKitId: null },
          { id: "ba-2", assetId: "cables", assetKitId: null },
        ],
        new Map([
          ["ba-1", summary(part("UNASSIGNED", 3, true))],
          ["ba-2", summary(part("UNPLACED", 2, false))],
        ])
      )
    ).toEqual([]);
  });

  it("ignores kit slices and slices with no summary", () => {
    expect(
      shortPoolAssetIds(
        [
          { id: "ba-kit", assetId: "cables", assetKitId: "ak-1" },
          { id: "ba-legacy", assetId: "tape", assetKitId: null },
        ],
        new Map([["ba-kit", summary(part("LOCATION", 2, true))]])
      )
    ).toEqual([]);
  });
});
