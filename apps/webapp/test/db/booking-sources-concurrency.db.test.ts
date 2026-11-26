/**
 * Booking sources: concurrency against a real database
 *
 * Two real connections race through the real services, released together by
 * a barrier, each taking the locks its product path takes: booking writers
 * lock the booking row and then the assets (inside the facade), placement
 * changes, location deletes and kit edits take asset locks only. Every case
 * asserts who committed and the final invariants, through the deferred
 * contract checks run by hand on the committed state.
 *
 * The races covered: two reservations for the last units, check-out against
 * a placement rehome, a source edit against check-in, a location delete
 * against allocation, conversion against check-in, and a kit quantity change
 * against a booking check-out. Postgres deadlock aborts (40P01) are never
 * accepted in them: each path keeps the one lock order (booking rows, then
 * asset rows; kit and placement paths asset rows only).
 *
 * Paths outside these races are not covered. In particular, the model-request
 * lock order (reserving locks assets before model rows, while fulfil and
 * check-out rescheduling lock model rows first) is a known limit and can
 * still deadlock; no case here exercises it.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job).
 *
 * @see {@link file://./booking-sources-helpers.ts}
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts}
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  loadCustodySources,
  rehomeCustodyForPlacementChange,
} from "~/modules/asset/custody-source.server";
import {
  admitWindowChange,
  allocateNewSlices,
  setAutoSources,
  setManualSources,
} from "~/modules/booking/sources/booking-sources.server";
import { resizeKitSourceRows } from "~/modules/booking/sources/kit-sources.server";
import { evacuateLocationsForDelete } from "~/modules/booking/sources/location-delete.server";
import { lockAssetsForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";

import type { RowRead, TestWindow } from "./booking-sources-helpers";
import {
  addSlice,
  assertContractHolds,
  checkInUnits,
  checkOutUnits,
  cleanupPools,
  commitTx,
  countersOf,
  createBarrier,
  createSignal,
  insertLog,
  isDeadlock,
  lockBooking,
  messageOf,
  nth,
  pause,
  readOccupancy,
  readRows,
  readShares,
  readSlice,
  rowOf,
  seedKit,
  seedLocation,
  statusOf,
} from "./booking-sources-helpers";
import type { TxClient } from "./client";
import { commitAndExpect, disconnectTestDb, getTestDb } from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedBooking, seedOrgWithPool } from "./fixtures";

/** A booking window in the future, shared by every booking here. */
const W: TestWindow = {
  from: new Date("2030-04-01T09:00:00Z"),
  to: new Date("2030-04-03T09:00:00Z"),
};

afterAll(async () => {
  await disconnectTestDb();
});

/**
 * Asserts no race in a set ended in a deadlock abort.
 *
 * @param results - Outcomes of `Promise.allSettled`.
 */
function expectNoDeadlock(results: PromiseSettledResult<unknown>[]): void {
  const deadlocks = results.filter(
    (r) => r.status === "rejected" && isDeadlock(r.reason)
  );
  expect(deadlocks).toEqual([]);
}

/**
 * Rows with any counter above 0 (all-zero rows are dropped by the writer).
 *
 * @param rows - Rows from `readRows`.
 */
function nonEmpty(rows: RowRead[]): RowRead[] {
  return rows.filter((r) => countersOf(r).some((n) => n > 0));
}

/**
 * A LEGACY ONGOING slice of 10 units, 6 of them out from Shelf A, with no
 * returns yet: converting it seeds 6 out and 4 pending.
 *
 * @param created - Collects the workspace for cleanup.
 */
async function seedLegacyPartlyOut(created: SeededOrgWithPool[]) {
  return commitTx(async (tx) => {
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
        {
          assetId: pool.assetId,
          quantity: 10,
          checkedOutQuantity: 6,
          sourceLocationId: locationA,
        },
      ],
    });
    return {
      ...pool,
      locationA,
      bookingId: booking.bookingId,
      sliceId: nth(booking.sliceIds, 0),
    };
  });
}

/**
 * The date change a converting booking writer makes (same window), which
 * converts the LEGACY group under the booking lock and then the asset lock.
 *
 * @param seed - The workspace and booking.
 */
