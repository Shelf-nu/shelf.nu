/**
 * Tests for `computeBookingAvailableQuantity`: how much of a quantity-tracked
 * asset is free once custody and active bookings are taken off.
 *
 * Kept apart from `service.server.test.ts`, which replaces
 * `~/modules/asset/availability-primitives.server` with a stub. These tests
 * need the real per-slice attribution from that module.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";

import { db } from "~/database/db.server";

import { computeBookingAvailableQuantity } from "./service.server";

// @vitest-environment node

// why: the function reads the asset, its custody, its reservation rows and
// their logged units through `db`. Only those four reads are stubbed; the
// attribution and the arithmetic run for real.
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: { findUniqueOrThrow: vitest.fn() },
    custody: { aggregate: vitest.fn() },
    bookingAsset: { findMany: vitest.fn() },
    consumptionLog: { groupBy: vitest.fn() },
  },
}));

const ASSET_ID = "asset-1";

/** A slice of the asset on booking `b1`, sent out in full. */
const slice = (id: string, assetKitId: string | null, quantity: number) => ({
  id,
  bookingId: "b1",
  assetId: ASSET_ID,
  quantity,
  assetKitId,
  checkedOutAt: new Date("2026-01-02T09:00:00Z"),
  checkedOutQuantity: quantity,
});

/** Logged RETURN / CONSUME / LOSS / DAMAGE units, grouped as the read groups them. */
const logged = (bookingAssetId: string | null, quantity: number) => ({
  bookingAssetId,
  bookingId: "b1",
  assetId: ASSET_ID,
  _sum: { quantity },
});

describe("computeBookingAvailableQuantity", () => {
  beforeEach(() => {
    vitest.mocked(db.asset.findUniqueOrThrow).mockResolvedValue({
      quantity: 20,
    } as never);
    vitest.mocked(db.custody.aggregate).mockResolvedValue({
      _sum: { quantity: 0 },
    } as never);
    // b1 holds the asset loose (6) and through a kit (6); both went out.
    vitest
      .mocked(db.bookingAsset.findMany)
      .mockResolvedValue([
        slice("ba-loose", null, 6),
        slice("ba-kit", "ak-1", 6),
      ] as never);
  });

  it("keeps the loose units reserved when the kit's units come back", async () => {
    vitest
      .mocked(db.consumptionLog.groupBy)
      .mockResolvedValue([logged("ba-kit", 6)] as never);

    const result = await computeBookingAvailableQuantity(ASSET_ID);

    // Only the kit slice is freed: the loose 6 are still out.
    expect(result.reserved).toBe(6);
    expect(result.available).toBe(14);
  });

  it("frees the loose slice first for units that name no slice", async () => {
    vitest
      .mocked(db.consumptionLog.groupBy)
      .mockResolvedValue([logged(null, 8)] as never);

    const result = await computeBookingAvailableQuantity(ASSET_ID);

    // 6 on the loose slice, 2 on the kit slice: 4 of the kit's are still out.
    expect(result.reserved).toBe(4);
    expect(result.available).toBe(16);
  });

  it("asks for the logged units per slice", async () => {
    vitest.mocked(db.consumptionLog.groupBy).mockResolvedValue([] as never);

    await computeBookingAvailableQuantity(ASSET_ID);

    expect(db.consumptionLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["bookingAssetId", "bookingId", "assetId"],
      })
    );
  });
});
