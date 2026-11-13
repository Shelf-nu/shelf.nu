/**
 * Booking source tables: schema contract
 *
 * Pins what the migration creates for `BookingAssetSource` and
 * `BookingDispositionShare` against a real database: the tables exist, RLS is
 * on and the Supabase API roles hold no table privileges, the foreign keys
 * delete the way the accounting model needs (a location with source rows
 * cannot be deleted, deleting an asset removes its shares), the
 * `NULLS NOT DISTINCT` unique key holds for location-less kinds, and every
 * foreign key column has an index led by that column.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job).
 *
 * @see {@link file://./../../../../packages/database/prisma/migrations/20261112100000_booking_asset_sources/migration.sql}
 * @see {@link file://./client.ts}
 * @see {@link file://./fixtures.ts}
 */

import { afterAll, describe, expect, it } from "vitest";

import type { TxClient } from "./client";
import { disconnectTestDb, getTestDb, withRollback } from "./client";
import { seedBooking, seedOrgWithPool } from "./fixtures";

/** The two tables this migration creates. */
const TABLES = ["BookingAssetSource", "BookingDispositionShare"] as const;

/** Privileges the Supabase API roles must not hold on either table. */
const PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/** Roles Supabase exposes through its API. */
const API_ROLES = ["anon", "authenticated"] as const;

afterAll(async () => {
  await disconnectTestDb();
});

/**
 * Seeds a workspace with one pool, a reserved booking holding one slice of it,
 * and a location with no placements.
 *
 * @param tx - Transaction client to write with.
 * @returns The ids the tests build on.
 */
async function seedSlice(tx: TxClient) {
  const pool = await seedOrgWithPool(tx, { total: 10, placements: [] });
  const location = await tx.location.create({
    data: {
      name: "Source shelf",
      userId: pool.userId,
      organizationId: pool.organizationId,
    },
    select: { id: true },
  });
  const booking = await seedBooking(tx, {
    organizationId: pool.organizationId,
    userId: pool.userId,
    status: "RESERVED",
    from: new Date("2030-01-01T09:00:00Z"),
    to: new Date("2030-01-02T09:00:00Z"),
    slices: [{ assetId: pool.assetId, quantity: 4 }],
  });
  return {
    ...pool,
    locationId: location.id,
    bookingId: booking.bookingId,
    sliceId: booking.sliceIds[0],
  };
}

