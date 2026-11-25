/**
 * Booking sources: tenant isolation against a real database
 *
 * Two workspaces, each with a pool and a converted booking. The facade is
 * called with one workspace's trusted id and the other's ids: a location of
 * another workspace is refused like any non-placement (400) and a booking of
 * another workspace is not found (404), writing and disclosing nothing. The
 * contract triggers reject a share or a source row that reaches into another
 * workspace. The Supabase API roles can read neither table, and RLS returns
 * no rows even if a grant slips in.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job).
 *
 * @see {@link file://./booking-sources-helpers.ts}
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts}
 */

import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { db as appDb } from "~/database/db.server";
import {
  allocateNewSlices,
  dispatchUnits,
  getSliceSourceSummaries,
  openSettlement,
  setManualSources,
} from "~/modules/booking/sources/booking-sources.server";

import type { TestWindow } from "./booking-sources-helpers";
import {
  addSlice,
  cleanupPools,
  commitTx,
  countersOf,
  insertLog,
  insertShare,
  insertSource,
  lockBooking,
  nth,
  readRows,
  setSliceMode,
} from "./booking-sources-helpers";
import type { TxClient } from "./client";
import { commitAndExpect, disconnectTestDb, withRollback } from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedBooking, seedOrgWithPool } from "./fixtures";

/** A booking window in the future, shared by every booking here. */
const W: TestWindow = {
  from: new Date("2030-05-01T09:00:00Z"),
  to: new Date("2030-05-03T09:00:00Z"),
};

/** The two tables that hold booking sources. */
const TABLES = ["BookingAssetSource", "BookingDispositionShare"] as const;

/** Roles Supabase exposes through its API. */
const API_ROLES = ["anon", "authenticated"] as const;

afterAll(async () => {
  await disconnectTestDb();
  // `getSliceSourceSummaries` reads through the app's own client.
  await appDb.$disconnect();
});

/** One workspace with a pool at Shelf A and a reserved, allocated slice. */
type Tenant = SeededOrgWithPool & {
  locationA: string;
  bookingId: string;
  sliceId: string;
};

/**
 * Seeds a workspace whose reserved booking holds 4 units planned at Shelf A.
 *
 * @param tx - Transaction client.
 * @returns The ids.
 */
