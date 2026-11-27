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
  loggedGroups: unknown[] = [],
  sourceRows: unknown[] = []
): Parameters<typeof getPeakReservedUnitsByAsset>[0]["tx"] {
  return {
    // why: a converted slice's demand is the remaining reservation of its
    // source rows; feeding them directly states that demand per case.
    bookingAssetSource: { findMany: vi.fn().mockResolvedValue(sourceRows) },
    // why: the reservation rows are the timeline under test — feeding them
    // directly is what lets a case state a set of booking windows.
    bookingAsset: { findMany: vi.fn().mockResolvedValue(reservedRows) },
    // why: dispositions decide how much of each row is still reserved, and
    // which row they attach to is the distinction several cases turn on.
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
    sourceAllocation = "LEGACY",
  }: {
    id?: string;
    assetKitId?: string | null;
    status?: BookingStatus;
    sourceAllocation?: "LEGACY" | "KIT" | "AUTO" | "MANUAL";
  } = {}
) {
  return {
    id,
    assetId,
    bookingId,
    quantity: qty,
    assetKitId,
    sourceAllocation,
    checkedOutQuantity: 0,
    booking: { from: new Date(from), to: new Date(to), status },
  };
}

/** One source row of a converted slice. */
function sourceRow(
  bookingAssetId: string,
  quantity: number,
  releasedQuantity = 0
) {
  return { bookingAssetId, quantity, releasedQuantity };
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

  describe("a return logged without a row id", () => {
    /**
     * Booking b1 holds the asset loose (60) and through a kit (40). Each slice
     * can be given the units it has sent out so far.
     */
    function mixedBooking(sentOut: {
      loose: number | null;
      kit: number | null;
    }) {
      return [
        {
          ...reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10", {
            id: "standalone-row",
            status: BookingStatus.ONGOING,
          }),
          checkedOutQuantity: sentOut.loose,
        },
        {
          ...reservation(ASSET, "b1", 40, "2026-01-01", "2026-01-10", {
            id: "kit-row",
            assetKitId: "ak-1",
            status: BookingStatus.ONGOING,
          }),
          checkedOutQuantity: sentOut.kit,
        },
      ];
    }

    /** One untagged disposition of `quantity` units on booking b1. */
    const untagged = (quantity: number) => ({
      bookingAssetId: null,
      bookingId: "b1",
      assetId: ASSET,
      _sum: { quantity },
    });

    const peakFor = async (rows: unknown[], logs: unknown[]) =>
      (
        await getPeakReservedUnitsByAsset({
          assetIds: [ASSET],
          organizationId: "org",
          tx: txWith(rows, logs),
        })
      ).get(ASSET);

    it("comes off the loose slice first", async () => {
      // Loose items are returned one by one and a kit comes back whole, so an
      // untagged return is read as the loose slice's. It is the order the
      // check-out markers and every booking surface use.
      await expect(
        peakFor(mixedBooking({ loose: 60, kit: 40 }), [untagged(50)])
      ).resolves.toBe(10);
    });

    it("reaches the kit slice only once the loose slice has given back all it sent out", async () => {
      // 70 back: 60 from the loose slice, the other 10 from the kit slice.
      await expect(
        peakFor(mixedBooking({ loose: 60, kit: 40 }), [untagged(70)])
      ).resolves.toBeUndefined();
    });

    it("never comes off a loose slice that has not gone out", async () => {
      // The loose 60 is still on the shelf, reserved. Only the kit went out,
      // so the 40 that came back can only be the kit's.
      await expect(
        peakFor(mixedBooking({ loose: 0, kit: 40 }), [untagged(40)])
      ).resolves.toBe(60);
    });

    it("comes off the loose slice after the kit slice returned under its own id", async () => {
      await expect(
        peakFor(mixedBooking({ loose: 60, kit: 40 }), [
          {
            bookingAssetId: "kit-row",
            bookingId: "b1",
            assetId: ASSET,
            _sum: { quantity: 40 },
          },
          untagged(10),
        ])
      ).resolves.toBe(50);
    });

    it("is taken by a kit slice sent out twice when the loose slice has not gone out", async () => {
      // The kit went out twice (80 sent) and came back twice: once tagged,
      // once untagged. Its room is what it sent out, so it takes both.
      await expect(
        peakFor(mixedBooking({ loose: 0, kit: 80 }), [
          {
            bookingAssetId: "kit-row",
            bookingId: "b1",
            assetId: ASSET,
            _sum: { quantity: 40 },
          },
          untagged(40),
        ])
      ).resolves.toBe(60);
    });

    it("treats a slice with no counter as not having gone out", async () => {
      // Nothing can be given back by a slice that sent nothing out, so the
      // loose reservation stays whole.
      await expect(
        peakFor(mixedBooking({ loose: null, kit: null }), [untagged(40)])
      ).resolves.toBe(60);
    });
  });
});