function convertByDateChange(seed: {
  organizationId: string;
  bookingId: string;
}) {
  return (tx: TxClient) =>
    admitWindowChange(tx, {
      organizationId: seed.organizationId,
      bookingId: seed.bookingId,
      from: W.from,
      to: W.to,
      previous: W,
      kind: "dates",
      adoptionEnabled: true,
    });
}

describe("booking sources concurrency", () => {
  it("Two simultaneous reservations for A's last units: exactly one commits", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        // Two drafts each planned 6 at Shelf A: drafts hold nothing, so
        // both fit until one is reserved.
        const drafts: Array<{ bookingId: string; sliceId: string }> = [];
        for (let i = 0; i < 2; i++) {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "DRAFT",
            from: W.from,
            to: W.to,
            slices: [{ assetId: pool.assetId, quantity: 6 }],
          });
          const sliceId = nth(booking.sliceIds, 0);
          await allocateNewSlices(tx, {
            organizationId: pool.organizationId,
            bookingId: booking.bookingId,
            sliceIds: [sliceId],
            window: W,
            holdsNow: false,
            adoptionEnabled: true,
          });
          drafts.push({ bookingId: booking.bookingId, sliceId });
        }
        return { ...pool, drafts };
      });

      const barrier = createBarrier(2);
      const results = await Promise.allSettled(
        seed.drafts.map((draft) =>
          commitTx(async (tx) => {
            await lockBooking(tx, draft.bookingId);
            await barrier();
            await admitWindowChange(tx, {
              organizationId: seed.organizationId,
              bookingId: draft.bookingId,
              from: W.from,
              to: W.to,
              previous: W,
              kind: "reserve",
              adoptionEnabled: true,
            });
            await tx.booking.update({
              where: { id: draft.bookingId },
              data: { status: "RESERVED" },
            });
          })
        )
      );

      expectNoDeadlock(results);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(statusOf(rejected[0]?.reason)).toBe(400);
      expect(messageOf(rejected[0]?.reason)).toContain("Not enough units");

      expect(
        await getTestDb().booking.count({
          where: {
            id: { in: seed.drafts.map((d) => d.bookingId) },
            status: "RESERVED",
          },
        })
      ).toBe(1);
      await assertContractHolds({
        sliceIds: seed.drafts.map((d) => d.sliceId),
        groups: seed.drafts.map((d) => ({
          bookingId: d.bookingId,
          assetId: seed.assetId,
        })),
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("check-out vs rehome: serialized by the asset lock, no source over-occupied", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 10,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const locationB = await seedLocation(tx, pool, "Shelf B");
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [{ assetId: pool.assetId, quantity: 6 }],
        });
        const sliceId = nth(booking.sliceIds, 0);
        await allocateNewSlices(tx, {
          organizationId: pool.organizationId,
          bookingId: booking.bookingId,
          sliceIds: [sliceId],
          window: W,
          holdsNow: true,
          adoptionEnabled: true,
        });
        return {
          ...pool,
          locationA: nth(pool.locationIds, 0),
          locationB,
          bookingId: booking.bookingId,
          sliceId,
        };
      });

      const barrier = createBarrier(2);
      const [checkout, placement] = await Promise.allSettled([
        commitTx(async (tx) => {
          await lockBooking(tx, seed.bookingId);
          await barrier();
          await checkOutUnits(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.bookingId,
            picks: [{ sliceId: seed.sliceId, units: 6 }],
            window: W,
          });
        }),
        // Move 6 of Shelf A's 10 units to Shelf B, as a placement move does.
        commitTx(async (tx) => {
          await barrier();
          await lockAssetsForQuantityUpdate(
            tx,
            [seed.assetId],
            seed.organizationId
          );
          const before = await loadCustodySources(tx, {
            assetId: seed.assetId,
            total: 10,
          });
          await tx.assetLocation.updateMany({
            where: { assetId: seed.assetId, locationId: seed.locationA },
            data: { quantity: 4 },
          });
          await tx.assetLocation.create({
            data: {
              assetId: seed.assetId,
              locationId: seed.locationB,
              organizationId: seed.organizationId,
              quantity: 6,
            },
          });
          await rehomeCustodyForPlacementChange(tx, {
            assetId: seed.assetId,
            organizationId: seed.organizationId,
            total: 10,
            before,
            destinationLocationId: seed.locationB,
          });
        }),
      ]);

      expectNoDeadlock([checkout, placement]);
      // A placement change is never refused.
      expect(placement.status).toBe("fulfilled");
      if (checkout.status === "rejected") {
        // The move came first: Shelf A no longer has 6 units for it.
        expect(statusOf(checkout.reason)).toBe(400);
        expect(nonEmpty(await readRows(seed.sliceId))).toHaveLength(1);
      } else {
        // The check-out came first: the 2 units out beyond A's new 4 follow
        // the stock to Shelf B.
        const rows = await readRows(seed.sliceId);
        expect(countersOf(rowOf(rows, "LOCATION", seed.locationA))).toEqual([
          4, 4, 0, 4,
        ]);
        expect(countersOf(rowOf(rows, "LOCATION", seed.locationB))).toEqual([
          2, 2, 0, 2,
        ]);
      }
      for (const { placed, out } of await readOccupancy(seed.assetId)) {
        expect(out).toBeLessThanOrEqual(placed);
      }
      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("source edit vs check-in: both commit, in either order, to the same final rows", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 20,
          placements: [
            { name: "Shelf A", quantity: 10 },
            { name: "Shelf B", quantity: 10 },
          ],
        });
        created.push(pool);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [{ assetId: pool.assetId, quantity: 10 }],
        });
        const sliceId = nth(booking.sliceIds, 0);
        await allocateNewSlices(tx, {
          organizationId: pool.organizationId,
          bookingId: booking.bookingId,
          sliceIds: [sliceId],
          window: W,
          holdsNow: true,
          adoptionEnabled: true,
        });
        return {
          ...pool,
          locationA: nth(pool.locationIds, 0),
          locationB: nth(pool.locationIds, 1),
          bookingId: booking.bookingId,
          sliceId,
        };
      });
      // 5 out from Shelf A, then the remaining 5 moved to Shelf B by hand.
      await commitTx((tx) =>
        checkOutUnits(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          picks: [{ sliceId: seed.sliceId, units: 5 }],
          window: W,
        })
      );
      await commitTx(async (tx) => {
        await lockBooking(tx, seed.bookingId);
        await setManualSources(tx, {
          organizationId: seed.organizationId,
          bookingId: seed.bookingId,
          sliceId: seed.sliceId,
          sources: [
            { locationId: seed.locationA, quantity: 5 },
            { locationId: seed.locationB, quantity: 5 },
          ],
          window: W,
          adoptionEnabled: true,
        });
      });

      const barrier = createBarrier(2);
      const results = await Promise.allSettled([
        // "Auto": the 5 pending units go back to Shelf A, the first that fits.
        commitTx(async (tx) => {
          await barrier();
          await lockBooking(tx, seed.bookingId);
          await setAutoSources(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.bookingId,
            sliceId: seed.sliceId,
            window: W,
            adoptionEnabled: true,
          });
        }),
        commitTx(async (tx) => {
          await barrier();
          await checkInUnits(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.bookingId,
            assetId: seed.assetId,
            userId: seed.userId,
            steps: [
              {
                disposition: {
                  sliceId: seed.sliceId,
                  assetId: seed.assetId,
                  returned: 2,
                },
                logs: [{ sliceId: seed.sliceId, quantity: 2 }],
              },
            ],
          });
        }),
      ]);

      expectNoDeadlock(results);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const rows = nonEmpty(await readRows(seed.sliceId));
      expect(rows).toHaveLength(1);
      expect(countersOf(rowOf(rows, "LOCATION", seed.locationA))).toEqual([
        10, 3, 2, 5,
      ]);
      expect(await readSlice(seed.sliceId)).toMatchObject({
        sourceAllocation: "AUTO",
      });
      await assertContractHolds({
        sliceIds: [seed.sliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("location delete vs allocation: both commit, nothing is left at the deleted location, nothing needs a location", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 20,
          placements: [
            { name: "Shelf A", quantity: 10 },
            { name: "Shelf B", quantity: 10 },
          ],
        });
        created.push(pool);
        // P already holds 4 at Shelf A, so the delete locks the pool.
        const p = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [{ assetId: pool.assetId, quantity: 4 }],
        });
        const pSlice = nth(p.sliceIds, 0);
        await allocateNewSlices(tx, {
          organizationId: pool.organizationId,
          bookingId: p.bookingId,
          sliceIds: [pSlice],
          window: W,
          holdsNow: true,
          adoptionEnabled: true,
        });
        // Q gets a new slice of 5 that the race allocates.
        const q = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [],
        });
        const qSlice = await addSlice(tx, {
          bookingId: q.bookingId,
          assetId: pool.assetId,
          quantity: 5,
        });
        return {
          ...pool,
          locationA: nth(pool.locationIds, 0),
          pBookingId: p.bookingId,
          pSlice,
          qBookingId: q.bookingId,
          qSlice,
        };
      });

      const barrier = createBarrier(2);
      const results = await Promise.allSettled([
        commitTx(async (tx) => {
          await barrier();
          await evacuateLocationsForDelete(tx, {
            organizationId: seed.organizationId,
            locationIds: [seed.locationA],
          });
          await tx.location.delete({
            where: { id: seed.locationA, organizationId: seed.organizationId },
          });
        }),
        commitTx(async (tx) => {
          await lockBooking(tx, seed.qBookingId);
          await barrier();
          await allocateNewSlices(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.qBookingId,
            sliceIds: [seed.qSlice],
            window: W,
            holdsNow: true,
            adoptionEnabled: true,
          });
        }),
      ]);

      expectNoDeadlock(results);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(
        await getTestDb().bookingAssetSource.count({
          where: { locationId: seed.locationA },
        })
      ).toBe(0);
      expect(
        await getTestDb().location.count({ where: { id: seed.locationA } })
      ).toBe(0);
      for (const [sliceId, quantity] of [
        [seed.pSlice, 4],
        [seed.qSlice, 5],
      ] as const) {
        const rows = await readRows(sliceId);
        const planned = rows
          .filter((r) => r.kind === "LOCATION" || r.kind === "UNPLACED")
          .reduce((sum, r) => sum + r.quantity - r.releasedQuantity, 0);
        expect(planned).toBe(quantity);
        expect(
          rows.some((r) => r.kind === "UNASSIGNED" && r.quantity > 0)
        ).toBe(false);
      }
      await assertContractHolds({
        sliceIds: [seed.pSlice, seed.qSlice],
        groups: [
          { bookingId: seed.pBookingId, assetId: seed.assetId },
          { bookingId: seed.qBookingId, assetId: seed.assetId },
        ],
      });
    } finally {
      await cleanupPools(created);
    }
  });

  it("Conversion races a check-in of the same asset: serialized by the locks, both commit, the return is fully shared", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedLegacyPartlyOut(created);
      const barrier = createBarrier(2);
      let logId = "";
      const results = await Promise.allSettled([
        commitTx(async (tx) => {
          await barrier();
          await lockBooking(tx, seed.bookingId);
          await convertByDateChange(seed)(tx);
        }),
        commitTx(async (tx) => {
          await barrier();
          const { logIds } = await checkInUnits(tx, {
            organizationId: seed.organizationId,
            bookingId: seed.bookingId,
            assetId: seed.assetId,
            userId: seed.userId,
            steps: [
              {
                disposition: {
                  sliceId: seed.sliceId,
                  assetId: seed.assetId,
                  returned: 3,
                },
                logs: [{ sliceId: seed.sliceId, quantity: 3 }],
              },
            ],
          });
          logId = nth(logIds, 0);
        }),
      ]);

      expectNoDeadlock(results);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const rows = await readRows(seed.sliceId);
      // Whichever converted: 6 out and 4 pending at A, then 3 came back.
      expect(rows.map((r) => [r.kind, r.locationId, ...countersOf(r)])).toEqual(
        [["LOCATION", seed.locationA, 10, 3, 3, 6]]
      );
      expect(await readShares(logId)).toEqual([
        {
          bookingAssetId: seed.sliceId,
          bookingAssetSourceId: rowOf(rows, "LOCATION", seed.locationA).id,
          quantity: 3,
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

  it("Conversion races a check-in of the same asset: a writer that skipped the asset lock fails check 9", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await seedLegacyPartlyOut(created);
      const converting = createSignal();

      const [conversion, skipper] = await Promise.all([
        commitTx(async (tx) => {
          await lockBooking(tx, seed.bookingId);
          await convertByDateChange(seed)(tx);
          converting.fire();
          // Hold the locks while the other writer sends its log.
          await pause(500);
        }).then(
          () => "committed",
          (error: unknown) => messageOf(error)
        ),
        // Writes a RETURN log with no shares and takes no lock: its insert
        // waits on the booking row, then lands in a converted group.
        commitAndExpect(async (tx) => {
          await converting.wait();
          await insertLog(tx, {
            assetId: seed.assetId,
            userId: seed.userId,
            bookingId: seed.bookingId,
            sliceId: seed.sliceId,
            quantity: 2,
          });
        }),
      ]);

      expect(conversion).toBe("committed");
      expect(skipper.ok).toBe(false);
      if (!skipper.ok) {
        expect(skipper.message).toContain("booking_source_check_9:");
      }
      expect(await readSlice(seed.sliceId)).toMatchObject({
        sourceAllocation: "AUTO",
      });
      expect(
        await getTestDb().consumptionLog.count({
          where: { bookingId: seed.bookingId },
        })
      ).toBe(0);
    } finally {
      await cleanupPools(created);
    }
  });

  it("kit paths take asset locks only: a kit quantity change racing a booking writer on the same pool never deadlocks", async () => {
    const ROUNDS = 4;
    const created: SeededOrgWithPool[] = [];
    try {
      const seed = await commitTx(async (tx) => {
        const pool = await seedOrgWithPool(tx, {
          total: 20,
          placements: [{ name: "Shelf A", quantity: 10 }],
        });
        created.push(pool);
        const { assetKitId } = await seedKit(tx, pool, 5);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: W.from,
          to: W.to,
          slices: [
            { assetId: pool.assetId, quantity: 10 },
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
          assetKitId,
          bookingId: booking.bookingId,
          standaloneId: nth(booking.sliceIds, 0),
          kitSliceId: nth(booking.sliceIds, 1),
        };
      });

      for (let round = 0; round < ROUNDS; round++) {
        const next = round % 2 === 0 ? 6 : 5;
        const barrier = createBarrier(2);
        const results = await Promise.allSettled([
          // Kit edit: asset lock (in the resize), KIT row, membership and
          // kit slice quantity. Never the booking lock.
          commitTx(async (tx) => {
            await barrier();
            const resized = await resizeKitSourceRows(tx, {
              organizationId: seed.organizationId,
              slices: [
                {
                  sliceId: seed.kitSliceId,
                  assetId: seed.assetId,
                  quantity: next,
                },
              ],
              belowOut: "refuse",
            });
            expect(resized.refused).toEqual([]);
            await tx.assetKit.update({
              where: { id: seed.assetKitId },
              data: { quantity: next },
            });
            await tx.bookingAsset.update({
              where: { id: seed.kitSliceId },
              data: { quantity: next },
            });
          }),
          // Booking writer: booking lock, then the asset lock in the facade.
          commitTx(async (tx) => {
            await lockBooking(tx, seed.bookingId);
            await barrier();
            await checkOutUnits(tx, {
              organizationId: seed.organizationId,
              bookingId: seed.bookingId,
              picks: [{ sliceId: seed.standaloneId, units: 1 }],
              window: W,
            });
          }),
        ]);
        expectNoDeadlock(results);
        expect(results.map((r) => r.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
      }

      expect(countersOf(rowOf(await readRows(seed.kitSliceId), "KIT"))).toEqual(
        [5, 0, 0, 0]
      );
      const standalone = await readRows(seed.standaloneId);
      expect(standalone.reduce((sum, r) => sum + r.outQuantity, 0)).toBe(
        ROUNDS
      );
      expect(await readSlice(seed.standaloneId)).toMatchObject({
        checkedOutQuantity: ROUNDS,
      });
      await assertContractHolds({
        sliceIds: [seed.standaloneId, seed.kitSliceId],
        groups: [{ bookingId: seed.bookingId, assetId: seed.assetId }],
      });
    } finally {
      await cleanupPools(created);
    }
  });
});
