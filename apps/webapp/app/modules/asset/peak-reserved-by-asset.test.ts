/**
 * Peak concurrent reserved units, batched per asset.
 *
 * The booking term for anything that holds units without dates of its own — a
 * kit slice, or the asset's own total. Such a holder has to survive every
 * future instant, so what it competes against is the highest demand at any one
 * moment. Summing reservations instead would refuse allocations that are
 * perfectly safe: two bookings in disjoint windows never hold units together.
 *
 * @see {@link file://./availability-primitives.server.ts}
 */

import { BookingStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPeakReservedUnitsByAsset } from "./availability-primitives.server";

const ASSET = "asset-1";
const OTHER = "asset-2";

/**
 * A transaction client stubbed at the two delegates this primitive reads.
 *
 * why: the arithmetic under test is the interval sweep, not Prisma. Feeding
 * rows directly lets each case state a booking timeline and read back the peak.
 */
function txWith(
  reservedRows: unknown[],
  loggedGroups: unknown[] = []
): Parameters<typeof getPeakReservedUnitsByAsset>[0]["tx"] {
  return {
    bookingAsset: { findMany: vi.fn().mockResolvedValue(reservedRows) },
    consumptionLog: { groupBy: vi.fn().mockResolvedValue(loggedGroups) },
  } as unknown as Parameters<typeof getPeakReservedUnitsByAsset>[0]["tx"];
}

/** One standalone reservation of `qty` units over `[from, to]`. */
function reservation(
  assetId: string,
  bookingId: string,
  qty: number,
  from: string,
  to: string,
  {
    id = `${bookingId}-${assetId}`,
    assetKitId = null,
    status = BookingStatus.RESERVED,
  }: { id?: string; assetKitId?: string | null; status?: BookingStatus } = {}
) {
  return {
    id,
    assetId,
    bookingId,
    quantity: qty,
    assetKitId,
    booking: { from: new Date(from), to: new Date(to), status },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPeakReservedUnitsByAsset", () => {
  it("issues no query for an empty asset list", async () => {
    const tx = txWith([]);

    await expect(
      getPeakReservedUnitsByAsset({ assetIds: [], organizationId: "org", tx })
    ).resolves.toEqual(new Map());

    expect(tx.bookingAsset.findMany).not.toHaveBeenCalled();
  });

  it("does not stack reservations that never overlap", async () => {
    // The whole point: 60 in January and 60 in March hold 60 at once, never
    // 120. Summing would report 120 and collapse the claimable pool.
    const tx = txWith([
      reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10"),
      reservation(ASSET, "b2", 60, "2026-03-01", "2026-03-10"),
    ]);

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBe(60);
  });

  it("adds reservations that do overlap", async () => {
    const tx = txWith([
      reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-20"),
      reservation(ASSET, "b2", 30, "2026-01-10", "2026-01-15"),
    ]);

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBe(90);
  });

  it("keeps each asset's timeline separate", async () => {
    const tx = txWith([
      reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10"),
      reservation(OTHER, "b1", 25, "2026-01-01", "2026-01-10"),
    ]);

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET, OTHER],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBe(60);
    expect(peaks.get(OTHER)).toBe(25);
  });

  it("reduces a reservation by what has already been returned", async () => {
    // A partial check-in writes a ConsumptionLog row without decrementing
    // BookingAsset.quantity, so the raw quantity overstates what is still out.
    const tx = txWith(
      [reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10")],
      [
        {
          bookingAssetId: "b1-asset-1",
          bookingId: "b1",
          assetId: ASSET,
          _sum: { quantity: 25 },
        },
      ]
    );

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBe(35);
  });

  it("does not let one asset's return reduce another's reservation", async () => {
    // One booking can carry several assets. Keying the logged dispositions by
    // booking alone would subtract asset-1's return from asset-2's footprint.
    const tx = txWith(
      [
        reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10"),
        reservation(OTHER, "b1", 60, "2026-01-01", "2026-01-10"),
      ],
      [
        {
          bookingAssetId: "b1-asset-1",
          bookingId: "b1",
          assetId: ASSET,
          _sum: { quantity: 60 },
        },
      ]
    );

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET, OTHER],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBeUndefined();
    expect(peaks.get(OTHER)).toBe(60);
  });
  it("does not let a kit slice's return shrink the standalone reservation", () => {
    // One (booking, asset) pair can hold a standalone slice and kit-driven
    // ones at once. A return logged against the kit slice belongs to that
    // slice — attributing it to the standalone row would understate what is
    // still reserved and let a kit claim units the booking still needs.
    const tx = txWith(
      [
        reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10", {
          id: "standalone-row",
        }),
        reservation(ASSET, "b1", 40, "2026-01-01", "2026-01-10", {
          id: "kit-row",
          assetKitId: "ak-1",
        }),
      ],
      [
        {
          bookingAssetId: "kit-row",
          bookingId: "b1",
          assetId: ASSET,
          _sum: { quantity: 40 },
        },
      ]
    );

    return getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    }).then((peaks) => {
      // The standalone 60 is untouched; the kit slice never enters the peak.
      expect(peaks.get(ASSET)).toBe(60);
    });
  });

  it("fills kit slices first with a disposition that predates row attribution", async () => {
    // Legacy logs carry no row id. Per `ConsumptionLog.bookingAssetId` they
    // attribute kit-driven-first, so only what exceeds the kit capacity may
    // reduce the standalone row.
    const tx = txWith(
      [
        reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10", {
          id: "standalone-row",
        }),
        reservation(ASSET, "b1", 40, "2026-01-01", "2026-01-10", {
          id: "kit-row",
          assetKitId: "ak-1",
        }),
      ],
      [
        {
          bookingAssetId: null,
          bookingId: "b1",
          assetId: ASSET,
          _sum: { quantity: 50 },
        },
      ]
    );

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    // 40 absorbed by the kit slice, 10 left to reduce the standalone 60.
    expect(peaks.get(ASSET)).toBe(50);
  });
});