describe("getPeakReservedUnitsByAsset, a slice sent out again after a full return", () => {
  /**
   * A standalone slice of 6 on an ONGOING booking that went out, came back in
   * full and went out again. `checkedOutQuantity` is cumulative, so it reads
   * 12 against 6 returned: 6 units are out.
   */
  const redispatched = {
    ...reservation(ASSET, "b1", 6, "2026-01-01", "2026-01-31", {
      status: BookingStatus.ONGOING,
    }),
    checkedOutQuantity: 12,
  };
  const firstTripReturn = {
    bookingAssetId: "b1-asset-1",
    bookingId: "b1",
    assetId: ASSET,
    _sum: { quantity: 6 },
  };

  it("counts the units that are out again", async () => {
    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx: txWith([redispatched], [firstTripReturn]),
    });

    expect(peaks.get(ASSET)).toBe(6);
  });

  it("counts only the units sent out the second time", async () => {
    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx: txWith(
        [{ ...redispatched, checkedOutQuantity: 8 }],
        [firstTripReturn]
      ),
    });

    expect(peaks.get(ASSET)).toBe(2);
  });

  it("never counts more than the slice booked", async () => {
    // Three full trips: 18 sent out, 6 back. The slice holds 6, not 12.
    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx: txWith(
        [{ ...redispatched, checkedOutQuantity: 18 }],
        [firstTripReturn]
      ),
    });

    expect(peaks.get(ASSET)).toBe(6);
  });

  it("takes the larger reading, not their sum, after a partial return and a top-up", async () => {
    // 6 booked, 6 out, 3 back, 3 out again: 9 sent out in total, 3 back.
    // Not yet given back: 6 - 3 = 3. Out right now: 9 - 3 = 6.
    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx: txWith(
        [{ ...redispatched, checkedOutQuantity: 9 }],
        [{ ...firstTripReturn, _sum: { quantity: 3 } }]
      ),
    });

    expect(peaks.get(ASSET)).toBe(6);
  });

  it("frees a slice that came back in full and stayed back", async () => {
    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx: txWith(
        [{ ...redispatched, checkedOutQuantity: 6 }],
        [firstTripReturn]
      ),
    });

    expect(peaks.get(ASSET)).toBeUndefined();
  });
});

describe("getPeakReservedUnitsByAsset, method per booking group", () => {
  it("picks the method per group and combines every interval in one sweep", async () => {
    // b1 is a LEGACY group: 6 booked, 1 returned, so 5 held over Jan 1-10.
    // b2 is a converted group over Jan 5-15: its AUTO slice holds what its
    // rows still reserve (5 - 2 released at a location, plus 3 UNASSIGNED =
    // 6), its return log is already inside `releasedQuantity`, and its KIT
    // slice holds nothing here. Overlap Jan 5-10: 5 + 6 = 11.
    const tx = txWith(
      [
        reservation(ASSET, "b1", 6, "2026-01-01", "2026-01-10", {
          id: "legacy-row",
        }),
        reservation(ASSET, "b2", 8, "2026-01-05", "2026-01-15", {
          id: "auto-row",
          sourceAllocation: "AUTO",
        }),
        reservation(ASSET, "b2", 4, "2026-01-05", "2026-01-15", {
          id: "kit-row",
          assetKitId: "ak-1",
          sourceAllocation: "KIT",
        }),
      ],
      [
        {
          bookingAssetId: "legacy-row",
          bookingId: "b1",
          assetId: ASSET,
          _sum: { quantity: 1 },
        },
        {
          bookingAssetId: "auto-row",
          bookingId: "b2",
          assetId: ASSET,
          _sum: { quantity: 2 },
        },
      ],
      [sourceRow("auto-row", 5, 2), sourceRow("auto-row", 3)]
    );

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBe(11);
    // Logs are read for the LEGACY group only, source rows for the AUTO
    // slice only, each in one query.
    expect(tx.consumptionLog.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.consumptionLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookingId: { in: ["b1"] } }),
      })
    );
    expect(tx.bookingAssetSource.findMany).toHaveBeenCalledTimes(1);
    expect(tx.bookingAssetSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org", bookingAssetId: { in: ["auto-row"] } },
      })
    );
  });

  it("counts nothing for a converted group's KIT slice", async () => {
    // Kit units are counted once, through `AssetKit.quantity`.
    const tx = txWith([
      reservation(ASSET, "b1", 4, "2026-01-01", "2026-01-10", {
        id: "kit-row",
        assetKitId: "ak-1",
        sourceAllocation: "KIT",
      }),
    ]);

    const peaks = await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(peaks.get(ASSET)).toBeUndefined();
    expect(tx.bookingAssetSource.findMany).not.toHaveBeenCalled();
    expect(tx.consumptionLog.groupBy).not.toHaveBeenCalled();
  });

  it("issues no source-row query when every group is LEGACY", async () => {
    const tx = txWith([
      reservation(ASSET, "b1", 60, "2026-01-01", "2026-01-10"),
    ]);

    await getPeakReservedUnitsByAsset({
      assetIds: [ASSET],
      organizationId: "org",
      tx,
    });

    expect(tx.bookingAssetSource.findMany).not.toHaveBeenCalled();
  });
});
