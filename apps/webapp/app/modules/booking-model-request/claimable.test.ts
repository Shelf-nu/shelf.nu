import { AssetType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { BookingAssetRowForClaim } from "./claimable";
import { resolveClaimableAssetIds } from "./claimable";

/** A standalone row, unstamped and INDIVIDUAL unless a case says otherwise. */
function row(
  assetId: string,
  overrides: Partial<BookingAssetRowForClaim> & {
    type?: AssetType;
  } = {}
): BookingAssetRowForClaim {
  const { type = AssetType.INDIVIDUAL, ...rest } = overrides;
  return {
    assetKitId: null,
    bookingModelRequestId: null,
    asset: { id: assetId, type },
    ...rest,
  };
}

describe("resolveClaimableAssetIds", () => {
  it("claims a standalone row that carries no stamp", () => {
    // The ordinary case: a unit added before the reservation existed.
    expect([...resolveClaimableAssetIds([row("asset-1")])]).toEqual([
      "asset-1",
    ]);
  });

  it("refuses a row that already answered a reservation", () => {
    expect([
      ...resolveClaimableAssetIds([
        row("asset-1", { bookingModelRequestId: "req-1" }),
      ]),
    ]).toEqual([]);
  });

  it("refuses a kit-driven row", () => {
    // A reservation promises loose units; a kit's are answered by scanning the
    // kit, so a kit row is never the thing a loose scan claims on.
    expect([
      ...resolveClaimableAssetIds([row("asset-1", { assetKitId: "ak-1" })]),
    ]).toEqual([]);
  });

  it("refuses an asset whose OTHER row carries the stamp", () => {
    // One physical unit discharges one reserved unit however it reached the
    // booking, so the write refuses an asset stamped anywhere. This pair is
    // what a kit member later scanned loose looks like, and judging the
    // standalone row alone would promise a claim the write then declines.
    expect([
      ...resolveClaimableAssetIds([
        row("asset-1", { assetKitId: "ak-1", bookingModelRequestId: "req-1" }),
        row("asset-1"),
      ]),
    ]).toEqual([]);
  });

  it("refuses a quantity-tracked row", () => {
    // A reserved unit is a whole unit, so a pool never answers one.
    expect([
      ...resolveClaimableAssetIds([
        row("asset-1", { type: AssetType.QUANTITY_TRACKED }),
      ]),
    ]).toEqual([]);
  });

  it("judges each asset on its own rows", () => {
    // One asset's stamp must not disqualify another's.
    expect([
      ...resolveClaimableAssetIds([
        row("asset-stamped", { bookingModelRequestId: "req-1" }),
        row("asset-free"),
      ]),
    ]).toEqual(["asset-free"]);
  });
});