async function seedTenant(tx: TxClient): Promise<Tenant> {
  const pool = await seedOrgWithPool(tx, {
    total: 10,
    placements: [{ name: "Shelf A", quantity: 10 }],
  });
  const booking = await seedBooking(tx, {
    organizationId: pool.organizationId,
    userId: pool.userId,
    status: "RESERVED",
    from: W.from,
    to: W.to,
    slices: [{ assetId: pool.assetId, quantity: 4 }],
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
    bookingId: booking.bookingId,
    sliceId,
  };
}

/**
 * Seeds two workspaces, committed.
 *
 * @param created - Collects both workspaces for cleanup.
 * @returns Workspace A (the caller) and workspace B (the other tenant).
 */
async function seedTwoTenants(
  created: SeededOrgWithPool[]
): Promise<{ a: Tenant; b: Tenant }> {
  return commitTx(async (tx) => {
    const a = await seedTenant(tx);
    created.push(a);
    const b = await seedTenant(tx);
    created.push(b);
    return { a, b };
  });
}

describe("booking sources tenant isolation", () => {
  it("Foreign location id: 400, nothing written", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const { a, b } = await seedTwoTenants(created);
      const before = (await readRows(a.sliceId)).map(countersOf);

      // The row action naming workspace B's location.
      await expect(
        commitTx(async (tx) => {
          await lockBooking(tx, a.bookingId);
          await setManualSources(tx, {
            organizationId: a.organizationId,
            bookingId: a.bookingId,
            sliceId: a.sliceId,
            sources: [{ locationId: b.locationA, quantity: 4 }],
            window: W,
            adoptionEnabled: true,
          });
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("does not hold this asset"),
      });

      // A check-out choosing workspace B's location as the source.
      await expect(
        commitTx(async (tx) => {
          await lockBooking(tx, a.bookingId);
          await dispatchUnits(tx, {
            organizationId: a.organizationId,
            bookingId: a.bookingId,
            picks: [
              { sliceId: a.sliceId, units: 2, fromLocationId: b.locationA },
            ],
            window: W,
            adoptionEnabled: true,
          });
        })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining("does not hold this asset"),
      });

      expect((await readRows(a.sliceId)).map(countersOf)).toEqual(before);
      expect(
        (await readRows(a.sliceId)).some((r) => r.locationId === b.locationA)
      ).toBe(false);
    } finally {
      await cleanupPools(created);
    }
  });

  it("Another workspace's booking: 404, nothing written or disclosed", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const { a, b } = await seedTwoTenants(created);
      const before = (await readRows(b.sliceId)).map(countersOf);

      // Workspace A's trusted id with workspace B's booking and slice.
      const calls: Array<(tx: TxClient) => Promise<unknown>> = [
        (tx) =>
          setManualSources(tx, {
            organizationId: a.organizationId,
            bookingId: b.bookingId,
            sliceId: b.sliceId,
            sources: [{ locationId: b.locationA, quantity: 4 }],
            window: W,
            adoptionEnabled: true,
          }),
        (tx) =>
          dispatchUnits(tx, {
            organizationId: a.organizationId,
            bookingId: b.bookingId,
            picks: [{ sliceId: b.sliceId, units: 2 }],
            window: W,
            adoptionEnabled: true,
          }),
        (tx) =>
          openSettlement(tx, {
            organizationId: a.organizationId,
            bookingId: b.bookingId,
            assetIds: [b.assetId],
            adoptionEnabled: true,
          }),
        async (tx) => {
          const sliceId = await addSlice(tx, {
            bookingId: b.bookingId,
            assetId: b.assetId,
            quantity: 1,
          });
          return allocateNewSlices(tx, {
            organizationId: a.organizationId,
            bookingId: b.bookingId,
            sliceIds: [sliceId],
            window: W,
            holdsNow: true,
            adoptionEnabled: true,
          });
        },
      ];
      for (const call of calls) {
        await expect(withRollback(call)).rejects.toMatchObject({
          status: 404,
        });
      }

      // The display path discloses nothing about the other booking.
      const summaries = await getSliceSourceSummaries({
        organizationId: a.organizationId,
        bookingId: b.bookingId,
      });
      expect(summaries.size).toBe(0);

      expect((await readRows(b.sliceId)).map(countersOf)).toEqual(before);
    } finally {
      await cleanupPools(created);
    }
  });

  it("A share pointing at another workspace's source row: the trigger rejects it at COMMIT", async () => {
    const result = await commitAndExpect(async (tx) => {
      const a = await seedTenant(tx);
      const b = await seedTenant(tx);
      // Workspace B's slice: 4 out from Shelf A, 1 back and shared, so its
      // row still reconciles once the stray share below lands on it too
      // (dispatched 4 - shared 2 = out 2).
      await tx.$executeRaw`
        UPDATE "Booking" SET "status" = 'ONGOING' WHERE "id" = ${b.bookingId}
      `;
      await tx.$executeRaw`
        UPDATE "BookingAsset" SET "checkedOutQuantity" = 4
        WHERE "id" = ${b.sliceId}
      `;
      const [bRow] = await readRows(b.sliceId, tx);
      if (!bRow) throw new Error("workspace B has no source row");
      await tx.$executeRaw`
        UPDATE "BookingAssetSource"
        SET "outQuantity" = 2, "releasedQuantity" = 2, "dispatchedTotal" = 4
        WHERE "id" = ${bRow.id}
      `;
      const bLog = await insertLog(tx, {
        assetId: b.assetId,
        userId: b.userId,
        bookingId: b.bookingId,
        sliceId: b.sliceId,
        quantity: 1,
      });
      await insertShare(tx, {
        organizationId: b.organizationId,
        logId: bLog,
        bookingId: b.bookingId,
        assetId: b.assetId,
        sliceId: b.sliceId,
        sourceId: bRow.id,
        quantity: 1,
      });

      // Workspace A's log, fully shared, but its share names B's row.
      const aLog = await insertLog(tx, {
        assetId: a.assetId,
        userId: a.userId,
        bookingId: a.bookingId,
        sliceId: a.sliceId,
        quantity: 1,
      });
      await insertShare(tx, {
        organizationId: a.organizationId,
        logId: aLog,
        bookingId: a.bookingId,
        assetId: a.assetId,
        sliceId: a.sliceId,
        sourceId: bRow.id,
        quantity: 1,
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/booking_source_check_(6|10):/);
    }
  });

  it("A source row at another workspace's location: the trigger rejects it at COMMIT (check 6)", async () => {
    const result = await commitAndExpect(async (tx) => {
      const a = await seedTenant(tx);
      const b = await seedTenant(tx);
      // A converted slice of workspace A planned at workspace B's location.
      const booking = await seedBooking(tx, {
        organizationId: a.organizationId,
        userId: a.userId,
        status: "RESERVED",
        from: W.from,
        to: W.to,
        slices: [{ assetId: a.assetId, quantity: 2 }],
      });
      const sliceId = nth(booking.sliceIds, 0);
      await setSliceMode(tx, sliceId, "MANUAL");
      await insertSource(tx, {
        organizationId: a.organizationId,
        sliceId,
        kind: "LOCATION",
        locationId: b.locationA,
        quantity: 2,
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("booking_source_check_6:");
    }
  });

  for (const role of API_ROLES) {
    for (const table of TABLES) {
      it(`${role} cannot read ${table}`, async () => {
        await expect(
          withRollback(async (tx) => {
            await tx.$executeRaw`SET LOCAL ROLE ${Prisma.raw(role)}`;
            return tx.$queryRaw`
              SELECT count(*)::int AS "rows" FROM ${Prisma.raw(`"${table}"`)}
            `;
          })
        ).rejects.toThrow(/permission denied/);
      });

      it(`${role} sees no ${table} rows under RLS even when granted SELECT`, async () => {
        const rows = await withRollback(async (tx) => {
          // A row exists (written as the table owner).
          const tenant = await seedTenant(tx);
          const [row] = await readRows(tenant.sliceId, tx);
          if (!row) throw new Error("no source row seeded");
          const logId = await insertLog(tx, {
            assetId: tenant.assetId,
            userId: tenant.userId,
            bookingId: tenant.bookingId,
            quantity: 1,
          });
          await insertShare(tx, {
            organizationId: tenant.organizationId,
            logId,
            bookingId: tenant.bookingId,
            assetId: tenant.assetId,
            sliceId: null,
            sourceId: null,
            quantity: 1,
          });
          // A grant that should never exist, rolled back with the test.
          await tx.$executeRaw`
            GRANT SELECT ON ${Prisma.raw(`"${table}"`)} TO ${Prisma.raw(role)}
          `;
          await tx.$executeRaw`SET LOCAL ROLE ${Prisma.raw(role)}`;
          const result = await tx.$queryRaw<Array<{ rows: number }>>`
            SELECT count(*)::int AS "rows" FROM ${Prisma.raw(`"${table}"`)}
          `;
          await tx.$executeRaw`RESET ROLE`;
          return result[0]?.rows;
        });
        expect(rows).toBe(0);
      });
    }
  }
});
