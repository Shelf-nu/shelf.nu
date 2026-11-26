/**
 * Booking sources: acceptance scenarios against a real database
 *
 * Runs the booking sources acceptance cases through the real services (the
 * facade, settlement, location delete, booking asset removal) against a migrated database, so the
 * deferred contract triggers judge every final state at COMMIT. Each test is
 * named after the scenario it covers. Cases already pinned by unit tests run
 * here only when the database adds something the mocks cannot: the trigger
 * checks, real cascades, or real SQL reads.
 *
 * Writes commit (the triggers fire only at COMMIT), so every test seeds its
 * own workspace and removes it in `finally`.
 *
 * The last block EXPLAINs the two probes the LEGACY fast path and the
 * placement path send on every call, with sequential scans disabled, so the
 * plan shows whether an index can serve them; the plan text is printed for
 * the performance write-up.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job).
 *
 * @see {@link file://./booking-sources-helpers.ts}
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts}
 * @see {@link file://./../../app/modules/booking/sources/location-delete.server.ts}
 */

import { performance } from "node:perf_hooks";

import { Prisma } from "@prisma/client";
import { sourceKey } from "@shelf/quantity-control";
import { afterAll, describe, expect, it } from "vitest";

import { db as appDb } from "~/database/db.server";
import {
  admitWindowChange,
  allocateNewSlices,
  dispatchUnits,
  getSliceSourceSummaries,
  resizeSlices,
} from "~/modules/booking/sources/booking-sources.server";
import {
  computeFreeBySource,
  loadPhysicalNow,
} from "~/modules/booking/sources/capacity.server";
import { removeAssets } from "~/modules/booking/service.server";
import { evacuateLocationsForDelete } from "~/modules/booking/sources/location-delete.server";

import type {
  RowRead,
  SourceKind,
  TestWindow,
} from "./booking-sources-helpers";
import {
  addSlice,
  assertContractHolds,
  checkInUnits,
  checkOutUnits,
  cleanupPools,
  commitTx,
  countersOf,
  hoursFromNow,
  insertLog,
  insertShare,
  insertSource,
  lockBooking,
  nth,
  readRows,
  readShares,
  readSlice,
  rowOf,
  seedKit,
  setSliceMode,
} from "./booking-sources-helpers";
import type { TxClient } from "./client";
import {
  commitAndExpect,
  disconnectTestDb,
  getTestDb,
  withRollback,
} from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedBooking, seedOrgWithPool } from "./fixtures";

/** A booking window in the future, shared by tests that need no "now". */
const W: TestWindow = {
  from: new Date("2030-03-01T09:00:00Z"),
  to: new Date("2030-03-03T09:00:00Z"),
};

afterAll(async () => {
  await disconnectTestDb();
  // `getSliceSourceSummaries` reads through the app's own client.
  await appDb.$disconnect();
});

/**
 * Rows reduced to `[kind, locationId, quantity, out, released, dispatched]`,
 * for whole-slice assertions.
 *
 * @param rows - Rows from `readRows`.
 */
function shape(
  rows: RowRead[]
): Array<[SourceKind, string | null, ...number[]]> {
  return rows.map((r) => [r.kind, r.locationId, ...countersOf(r)]);
}

/**
 * Pending and out units over a slice's loose (LOCATION and UNPLACED) rows.
 *
 * @param rows - Rows from `readRows`.
 */
function looseTotals(rows: RowRead[]): { out: number; pending: number } {
  return rows
    .filter((r) => r.kind === "LOCATION" || r.kind === "UNPLACED")
    .reduce(
      (sum, r) => ({
        out: sum.out + r.outQuantity,
        pending: sum.pending + r.quantity - r.releasedQuantity - r.outQuantity,
      }),
      { out: 0, pending: 0 }
    );
}

/**
 * Seeds a reserved booking with one new slice and allocates it, committed.
 *
 * @param tx - Transaction client.
 * @param pool - The workspace and pool.
 * @param quantity - Units booked.
 * @param window - The booking window.
 * @returns The booking and slice ids.
 */
async function reserveSlice(
  tx: TxClient,
  pool: SeededOrgWithPool,
  quantity: number,
  window: TestWindow = W
): Promise<{ bookingId: string; sliceId: string }> {
  const booking = await seedBooking(tx, {
    organizationId: pool.organizationId,
    userId: pool.userId,
    status: "RESERVED",
    from: window.from,
    to: window.to,
    slices: [{ assetId: pool.assetId, quantity }],
  });
  const sliceId = nth(booking.sliceIds, 0);
  await allocateNewSlices(tx, {
    organizationId: pool.organizationId,
    bookingId: booking.bookingId,
    sliceIds: [sliceId],
    window,
    holdsNow: true,
    adoptionEnabled: true,
  });
  return { bookingId: booking.bookingId, sliceId };
}

/** Ids of {@link seedConvertedStandaloneAndKit}. */
type ConvertedPair = SeededOrgWithPool & {
  bookingId: string;
  standaloneId: string;
  kitSliceId: string;
  /** The kit the kit slice belongs to. */
  kitId: string;
  logId: string;
  locationA: string;
};

/**
 * Standalone + kit slice, 5 out each, ONE untagged 8-unit RETURN log, all
 * LEGACY; then a check-out of 5 more on the standalone converts the group.
 * The standalone recorded Shelf A as its source.
 *
 * @param created - Collects the workspace for cleanup.
 * @returns The ids.
 */
async function seedConvertedStandaloneAndKit(
  created: SeededOrgWithPool[]
): Promise<ConvertedPair> {
  const seed = await commitTx(async (tx) => {
    const pool = await seedOrgWithPool(tx, {
      total: 20,
      placements: [{ name: "Shelf A", quantity: 10 }],
    });
    created.push(pool);
    const locationA = nth(pool.locationIds, 0);
    const { assetKitId, kitId } = await seedKit(tx, pool, 5);
    const booking = await seedBooking(tx, {
      organizationId: pool.organizationId,
      userId: pool.userId,
      status: "ONGOING",
      from: W.from,
      to: W.to,
      slices: [
        {
          assetId: pool.assetId,
          quantity: 5,
          checkedOutQuantity: 5,
          sourceLocationId: locationA,
        },
        {
          assetId: pool.assetId,
          quantity: 5,
          checkedOutQuantity: 5,
          assetKitId,
        },
      ],
    });
    const logId = await insertLog(tx, {
      assetId: pool.assetId,
      userId: pool.userId,
      bookingId: booking.bookingId,
      quantity: 8,
    });
    return {
      ...pool,
      bookingId: booking.bookingId,
      standaloneId: nth(booking.sliceIds, 0),
      kitSliceId: nth(booking.sliceIds, 1),
      kitId,
      logId,
      locationA,
    };
  });

  await commitTx((tx) =>
    checkOutUnits(tx, {
      organizationId: seed.organizationId,
      bookingId: seed.bookingId,
      picks: [{ sliceId: seed.standaloneId, units: 5 }],
      window: W,
    })
  );
  return seed;
}