describe("booking source tables", () => {
  it("exist", async () => {
    const rows = await getTestDb().$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass('public."BookingAssetSource"')::text AS "name"
      UNION ALL
      SELECT to_regclass('public."BookingDispositionShare"')::text
    `;
    expect(rows.map((row) => row.name)).toEqual([
      '"BookingAssetSource"',
      '"BookingDispositionShare"',
    ]);
  });

  it("have row level security enabled", async () => {
    const rows = await getTestDb().$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean }>
    >`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
        AND relname IN ('BookingAssetSource', 'BookingDispositionShare')
      ORDER BY relname
    `;
    expect(rows).toEqual([
      { relname: "BookingAssetSource", relrowsecurity: true },
      { relname: "BookingDispositionShare", relrowsecurity: true },
    ]);
  });

  it("grant nothing to the Supabase API roles", async () => {
    const db = getTestDb();
    for (const role of API_ROLES) {
      for (const table of TABLES) {
        for (const privilege of PRIVILEGES) {
          const rows = await db.$queryRaw<Array<{ granted: boolean }>>`
            SELECT has_table_privilege(
              ${role}, ${`public."${table}"`}, ${privilege}
            ) AS "granted"
          `;
          expect({ role, table, privilege, granted: rows[0]?.granted }).toEqual(
            { role, table, privilege, granted: false }
          );
        }
      }
    }
  });

  it("refuse to delete a location that a LOCATION source row names", async () => {
    await expect(
      withRollback(async (tx) => {
        const seeded = await seedSlice(tx);
        await tx.bookingAssetSource.create({
          data: {
            organizationId: seeded.organizationId,
            bookingAssetId: seeded.sliceId,
            kind: "LOCATION",
            locationId: seeded.locationId,
            quantity: 4,
          },
        });
        await tx.$executeRaw`
          DELETE FROM "Location" WHERE "id" = ${seeded.locationId}
        `;
      })
    ).rejects.toThrow(/BookingAssetSource_locationId_fkey/);
  });

  it("allow one row per location-less kind per slice (NULLS NOT DISTINCT)", async () => {
    await expect(
      withRollback(async (tx) => {
        const seeded = await seedSlice(tx);
        for (let i = 0; i < 2; i++) {
          await tx.bookingAssetSource.create({
            data: {
              organizationId: seeded.organizationId,
              bookingAssetId: seeded.sliceId,
              kind: "UNPLACED",
              quantity: 2,
            },
          });
        }
      })
    ).rejects.toThrow(/BookingAssetSource_slice_kind_location_key|Unique/);
  });

  it("remove an asset's shares when the asset is deleted", async () => {
    const remaining = await withRollback(async (tx) => {
      const seeded = await seedSlice(tx);
      const source = await tx.bookingAssetSource.create({
        data: {
          organizationId: seeded.organizationId,
          bookingAssetId: seeded.sliceId,
          kind: "UNPLACED",
          quantity: 4,
          outQuantity: 2,
          dispatchedTotal: 4,
        },
        select: { id: true },
      });
      const log = await tx.consumptionLog.create({
        data: {
          assetId: seeded.assetId,
          category: "RETURN",
          quantity: 2,
          userId: seeded.userId,
          bookingId: seeded.bookingId,
          bookingAssetId: seeded.sliceId,
        },
        select: { id: true },
      });
      await tx.bookingDispositionShare.create({
        data: {
          organizationId: seeded.organizationId,
          consumptionLogId: log.id,
          bookingId: seeded.bookingId,
          assetId: seeded.assetId,
          bookingAssetId: seeded.sliceId,
          bookingAssetSourceId: source.id,
          quantity: 2,
          origin: "RECORDED",
        },
      });
      expect(
        await tx.bookingDispositionShare.count({
          where: { assetId: seeded.assetId },
        })
      ).toBe(1);

      await tx.$executeRaw`DELETE FROM "Asset" WHERE "id" = ${seeded.assetId}`;

      return tx.bookingDispositionShare.count({
        where: { assetId: seeded.assetId },
      });
    });

    expect(remaining).toBe(0);
  });

  it("index every foreign key column with an index led by that column", async () => {
    const rows = await getTestDb().$queryRaw<
      Array<{
        conname: string;
        column: string;
        ondelete: string;
        indexed: boolean;
      }>
    >`
      SELECT
        c.conname,
        a.attname AS "column",
        c.confdeltype::text AS "ondelete",
        EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]
        ) AS "indexed"
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.conrelid IN (
          'public."BookingAssetSource"'::regclass,
          'public."BookingDispositionShare"'::regclass
        )
      ORDER BY c.conname
    `;

    // confdeltype: c = CASCADE, r = RESTRICT, n = SET NULL.
    expect(rows.map(({ conname, ondelete }) => [conname, ondelete])).toEqual([
      ["BookingAssetSource_bookingAssetId_fkey", "c"],
      ["BookingAssetSource_locationId_fkey", "r"],
      ["BookingAssetSource_organizationId_fkey", "c"],
      ["BookingDispositionShare_assetId_fkey", "c"],
      ["BookingDispositionShare_bookingAssetId_fkey", "n"],
      ["BookingDispositionShare_bookingAssetSourceId_fkey", "n"],
      ["BookingDispositionShare_bookingId_fkey", "c"],
      ["BookingDispositionShare_consumptionLogId_fkey", "c"],
      ["BookingDispositionShare_organizationId_fkey", "c"],
    ]);
    // Every foreign key is single-column, so `conkey[1]` is the whole key.
    expect(rows.filter((row) => !row.indexed).map((row) => row.column)).toEqual(
      []
    );
  });
});