/** Ids of {@link seedReturnedSplitSlice}. */
type ReturnedSplit = SeededOrgWithPool & {
  bookingId: string;
  sliceId: string;
  logId: string;
};

/**
 * One slice planned 6 at Shelf A and 4 at Shelf B, all 10 checked out and
 * returned in one log: the log has one share on each row.
 *
 * @param created - Collects the workspace for cleanup.
 * @returns The ids.
 */
async function seedReturnedSplitSlice(
  created: SeededOrgWithPool[]
): Promise<ReturnedSplit> {
  const seed = await commitTx(async (tx) => {
    const pool = await seedOrgWithPool(tx, {
      total: 10,
      placements: [
        { name: "Shelf A", quantity: 6 },
        { name: "Shelf B", quantity: 4 },
      ],
    });
    created.push(pool);
    return { ...pool, ...(await reserveSlice(tx, pool, 10)) };
  });
  await commitTx((tx) =>
    checkOutUnits(tx, {
      organizationId: seed.organizationId,
      bookingId: seed.bookingId,
      picks: [{ sliceId: seed.sliceId, units: 10 }],
      window: W,
    })
  );
  const { logIds } = await commitTx((tx) =>
    checkInUnits(tx, {
      organizationId: seed.organizationId,
      bookingId: seed.bookingId,
      assetId: seed.assetId,
      userId: seed.userId,
      steps: [
        {
          disposition: {
            sliceId: seed.sliceId,
            assetId: seed.assetId,
            returned: 10,
          },
          logs: [{ sliceId: seed.sliceId, quantity: 10 }],
        },
      ],
    })
  );
  return { ...seed, logId: nth(logIds, 0) };
}

describe("booking sources scenarios", () => {
  it("Reserve 10 at A, dispatch 5, return 1: 9 protected at A, checks 7, 8 and 9 hold at COMMIT", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        return { ...pool, ...(await reserveSlice(tx, pool, 10)) };
      });
      const locationA = nth(seed.locationIds, 0);

      await commitTx((tx) =>
        checkOutUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          picks: [{ sliceId: seed.sliceId, units: 5 }],
          window: W,
        })
      );
      const { logIds } = await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: {
                sliceId: seed.sliceId,
                assetId: seed.assetId,
                returned: 1,
              },
              logs: [{ sliceId: seed.sliceId, quantity: 1 }],
            },
          ],
        })
      );

      const rows = await readRows(seed.sliceId);
      expect(shape(rows)).toEqual([["LOCATION", locationA, 10, 4, 1, 5]]);
      expect(await readShares(nth(logIds, 0))).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: rowOf(rows, "LOCATION", locationA).id,
          quantity: 1,
          origin: "RECORDED",
        },
      ]);
      expect(await readSlice(seed.sliceId)).toMatchObject({
        sourceAllocation: "AUTO",
        checkedOutQuantity: 5,
      });

      // 4 out + 5 pending = 9 stay protected: 1 unit is free to anyone else.
      const free = await computeFreeBySource(getTestDb(), {
        organizationId: seed.organizationId,
        assetId: seed.assetId,
        window: W,
      });
      expect(free.find((s) => s.locationId === locationA)?.free).toBe(1);

      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });

      // A workspace with source rows, logs and shares is removed in full:
      // every cascade and deferred trigger lets the delete through.
      expect(await cleanupPools(created.splice(0))).toEqual([]);
      const left = await getTestDb().$queryRaw<Array<{ count: number }>>`
        SELECT (
          (SELECT COUNT(*) FROM "Organization" WHERE "id" = ${seed.organizationId})
          + (SELECT COUNT(*) FROM "User" WHERE "id" = ${seed.userId})
          + (SELECT COUNT(*) FROM "BookingAssetSource" WHERE "bookingAssetId" = ${seed.sliceId})
        )::int AS count
      `;
      expect(left).toEqual([{ count: 0 }]);
    } finally {
      await cleanupPools(created);
    }
  });

  it("One untagged 8-unit return over a standalone and a kit slice with 5 out each: one log, two RECORDED shares, checks 7, 8 and 9 hold", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, { total: 20, placements: [] });
        created.push(pool);
        const { assetKitId } = await seedKit(tx, pool, 5);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [
            { assetId: pool.assetId, quantity: 5 },
            { assetId: pool.assetId, quantity: 5, assetKitId },
          ],
        });
        await allocateNewSlices(tx, {
          organizationId: pool.organizationId,
          bookingId: booking.bookingId,
          sliceIds: booking.sliceIds,
          window: W,
          holdsNow: true,
          adoptionEnabled: true,
        });
        return {
          ...pool,
          bookingId: booking.bookingId,
          standaloneId: nth(booking.sliceIds, 0),
          kitSliceId: nth(booking.sliceIds, 1),
        };
      });

      await commitTx((tx) =>
        checkOutUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          picks: [
            { sliceId: seed.standaloneId, units: 5 },
            { sliceId: seed.kitSliceId, units: 5 },
          ],
          window: W,
        })
      );
      const { settled, logIds } = await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: { assetId: seed.assetId, returned: 8 },
              logs: [{ quantity: 8 }],
            },
          ],
        })
      );
      // The units span two slices, so the log names none.
      expect(settled[0]?.bookingAssetId).toBeNull();

      const standaloneRows = await readRows(seed.standaloneId);
      const kitRows = await readRows(seed.kitSliceId);
      // Most out first, then standalone first: 5 standalone, 3 kit.
      expect(shape(standaloneRows)).toEqual([["UNPLACED", null, 5, 0, 5, 5]]);
      expect(shape(kitRows)).toEqual([["KIT", null, 5, 2, 3, 5]]);
      expect(await readShares(nth(logIds, 0))).toEqual([
        {
          bookingAssetId: seed.standaloneId,
          bookingAssetSourceId: rowOf(standaloneRows, "UNPLACED").id,
          quantity: 5,
          origin: "RECORDED",
        },
        {
          bookingAssetId: seed.kitSliceId,
          bookingAssetSourceId: rowOf(kitRows, "KIT").id,
          quantity: 3,
          origin: "RECORDED",
        },
      ]);

      await assertContractHolds({
        sliceIds: [seed.standaloneId, seed.kitSliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("A ledger CONSUME split over two places: each CONSUME log is fully shared on the row its units left from", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [
            { name: "Shelf A", quantity: 6 },
            { name: "Shelf B", quantity: 4 },
          ],
        });
        created.push(pool);
        return { ...pool, ...(await reserveSlice(tx, pool, 10)) };
      });
      const [locationA, locationB] = [
        nth(seed.locationIds, 0),
        nth(seed.locationIds, 1),
      ];
      // Nothing fits whole, so the split takes the most free first.
      const planned = await readRows(seed.sliceId);
      expect(rowOf(planned, "LOCATION", locationA).quantity).toBe(6);
      expect(rowOf(planned, "LOCATION", locationB).quantity).toBe(4);

      await commitTx((tx) =>
        checkOutUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          picks: [{ sliceId: seed.sliceId, units: 10 }],
          window: W,
        })
      );
      // One consume event of 8: most out first takes 6 at A, then 2 at B.
      // The ledger writes one CONSUME row per place, A's first.
      const { logIds } = await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: {
                sliceId: seed.sliceId,
                assetId: seed.assetId,
                consumed: 8,
              },
              logs: [
                {
                  category: "CONSUME",
                  sliceId: seed.sliceId,
                  locationId: locationA,
                  quantity: 6,
                  createdAt: new Date("2030-03-01T12:00:00Z"),
                },
                {
                  category: "CONSUME",
                  sliceId: seed.sliceId,
                  locationId: locationB,
                  quantity: 2,
                  createdAt: new Date("2030-03-01T12:00:01Z"),
                },
              ],
            },
          ],
        })
      );

      const rows = await readRows(seed.sliceId);
      const rowA = rowOf(rows, "LOCATION", locationA);
      const rowB = rowOf(rows, "LOCATION", locationB);
      expect(countersOf(rowA)).toEqual([6, 0, 6, 6]);
      expect(countersOf(rowB)).toEqual([4, 2, 2, 4]);
      expect(await readShares(nth(logIds, 0))).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: rowA.id,
          quantity: 6,
          origin: "RECORDED",
        },
      ]);
      expect(await readShares(nth(logIds, 1))).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: rowB.id,
          quantity: 2,
          origin: "RECORDED",
        },
      ]);

      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Planned 5, dispatched and returned twice, increase to 10: 5 protected, admitted against others", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        // X: LEGACY, Q 5, D 10 from Shelf A, both rounds returned.
        const x = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: W.from,
          to: W.to,
          slices: [
            {
              assetId: pool.assetId,
              quantity: 5,
              checkedOutQuantity: 10,
              sourceLocationId: locationA,
            },
          ],
        });
        const sliceId = nth(x.sliceIds, 0);
        const logIds: string[] = [];
        for (const hour of [10, 11]) {
          logIds.push(
            await insertLog(tx, {
              assetId: pool.assetId,
              userId: pool.userId,
              bookingId: x.bookingId,
              sliceId,
              quantity: 5,
              createdAt: new Date(`2030-03-01T${hour}:00:00Z`),
            })
          );
        }
        // Y holds 5 of Shelf A's 10 over the same window.
        await reserveSlice(tx, pool, 5);
        return { ...pool, locationA, bookingId: x.bookingId, sliceId, logIds };
      });

      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await resizeSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          changes: [{ sliceId: seed.sliceId, quantity: 10 }],
          window: W,
          adoptionEnabled: true,
        });
        await tx.bookingAsset.update({
          where: { id: seed.sliceId },
          data: { quantity: 10 },
        });
      });

      const rows = await readRows(seed.sliceId);
      // Recorded source A carries the history: q 5 released 5 seeded, then
      // the 5 added units are pending at A (the only source with room).
      expect(shape(rows)).toEqual([["LOCATION", seed.locationA, 10, 0, 5, 10]]);
      for (const logId of seed.logIds) {
        expect(await readShares(logId)).toEqual([
          {
            bookingAssetId: seed.sliceId,
            bookingAssetSourceId: rowOf(rows, "LOCATION", seed.locationA).id,
            quantity: 5,
            origin: "SEEDED",
          },
        ]);
      }

      // Y's 5 and X's 5 fill Shelf A: one more unit is refused.
      const refused = commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await resizeSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          changes: [{ sliceId: seed.sliceId, quantity: 11 }],
          window: W,
          adoptionEnabled: true,
        });
      });
      await expect(refused).rejects.toMatchObject({ status: 400 });
      expect(shape(await readRows(seed.sliceId))).toEqual(shape(rows));

      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Legacy slice fully returned while the booking stays ONGOING, origin unknown, then resized: UNKNOWN carrier q 0, out 0, dispatchedTotal 10 + UNASSIGNED q 5, released 5; then 5 pending admitted; the carrier survives cleanup", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: W.from,
          to: W.to,
          slices: [
            { assetId: pool.assetId, quantity: 5, checkedOutQuantity: 10 },
          ],
        });
        const sliceId = nth(booking.sliceIds, 0);
        const logIds: string[] = [];
        for (const hour of [10, 11]) {
          logIds.push(
            await insertLog(tx, {
              assetId: pool.assetId,
              userId: pool.userId,
              bookingId: booking.bookingId,
              sliceId,
              quantity: 5,
              createdAt: new Date(`2030-03-01T${hour}:00:00Z`),
            })
          );
        }
        return { ...pool, bookingId: booking.bookingId, sliceId, logIds };
      });
      const locationA = nth(seed.locationIds, 0);

      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await resizeSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          changes: [{ sliceId: seed.sliceId, quantity: 10 }],
          window: W,
          adoptionEnabled: true,
        });
        await tx.bookingAsset.update({
          where: { id: seed.sliceId },
          data: { quantity: 10 },
        });
      });

      const rows = await readRows(seed.sliceId);
      expect(countersOf(rowOf(rows, "UNKNOWN"))).toEqual([0, 0, 0, 10]);
      expect(countersOf(rowOf(rows, "UNASSIGNED"))).toEqual([5, 0, 5, 0]);
      expect(countersOf(rowOf(rows, "LOCATION", locationA))).toEqual([
        5, 0, 0, 0,
      ]);
      expect(rows).toHaveLength(3);
      for (const logId of seed.logIds) {
        expect(await readShares(logId)).toEqual([
          {
            bookingAssetId: seed.sliceId,
            bookingAssetSourceId: rowOf(rows, "UNKNOWN").id,
            quantity: 5,
            origin: "SEEDED",
          },
        ]);
      }
      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Legacy ONGOING slice checked in first after activation: seeded, settled, never refused", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: W.from,
          to: W.to,
          slices: [
            {
              assetId: pool.assetId,
              quantity: 10,
              checkedOutQuantity: 10,
              sourceLocationId: nth(pool.locationIds, 0),
            },
          ],
        });
        return {
          ...pool,
          bookingId: booking.bookingId,
          sliceId: nth(booking.sliceIds, 0),
        };
      });
      const locationA = nth(seed.locationIds, 0);

      const { logIds } = await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: {
                sliceId: seed.sliceId,
                assetId: seed.assetId,
                returned: 4,
              },
              logs: [{ sliceId: seed.sliceId, quantity: 4 }],
            },
          ],
        })
      );

      const rows = await readRows(seed.sliceId);
      expect(shape(rows)).toEqual([["LOCATION", locationA, 10, 6, 4, 10]]);
      expect(await readSlice(seed.sliceId)).toMatchObject({
        sourceAllocation: "AUTO",
      });
      expect(await readShares(nth(logIds, 0))).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: rowOf(rows, "LOCATION", locationA).id,
          quantity: 4,
          origin: "RECORDED",
        },
      ]);
      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Future reservation whose units are out today but due back: admitted (no physical check)", async () => {
    const created: SeededOrgWithPool[] = [];
    const yWindow: TestWindow = {
      from: hoursFromNow(48),
      to: hoursFromNow(72),
    };
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        // X has all 10 of Shelf A out until tomorrow.
        const x = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: hoursFromNow(-1),
          to: hoursFromNow(24),
          slices: [
            { assetId: pool.assetId, quantity: 10, checkedOutQuantity: 10 },
          ],
        });
        const xSlice = nth(x.sliceIds, 0);
        await setSliceMode(tx, xSlice, "AUTO");
        await insertSource(tx, {
          organizationId: pool.organizationId,
          sliceId: xSlice,
          kind: "LOCATION",
          locationId: locationA,
          quantity: 10,
          outQuantity: 10,
          dispatchedTotal: 10,
        });
        const y = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: yWindow.from,
          to: yWindow.to,
          slices: [{ assetId: pool.assetId, quantity: 10 }],
        });
        return {
          ...pool,
          locationA,
          yBookingId: y.bookingId,
          ySlice: nth(y.sliceIds, 0),
        };
      });

      // Nothing is on hand at Shelf A right now.
      const physical = await loadPhysicalNow(getTestDb(), {
        organizationId: seed.organizationId,
        assetIds: [seed.assetId],
      });
      expect(
        physical
          .get(seed.assetId)
          ?.get(sourceKey({ kind: "LOCATION", locationId: seed.locationA }))
      ).toBe(0);

      await commitTx(async (tx) => {
        await lockBooking(tx, seed.yBookingId);
        await allocateNewSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.yBookingId,
          sliceIds: [seed.ySlice],
          window: yWindow,
          holdsNow: true,
          adoptionEnabled: true,
        });
      });

      expect(shape(await readRows(seed.ySlice))).toEqual([
        ["LOCATION", seed.locationA, 10, 0, 0, 0],
      ]);
      await assertContractHolds({
        sliceIds: [seed.ySlice],
        groups: [{ bookingId: seed.yBookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Capacity 10, two overlapping pending holds of 6: only the later booking short; loader and guard agree", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        const windows = {
          x: { from: hoursFromNow(1), to: hoursFromNow(48) },
          y: { from: hoursFromNow(2), to: hoursFromNow(48) },
        };
        const ids: Record<"x" | "y", { bookingId: string; sliceId: string }> = {
          x: { bookingId: "", sliceId: "" },
          y: { bookingId: "", sliceId: "" },
        };
        // Two MANUAL holds of 6 at Shelf A, as left after stock was lost.
        for (const key of ["x", "y"] as const) {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "RESERVED",
            from: windows[key].from,
            to: windows[key].to,
            slices: [{ assetId: pool.assetId, quantity: 6 }],
          });
          const sliceId = nth(booking.sliceIds, 0);
          await setSliceMode(tx, sliceId, "MANUAL");
          await insertSource(tx, {
            organizationId: pool.organizationId,
            sliceId,
            kind: "LOCATION",
            locationId: locationA,
            quantity: 6,
          });
          ids[key] = { bookingId: booking.bookingId, sliceId };
        }
        return { ...pool, locationA, windows, ids };
      });

      // Loader: the booking page summaries.
      const ySummary = (
        await getSliceSourceSummaries({
          organizationId: seed.organizationId,
          bookingId: seed.ids.y.bookingId,
        })
      ).get(seed.ids.y.sliceId);
      const xSummary = (
        await getSliceSourceSummaries({
          organizationId: seed.organizationId,
          bookingId: seed.ids.x.bookingId,
        })
      ).get(seed.ids.x.sliceId);
      expect(ySummary?.short).toBe(true);
      expect(ySummary?.parts).toEqual([
        expect.objectContaining({ locationId: seed.locationA, short: true }),
      ]);
      expect(xSummary?.short).toBe(false);

      // Guard: the check-out refuses the later booking and lets the earlier go.
      await expect(
        withRollback((tx) =>
          dispatchUnits(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.ids.y.bookingId,
            picks: [{ sliceId: seed.ids.y.sliceId, units: 6 }],
            window: seed.windows.y,
            adoptionEnabled: true,
          })
        )
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("short at Shelf A"),
      });
      const xDispatch = await withRollback((tx) =>
        dispatchUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.ids.x.bookingId,
          picks: [{ sliceId: seed.ids.x.sliceId, units: 6 }],
          window: seed.windows.x,
          adoptionEnabled: true,
        })
      );
      expect(xDispatch.dispatched).toEqual([
        expect.objectContaining({
          sliceId: seed.ids.x.sliceId,
          sources: [
            expect.objectContaining({
              locationId: seed.locationA,
              quantity: 6,
            }),
          ],
        }),
      ]);
    } finally {
      await cleanupPools(created);
    }
  });

  it("Standalone + kit slice, 5 out each, ONE untagged 8-unit RETURN log; convert the group, dispatch 5 more on the standalone: two SEEDED shares (5 standalone, 3 kit); kit still shows 2 out; per-slice totals equal the greedy fill's", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedConvertedStandaloneAndKit(created);

      const standaloneRows = await readRows(seed.standaloneId);
      const kitRows = await readRows(seed.kitSliceId);
      // The standalone re-claimed its 5 released units at its recorded source.
      expect(shape(standaloneRows)).toEqual([
        ["LOCATION", seed.locationA, 5, 5, 0, 10],
      ]);
      expect(shape(kitRows)).toEqual([["KIT", null, 5, 2, 3, 5]]);
      expect(await readShares(seed.logId)).toEqual([
        {
          bookingAssetId: seed.standaloneId,
          bookingAssetSourceId: rowOf(
            standaloneRows,
            "LOCATION",
            seed.locationA
          ).id,
          quantity: 5,
          origin: "SEEDED",
        },
        {
          bookingAssetId: seed.kitSliceId,
          bookingAssetSourceId: rowOf(kitRows, "KIT").id,
          quantity: 3,
          origin: "SEEDED",
        },
      ]);
      expect(await readSlice(seed.standaloneId)).toMatchObject({
        sourceAllocation: "AUTO",
        checkedOutQuantity: 10,
      });
      expect(await readSlice(seed.kitSliceId)).toMatchObject({
        sourceAllocation: "KIT",
      });
      await assertContractHolds({
        sliceIds: [seed.standaloneId, seed.kitSliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Remove the kit slice after it recorded returns, standalone converted: its shares orphaned, logs still fully shared, standalone numbers unchanged, all checks pass", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedConvertedStandaloneAndKit(created);
      const before = shape(await readRows(seed.standaloneId));

      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await tx.bookingAsset.delete({ where: { id: seed.kitSliceId } });
      });

      expect(await readSlice(seed.kitSliceId)).toBeNull();
      const standaloneRows = await readRows(seed.standaloneId);
      expect(shape(standaloneRows)).toEqual(before);
      expect(await readShares(seed.logId)).toEqual([
        {
          bookingAssetId: seed.standaloneId,
          bookingAssetSourceId: rowOf(
            standaloneRows,
            "LOCATION",
            seed.locationA
          ).id,
          quantity: 5,
          origin: "SEEDED",
        },
        {
          bookingAssetId: null,
          bookingAssetSourceId: null,
          quantity: 3,
          origin: "SEEDED",
        },
      ]);
      await assertContractHolds({
        sliceIds: [seed.standaloneId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Remove the kit through the removeAssets service, standalone converted: only the kit slice goes, its shares orphaned, standalone numbers unchanged, all checks pass", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedConvertedStandaloneAndKit(created);
      const before = shape(await readRows(seed.standaloneId));

      // The booking page's kit removal: the kit named, no standalone row
      // ticked, so the asset's standalone slice must stay.
      await removeAssets({
        booking: { id: seed.bookingId, assetIds: [seed.assetId] },
        firstName: "Db",
        lastName: "Test",
        displayName: null,
        userId: seed.userId,
        kitIds: [seed.kitId],
        kits: [{ id: seed.kitId, name: "Kit" }],
        standaloneAssetIds: [],
        organizationId: seed.organizationId,
      });

      expect(await readSlice(seed.kitSliceId)).toBeNull();
      expect(await readSlice(seed.standaloneId)).toMatchObject({
        sourceAllocation: "AUTO",
        checkedOutQuantity: 10,
      });
      const standaloneRows = await readRows(seed.standaloneId);
      expect(shape(standaloneRows)).toEqual(before);
      expect(await readShares(seed.logId)).toEqual([
        {
          bookingAssetId: seed.standaloneId,
          bookingAssetSourceId: rowOf(
            standaloneRows,
            "LOCATION",
            seed.locationA
          ).id,
          quantity: 5,
          origin: "SEEDED",
        },
        {
          bookingAssetId: null,
          bookingAssetSourceId: null,
          quantity: 3,
          origin: "SEEDED",
        },
      ]);
      await assertContractHolds({
        sliceIds: [seed.standaloneId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("One return log with shares from rows A and B of one slice; delete the slice row directly: both shares orphaned with identical tuples, delete succeeds, log fully shared and kept as stock history", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedReturnedSplitSlice(created);
      expect(await readShares(seed.logId)).toHaveLength(2);

      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await tx.bookingAsset.delete({ where: { id: seed.sliceId } });
      });

      expect(await readRows(seed.sliceId)).toEqual([]);
      expect(await readShares(seed.logId)).toEqual([
        {
          bookingAssetId: null,
          bookingAssetSourceId: null,
          quantity: 6,
          origin: "RECORDED",
        },
        {
          bookingAssetId: null,
          bookingAssetSourceId: null,
          quantity: 4,
          origin: "RECORDED",
        },
      ]);
      expect(
        await getTestDb().consumptionLog.findUnique({
          where: { id: seed.logId },
          select: { quantity: true, bookingId: true, bookingAssetId: true },
        })
      ).toEqual({
        quantity: 10,
        bookingId: seed.bookingId,
        bookingAssetId: null,
      });
      await assertContractHolds({
        sliceIds: [],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Convert, return units, remove every slice, re-add the asset with the flag off: group still converted via orphaned shares; new slice AUTO with its full demand; old shares stay orphaned", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedReturnedSplitSlice(created);
      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await tx.bookingAsset.delete({ where: { id: seed.sliceId } });
      });

      const newSliceId = await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        const sliceId = await addSlice(tx, {
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          quantity: 3,
        });
        await allocateNewSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          sliceIds: [sliceId],
          window: W,
          holdsNow: true,
          adoptionEnabled: false,
        });
        return sliceId;
      });

      expect(await readSlice(newSliceId)).toMatchObject({
        sourceAllocation: "AUTO",
        quantity: 3,
      });
      const rows = await readRows(newSliceId);
      expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(3);
      expect(looseTotals(rows)).toEqual({ out: 0, pending: 3 });
      expect(
        (await readShares(seed.logId)).every(
          (s) => s.bookingAssetId === null && s.bookingAssetSourceId === null
        )
      ).toBe(true);
      await assertContractHolds({
        sliceIds: [newSliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Remove every slice of a converted group with zero dispositions, re-add with the flag off: treated as a new group (no shares, no history); new slice gets its full demand", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        return { ...pool, ...(await reserveSlice(tx, pool, 4)) };
      });
      expect(await readSlice(seed.sliceId)).toMatchObject({
        sourceAllocation: "AUTO",
      });
      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await tx.bookingAsset.delete({ where: { id: seed.sliceId } });
      });

      const newSliceId = await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        const sliceId = await addSlice(tx, {
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          quantity: 4,
        });
        await allocateNewSlices(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          sliceIds: [sliceId],
          window: W,
          holdsNow: true,
          adoptionEnabled: false,
        });
        return sliceId;
      });

      expect(await readSlice(newSliceId)).toMatchObject({
        sourceAllocation: "LEGACY",
        quantity: 4,
      });
      expect(await readRows(newSliceId)).toEqual([]);
      expect(
        await getTestDb().bookingDispositionShare.count({
          where: { bookingId: seed.bookingId },
        })
      ).toBe(0);
    } finally {
      await cleanupPools(created);
    }
  });

  it("Bulk delete A and B, both with history, UNKNOWN and Unplaced rows exist: out units planned once on the aggregate, history on one UNKNOWN row, shares repointed, counters summed once (two shares of one log land on one UNKNOWN row)", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 30,
          placements: [
            { name: "Shelf A", quantity: 10 },
            { name: "Shelf B", quantity: 10 },
          ],
        });
        created.push(pool);
        const [locationA, locationB] = [
          nth(pool.locationIds, 0),
          nth(pool.locationIds, 1),
        ];
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: hoursFromNow(-1),
          to: hoursFromNow(24),
          slices: [
            { assetId: pool.assetId, quantity: 20, checkedOutQuantity: 20 },
          ],
        });
        const sliceId = nth(booking.sliceIds, 0);
        await setSliceMode(tx, sliceId, "AUTO");
        const base = { organizationId: pool.organizationId, sliceId };
        const rowA = await insertSource(tx, {
          ...base,
          kind: "LOCATION",
          locationId: locationA,
          quantity: 6,
          outQuantity: 2,
          releasedQuantity: 4,
          dispatchedTotal: 6,
        });
        const rowB = await insertSource(tx, {
          ...base,
          kind: "LOCATION",
          locationId: locationB,
          quantity: 6,
          outQuantity: 3,
          releasedQuantity: 3,
          dispatchedTotal: 6,
        });
        await insertSource(tx, {
          ...base,
          kind: "UNKNOWN",
          quantity: 2,
          outQuantity: 2,
          dispatchedTotal: 2,
        });
        await insertSource(tx, {
          ...base,
          kind: "UNPLACED",
          quantity: 6,
          outQuantity: 6,
          dispatchedTotal: 6,
        });
        // One return of 7: 4 came back to A's row and 3 to B's.
        const logId = await insertLog(tx, {
          assetId: pool.assetId,
          userId: pool.userId,
          bookingId: booking.bookingId,
          sliceId,
          quantity: 7,
        });
        const share = {
          organizationId: pool.organizationId,
          logId,
          bookingId: booking.bookingId,
          assetId: pool.assetId,
          sliceId,
        };
        await insertShare(tx, { ...share, sourceId: rowA, quantity: 4 });
        await insertShare(tx, { ...share, sourceId: rowB, quantity: 3 });
        return {
          ...pool,
          locationA,
          locationB,
          bookingId: booking.bookingId,
          sliceId,
          logId,
        };
      });

      await commitTx(async (tx) => {
        const locationIds = [seed.locationA, seed.locationB];
        await evacuateLocationsForDelete(tx, {
          organizationId: seed.organizationId,
          locationIds,
        });
        await tx.location.deleteMany({
          where: {
            id: { in: locationIds },
            organizationId: seed.organizationId,
          },
        });
      });

      const rows = await readRows(seed.sliceId);
      // Out 2 + 3 join the unplaced units, which physically cover them.
      expect(shape(rows)).toEqual([
        ["UNASSIGNED", null, 7, 0, 7, 0],
        ["UNKNOWN", null, 2, 2, 0, 9],
        ["UNPLACED", null, 11, 11, 0, 11],
      ]);
      const unknownId = rowOf(rows, "UNKNOWN").id;
      expect(await readShares(seed.logId)).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: unknownId,
          quantity: 4,
          origin: "RECORDED",
        },
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: unknownId,
          quantity: 3,
          origin: "RECORDED",
        },
      ]);
      expect(
        await getTestDb().location.count({
          where: { id: { in: [seed.locationA, seed.locationB] } },
        })
      ).toBe(0);
      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Delete A where a row has quantity 10, out 4, released 3: out to the planner, 3 pending re-allocated (AUTO) or UNASSIGNED (MANUAL), 3 released to UNASSIGNED, history to UNKNOWN, row gone, location deleted", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 30,
          placements: [
            { name: "Shelf A", quantity: 20 },
            { name: "Shelf B", quantity: 10 },
          ],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        const slices: Record<
          "AUTO" | "MANUAL",
          { sliceId: string; logId: string; bookingId: string }
        > = {
          AUTO: { sliceId: "", logId: "", bookingId: "" },
          MANUAL: { sliceId: "", logId: "", bookingId: "" },
        };
        for (const mode of ["AUTO", "MANUAL"] as const) {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "ONGOING",
            from: hoursFromNow(-1),
            to: hoursFromNow(24),
            slices: [
              { assetId: pool.assetId, quantity: 10, checkedOutQuantity: 7 },
            ],
          });
          const sliceId = nth(booking.sliceIds, 0);
          await setSliceMode(tx, sliceId, mode);
          const rowId = await insertSource(tx, {
            organizationId: pool.organizationId,
            sliceId,
            kind: "LOCATION",
            locationId: locationA,
            quantity: 10,
            outQuantity: 4,
            releasedQuantity: 3,
            dispatchedTotal: 7,
          });
          const logId = await insertLog(tx, {
            assetId: pool.assetId,
            userId: pool.userId,
            bookingId: booking.bookingId,
            sliceId,
            quantity: 3,
          });
          await insertShare(tx, {
            organizationId: pool.organizationId,
            logId,
            bookingId: booking.bookingId,
            assetId: pool.assetId,
            sliceId,
            sourceId: rowId,
            quantity: 3,
          });
          slices[mode] = { sliceId, logId, bookingId: booking.bookingId };
        }
        return { ...pool, locationA, slices };
      });

      await commitTx(async (tx) => {
        await evacuateLocationsForDelete(tx, {
          organizationId: seed.organizationId,
          locationIds: [seed.locationA],
        });
        await tx.location.delete({
          where: { id: seed.locationA, organizationId: seed.organizationId },
        });
      });

      for (const mode of ["AUTO", "MANUAL"] as const) {
        const { sliceId, logId } = seed.slices[mode];
        const rows = await readRows(sliceId);
        expect(rows.some((r) => r.locationId === seed.locationA)).toBe(false);
        const unknown = rowOf(rows, "UNKNOWN");
        expect(countersOf(unknown)).toEqual([0, 0, 0, 3]);
        expect(await readShares(logId)).toEqual([
          {
            bookingAssetId: sliceId,
            bookingAssetSourceId: unknown.id,
            quantity: 3,
            origin: "RECORDED",
          },
        ]);
        const unassigned = rowOf(rows, "UNASSIGNED");
        expect(unassigned.releasedQuantity).toBe(3);
        if (mode === "AUTO") {
          expect(countersOf(unassigned)).toEqual([3, 0, 3, 0]);
          expect(looseTotals(rows)).toEqual({ out: 4, pending: 3 });
        } else {
          // The system never chooses for a manual split.
          expect(countersOf(unassigned)).toEqual([6, 0, 3, 0]);
          expect(looseTotals(rows)).toEqual({ out: 4, pending: 0 });
        }
      }
      expect(
        await getTestDb().location.count({ where: { id: seed.locationA } })
      ).toBe(0);
      await assertContractHolds({
        sliceIds: [seed.slices.AUTO.sliceId, seed.slices.MANUAL.sliceId],
        groups: [
          { bookingId: seed.slices.AUTO.bookingId, assetId: seed.assetId },
          { bookingId: seed.slices.MANUAL.bookingId, assetId: seed.assetId },
        ],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  describe("Settle units from UNKNOWN, then re-dispatch them", () => {
    /**
     * An ONGOING slice of 5 whose units are out from UNKNOWN, optionally with
     * another booking holding all of Shelf A over the same window, then a
     * check-in of all 5.
     */
    async function seedSettledFromUnknown(
      created: SeededOrgWithPool[],
      shelfAFullyHeld: boolean
    ) {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: W.from,
          to: W.to,
          slices: [
            { assetId: pool.assetId, quantity: 5, checkedOutQuantity: 5 },
          ],
        });
        const sliceId = nth(booking.sliceIds, 0);
        await setSliceMode(tx, sliceId, "AUTO");
        await insertSource(tx, {
          organizationId: pool.organizationId,
          sliceId,
          kind: "UNKNOWN",
          quantity: 5,
          outQuantity: 5,
          dispatchedTotal: 5,
        });
        if (shelfAFullyHeld) {
          const other = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "RESERVED",
            from: W.from,
            to: W.to,
            slices: [{ assetId: pool.assetId, quantity: 10 }],
          });
          const otherSlice = nth(other.sliceIds, 0);
          await setSliceMode(tx, otherSlice, "MANUAL");
          await insertSource(tx, {
            organizationId: pool.organizationId,
            sliceId: otherSlice,
            kind: "LOCATION",
            locationId: locationA,
            quantity: 10,
          });
        }
        return { ...pool, locationA, bookingId: booking.bookingId, sliceId };
      });
      const { logIds } = await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: {
                sliceId: seed.sliceId,
                assetId: seed.assetId,
                returned: 5,
              },
              logs: [{ sliceId: seed.sliceId, quantity: 5 }],
            },
          ],
        })
      );
      return { ...seed, logId: nth(logIds, 0) };
    }

    it("UNKNOWN updated; released moved to UNASSIGNED; re-dispatch takes a known source, admitted", async () => {
      const created: SeededOrgWithPool[] = [];
      try {
        const seed = await seedSettledFromUnknown(created, false);
        const settledRows = await readRows(seed.sliceId);
        expect(shape(settledRows)).toEqual([
          ["UNASSIGNED", null, 5, 0, 5, 0],
          ["UNKNOWN", null, 0, 0, 0, 5],
        ]);
        expect(await readShares(seed.logId)).toEqual([
          {
            bookingAssetId: seed.sliceId,
            bookingAssetSourceId: rowOf(settledRows, "UNKNOWN").id,
            quantity: 5,
            origin: "RECORDED",
          },
        ]);

        const result = await commitTx((tx) =>
          checkOutUnits(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.bookingId,
            picks: [{ sliceId: seed.sliceId, units: 5 }],
            window: W,
          })
        );
        expect(result.dispatched[0]?.sources).toEqual([
          expect.objectContaining({ locationId: seed.locationA, quantity: 5 }),
        ]);
        const rows = await readRows(seed.sliceId);
        expect(countersOf(rowOf(rows, "LOCATION", seed.locationA))).toEqual([
          5, 5, 0, 5,
        ]);
        expect(countersOf(rowOf(rows, "UNKNOWN"))).toEqual([0, 0, 0, 5]);
        expect(
          rows
            .filter((r) => r.kind === "UNASSIGNED")
            .every((r) => countersOf(r).every((n) => n === 0))
        ).toBe(true);
        await assertContractHolds({
          sliceIds: [seed.sliceId],
          groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
        });
      } finally {
        await cleanupPools(created);
      }
    });

    it("re-dispatch is refused when no known source has room", async () => {
      const created: SeededOrgWithPool[] = [];
      try {
        const seed = await seedSettledFromUnknown(created, true);
        const before = shape(await readRows(seed.sliceId));
        await expect(
          commitTx((tx) =>
            checkOutUnits(tx, {
              organizationId: seed.organizationId,
              bookingId: seed.bookingId,
              picks: [{ sliceId: seed.sliceId, units: 5 }],
              window: W,
            })
          )
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining("Not enough units"),
        });
        expect(shape(await readRows(seed.sliceId))).toEqual(before);
      } finally {
        await cleanupPools(created);
      }
    });
  });

  it("Bulk delete converted bookings with heavy history: bookingId CASCADE and bookingAssetId SET NULL reach the same shares in one statement, collectors skip NULL keys, checks exit on deleted parents", async () => {
    const LOGS = 150;
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, { total: 1000, placements: [] });
        created.push(pool);
        const bookingIds: string[] = [];
        for (let b = 0; b < 2; b++) {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "ONGOING",
            from: W.from,
            to: W.to,
            slices: [
              {
                assetId: pool.assetId,
                quantity: LOGS,
                checkedOutQuantity: LOGS,
              },
            ],
          });
          const sliceId = nth(booking.sliceIds, 0);
          await setSliceMode(tx, sliceId, "AUTO");
          const sourceId = await insertSource(tx, {
            organizationId: pool.organizationId,
            sliceId,
            kind: "UNPLACED",
            quantity: LOGS,
            releasedQuantity: LOGS,
            dispatchedTotal: LOGS,
          });
          // Each RETURN log of 2: one unit on the row, one orphaned.
          const logIds = Array.from(
            { length: LOGS },
            (_, i) => `${sliceId}-log-${i}`
          );
          await tx.consumptionLog.createMany({
            data: logIds.map((id) => ({
              id,
              assetId: pool.assetId,
              category: "RETURN" as const,
              quantity: 2,
              userId: pool.userId,
              bookingId: booking.bookingId,
              bookingAssetId: sliceId,
            })),
          });
          await tx.bookingDispositionShare.createMany({
            data: logIds.flatMap((logId) => [
              {
                organizationId: pool.organizationId,
                consumptionLogId: logId,
                bookingId: booking.bookingId,
                assetId: pool.assetId,
                bookingAssetId: sliceId,
                bookingAssetSourceId: sourceId,
                quantity: 1,
                origin: "SEEDED" as const,
              },
              {
                organizationId: pool.organizationId,
                consumptionLogId: logId,
                bookingId: booking.bookingId,
                assetId: pool.assetId,
                bookingAssetId: null,
                bookingAssetSourceId: null,
                quantity: 1,
                origin: "OVERFLOW" as const,
              },
            ]),
          });
          bookingIds.push(booking.bookingId);
        }
        return { ...pool, bookingIds };
      });

      const started = performance.now();
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          DELETE FROM "Booking" WHERE "id" IN (${Prisma.join(seed.bookingIds)})
        `;
      });
      const elapsed = Math.round(performance.now() - started);
      // Recorded for the performance write-up; no hard budget on shared CI.
      // eslint-disable-next-line no-console
      console.info(
        `[booking sources] bulk delete of 2 converted bookings with ${
          LOGS * 4
        } shares: ${elapsed} ms`
      );
      expect(result).toEqual({ ok: true });

      const db = getTestDb();
      expect(
        await db.bookingDispositionShare.count({
          where: { bookingId: { in: seed.bookingIds } },
        })
      ).toBe(0);
      expect(
        await db.bookingAssetSource.count({
          where: { organizationId: seed.organizationId },
        })
      ).toBe(0);
      expect(
        await db.consumptionLog.count({
          where: { assetId: seed.assetId, bookingId: null },
        })
      ).toBe(LOGS * 2);
    } finally {
      await cleanupPools(created);
    }
  });

  it("A pool with no manual placements: every slice is allocated silently to Unplaced, dispatched and settled there, with no other kind of row", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, { total: 10, placements: [] });
        created.push(pool);
        return { ...pool, ...(await reserveSlice(tx, pool, 4)) };
      });
      expect(shape(await readRows(seed.sliceId))).toEqual([
        ["UNPLACED", null, 4, 0, 0, 0],
      ]);
      const summary = (
        await getSliceSourceSummaries({
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
        })
      ).get(seed.sliceId);
      expect(summary).toMatchObject({ short: false, mode: "AUTO" });
      expect(summary?.parts).toEqual([
        expect.objectContaining({ kind: "UNPLACED", planned: 4, out: 0 }),
      ]);

      const dispatch = await commitTx((tx) =>
        checkOutUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          picks: [{ sliceId: seed.sliceId, units: 4 }],
          window: W,
        })
      );
      expect(dispatch.dispatched).toEqual([
        {
          sliceId: seed.sliceId,
          assetId: seed.assetId,
          sources: [
            {
              kind: "UNPLACED",
              locationId: null,
              name: "Unplaced",
              quantity: 4,
            },
          ],
        },
      ]);
      await commitTx((tx) =>
        checkInUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          assetId: seed.assetId,
          userId: seed.userId,
          steps: [
            {
              disposition: {
                sliceId: seed.sliceId,
                assetId: seed.assetId,
                returned: 4,
              },
              logs: [{ sliceId: seed.sliceId, quantity: 4 }],
            },
          ],
        })
      );
      expect(shape(await readRows(seed.sliceId))).toEqual([
        ["UNPLACED", null, 4, 0, 4, 4],
      ]);
    } finally {
      await cleanupPools(created);
    }
  });

  it("Extend an AUTO slice pending 5 at A, A full in the added time, B full before the old end: refused, the units stay at A, never moved to B", async () => {
    const created: SeededOrgWithPool[] = [];
    const xFrom = hoursFromNow(1);
    const xTo = hoursFromNow(24);
    const newTo = hoursFromNow(30);
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [
            { name: "Shelf A", quantity: 5 },
            { name: "Shelf B", quantity: 5 },
          ],
        });
        created.push(pool);
        const locationA = nth(pool.locationIds, 0);
        const locationB = nth(pool.locationIds, 1);

        /** A RESERVED booking with one slice of 5 pending at one location. */
        const holdAt = async (
          window: TestWindow,
          mode: "AUTO" | "MANUAL",
          locationId: string
        ) => {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "RESERVED",
            from: window.from,
            to: window.to,
            slices: [{ assetId: pool.assetId, quantity: 5 }],
          });
          const sliceId = nth(booking.sliceIds, 0);
          await setSliceMode(tx, sliceId, mode);
          await insertSource(tx, {
            organizationId: pool.organizationId,
            sliceId,
            kind: "LOCATION",
            locationId,
            quantity: 5,
          });
          return { bookingId: booking.bookingId, sliceId };
        };

        const x = await holdAt({ from: xFrom, to: xTo }, "AUTO", locationA);
        // Shelf B is full until X's old end, free in the added time.
        await holdAt({ from: hoursFromNow(2), to: xTo }, "MANUAL", locationB);
        // Shelf A is full in the added time.
        await holdAt({ from: xTo, to: newTo }, "MANUAL", locationA);
        return { ...pool, locationA, x };
      });

      await expect(
        withRollback(async (tx) => {
          await lockBooking(tx, seed.x.bookingId);
          await admitWindowChange(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.x.bookingId,
            from: xFrom,
            to: newTo,
            previous: { from: xFrom, to: xTo },
            kind: "extend",
            adoptionEnabled: true,
          });
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("Shelf A"),
      });

      expect(shape(await readRows(seed.x.sliceId))).toEqual([
        ["LOCATION", seed.locationA, 5, 0, 0, 0],
      ]);
    } finally {
      await cleanupPools(created);
    }
  });
});

describe("booking sources probe plans", () => {
  /**
   * EXPLAINs a statement with sequential scans disabled, so the planner
   * picks an index whenever one can serve the statement, and prints the plan.
   *
   * @param tx - Transaction client (the setting is local to it).
   * @param label - Name printed with the plan.
   * @param query - The statement to explain.
   * @returns The plan text.
   */
  async function explain(
    tx: TxClient,
    label: string,
    query: Prisma.Sql
  ): Promise<string> {
    await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
    const rows = await tx.$queryRaw<Array<{ "QUERY PLAN": string }>>(
      Prisma.sql`EXPLAIN ${query}`
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    // eslint-disable-next-line no-console
    console.info(`[booking sources] plan of ${label}:\n${plan}`);
    return plan;
  }

  it("the LEGACY fast-path probe (bookingHasConvertedGroup) is served by indexes on BookingAsset and BookingDispositionShare", async () => {
    const plan = await withRollback(async (tx) => {
      const pool = await seedOrgWithPool(tx, { total: 20, placements: [] });
      const { assetKitId } = await seedKit(tx, pool, 5);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "RESERVED",
        from: W.from,
        to: W.to,
        slices: [
          { assetId: pool.assetId, quantity: 2 },
          { assetId: pool.assetId, quantity: 5, assetKitId },
        ],
      });
      const { bookingId } = booking;
      const { organizationId } = pool;
      // The statement `bookingHasConvertedGroup` sends, verbatim.
      return explain(
        tx,
        "bookingHasConvertedGroup",
        Prisma.sql`
          SELECT (
            EXISTS (
              SELECT 1 FROM "BookingAsset" ba
              JOIN "Booking" b ON b.id = ba."bookingId"
              WHERE ba."bookingId" = ${bookingId}
                AND ba."assetKitId" IS NULL
                AND b."organizationId" = ${organizationId}
                AND ba."sourceAllocation" <> 'LEGACY'
            )
            OR EXISTS (
              SELECT 1 FROM "BookingAsset" ba
              JOIN "Booking" b ON b.id = ba."bookingId"
              WHERE ba."bookingId" = ${bookingId}
                AND ba."assetKitId" IS NOT NULL
                AND b."organizationId" = ${organizationId}
                AND ba."sourceAllocation" <> 'LEGACY'
            )
            OR EXISTS (
              SELECT 1 FROM "BookingDispositionShare" sh
              WHERE sh."bookingId" = ${bookingId}
                AND sh."organizationId" = ${organizationId}
            )
          ) AS "converted"`
      );
    });
    expect(plan).not.toMatch(/Seq Scan on "BookingAsset"/);
    expect(plan).not.toMatch(/Seq Scan on "BookingDispositionShare"/);
    expect(plan).toMatch(/BookingAsset_manual_unique/);
    expect(plan).toMatch(/BookingAsset_kit_unique/);
  });

  it("the placement-path BookingAsset probe (loadBookingOutRows) is served by the assetId index and the Booking key", async () => {
    const plan = await withRollback(async (tx) => {
      const pool = await seedOrgWithPool(tx, {
        total: 10,
        placements: [{ name: "Shelf A", quantity: 10 }],
      });
      await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: W.from,
        to: W.to,
        slices: [{ assetId: pool.assetId, quantity: 2 }],
      });
      // The shape of the Prisma query `loadBookingOutRows` sends first.
      return explain(
        tx,
        "loadBookingOutRows slice probe",
        Prisma.sql`
          SELECT ba.id, ba."assetId", ba."checkedOutAt", ba."sourceAllocation"
          FROM "BookingAsset" ba
          JOIN "Booking" b ON b.id = ba."bookingId"
          WHERE ba."assetId" IN (${Prisma.join([pool.assetId])})
            AND ba."sourceAllocation" IN ('AUTO', 'MANUAL')
            AND b."organizationId" = ${pool.organizationId}
            AND b.status IN ('ONGOING', 'OVERDUE')`
      );
    });
    expect(plan).not.toMatch(/Seq Scan on "BookingAsset"/);
    expect(plan).not.toMatch(/Seq Scan on "Booking"/);
  });
});
