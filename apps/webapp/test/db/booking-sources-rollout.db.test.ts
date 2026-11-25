/**
 * Booking source rollout: compatibility on the migrated schema
 *
 * Pins the rollout rules of booking source locations against a real
 * database, with the deferred contract triggers firing at COMMIT:
 *
 * 1. **Before deploy 1.** A binary that knows nothing about source rows (no
 *    `sourceAllocation` column in its client, no facade) keeps checking out,
 *    partially checking in and returning untagged units on LEGACY slices
 *    once the two migrations ran. Its writes are replayed statement by
 *    statement, in raw SQL naming only the columns that binary knows: the
 *    booking lock, the sorted asset lock, the slice counters, the
 *    disposition logs, the stock ledger rows and the session rows.
 * 2. **Rollback floor.** The same writer on a converted group fails loudly
 *    at COMMIT (an unshared disposition log), which is why rolling back
 *    below deploy 1 after activation is unsupported. On a LEGACY group of
 *    the same asset it still commits.
 * 3. **Flag on, then off.** A group converted by a machine with adoption on
 *    stays converted and maintained when adoption is off: resize, a kit
 *    slice added to the group, check-out and check-in all keep its source
 *    rows and shares consistent, while a LEGACY booking stays LEGACY.
 * 4. **Mixed flag values.** During the rolling restart some machines have
 *    the flag on and some off. Two open transactions on the same group, one
 *    with adoption on and one with it off, serialize on the booking lock and
 *    commit with every invariant intact, in either order.
 *
 * The adoption flag is the facade's `adoptionEnabled` argument, the value a
 * machine reads from `BOOKING_SOURCES_ENABLED`.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job). Tests
 * commit, so each cleans up its workspaces in `finally`.
 *
 * @see {@link file://./../../../docs/booking-source-locations.md} the rollout runbook
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts} the facade
 * @see {@link file://./../../../../packages/database/prisma/migrations/20261112100100_booking_source_contract/migration.sql}
 */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  allocateNewSlices,
  commitSettlement,
  dispatchUnits,
  openSettlement,
  resizeSlices,
} from "~/modules/booking/sources/booking-sources.server";
import { settleUnits } from "~/modules/booking/sources/settlement";

import type { TxClient } from "./client";
import { commitAndExpect, disconnectTestDb, getTestDb } from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedBooking, seedOrgWithPool } from "./fixtures";

afterAll(async () => {
  await disconnectTestDb();
});

/** One hour in milliseconds. */
const HOUR = 60 * 60 * 1000;

/**
 * A booking window that started an hour ago and ends in two days, so a
 * check-out now is on time and nothing is overdue.
 *
 * @returns The half-open window `[from, to)`.
 */
function currentWindow(): { from: Date; to: Date } {
  const now = Date.now();
  return { from: new Date(now - HOUR), to: new Date(now + 48 * HOUR) };
}

/**
 * Seeds a workspace with a 20-unit pool: 10 placed at "Shelf A", 10 unplaced.
 *
 * @param tx - Transaction client to write with.
 * @returns The workspace, asset, location and user ids.
 */
function seedPool(tx: TxClient): Promise<SeededOrgWithPool> {
  return seedOrgWithPool(tx, {
    total: 20,
    placements: [{ name: "Shelf A", quantity: 10 }],
  });
}

/**
 * Returns the location id of the pool's only placement.
 *
 * @param pool - A pool seeded by {@link seedPool}.
 * @returns The id of "Shelf A".
 * @throws {Error} When the pool has no placement.
 */
function shelfA(pool: SeededOrgWithPool): string {
  const [locationId] = pool.locationIds;
  if (!locationId) throw new Error("seedPool created no placement");
  return locationId;
}

/**
 * Returns the slice id at `index` of a seeded booking.
 *
 * @param sliceIds - Slice ids returned by `seedBooking`.
 * @param index - Position of the slice, 0 by default.
 * @returns The slice id.
 * @throws {Error} When the booking has no slice at that position.
 */
function sliceAt(sliceIds: string[], index = 0): string {
  const sliceId = sliceIds[index];
  if (!sliceId) throw new Error(`seedBooking returned no slice ${index}`);
  return sliceId;
}

/**
 * Commits a transaction on the shared client and returns its value. Used to
 * seed state that a later transaction changes.
 *
 * @param fn - Writes to commit.
 * @returns Whatever `fn` returned.
 */
function commitSeed<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return getTestDb().$transaction(fn, { timeout: 25_000 });
}

/**
 * Removes committed workspaces and their owners. Best effort: a leftover row
 * from a failed cleanup is harmless to other tests.
 *
 * @param pools - Workspaces seeded by `seedOrgWithPool`.
 */
async function cleanup(pools: SeededOrgWithPool[]): Promise<void> {
  const db = getTestDb();
  for (const pool of pools) {
    await db.$executeRaw`
      DELETE FROM "Organization" WHERE "id" = ${pool.organizationId}
    `.catch(() => undefined);
    await db.$executeRaw`
      DELETE FROM "User" WHERE "id" = ${pool.userId}
    `.catch(() => undefined);
  }
}

/**
 * Takes the booking row lock the way every booking writer does: one
 * workspace-scoped `SELECT ... FOR UPDATE`.
 *
 * @param tx - Transaction client.
 * @param pool - The booking's workspace.
 * @param bookingId - The booking to lock.
 */
async function lockBooking(
  tx: TxClient,
  pool: SeededOrgWithPool,
  bookingId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT status FROM "Booking"
    WHERE id = ${bookingId} AND "organizationId" = ${pool.organizationId}
    FOR UPDATE
  `;
}

/**
 * Takes the pool's asset row lock the way the check-out and check-in paths
 * do: one sorted, workspace-scoped `SELECT ... FOR UPDATE`.
 *
 * @param tx - Transaction client.
 * @param pool - The pool to lock.
 */
async function lockPool(tx: TxClient, pool: SeededOrgWithPool): Promise<void> {
  await tx.$queryRaw`
    SELECT id, type, quantity FROM "Asset"
    WHERE id IN (${pool.assetId}) AND "organizationId" = ${pool.organizationId}
    ORDER BY id COLLATE "C"
    FOR UPDATE
  `;
}

/** `ConsumptionCategory` values these tests write. */
type LogCategory = "RETURN" | "CONSUME" | "OPENING_BALANCE";

/** Values for {@link insertLog}. */
type LogInput = {
  pool: SeededOrgWithPool;
  category: LogCategory;
  quantity: number;
  /** NULL for a ledger row that belongs to no booking. */
  bookingId: string | null;
  /** The slice the writer attributed the log to; NULL when untagged. */
  bookingAssetId?: string | null;
  /** Where the stock changed; NULL for the unplaced units. */
  locationId?: string | null;
  /** Signed stock change, set on ledger rows only. */
  stockChange?: number | null;
};

/**
 * Inserts a `ConsumptionLog` with only the columns every binary knows.
 *
 * @param tx - Transaction client.
 * @param input - Log values.
 * @returns The new log id.
 */
async function insertLog(tx: TxClient, input: LogInput): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "ConsumptionLog" (
      "id", "assetId", "category", "quantity", "userId", "bookingId",
      "bookingAssetId", "locationId", "stockChange"
    ) VALUES (
      ${id}, ${input.pool.assetId},
      ${input.category}::"ConsumptionCategory", ${input.quantity}::int,
      ${input.pool.userId}, ${input.bookingId}, ${input.bookingAssetId ?? null},
      ${input.locationId ?? null}, ${input.stockChange ?? null}::int
    )
  `;
  return id;
}

/**
 * Creates a kit holding `quantity` units of the pool and returns its
 * `AssetKit` id (the value a kit-driven slice carries in `assetKitId`).
 *
 * @param tx - Transaction client.
 * @param pool - The pool the kit holds units of.
 * @param quantity - Units in the kit.
 * @returns The `AssetKit` id.
 */
async function seedKit(
  tx: TxClient,
  pool: SeededOrgWithPool,
  quantity: number
): Promise<string> {
  const kit = await tx.kit.create({
    data: {
      name: "Db test kit",
      organizationId: pool.organizationId,
      createdById: pool.userId,
    },
    select: { id: true },
  });
  const assetKit = await tx.assetKit.create({
    data: {
      assetId: pool.assetId,
      kitId: kit.id,
      organizationId: pool.organizationId,
      quantity,
    },
    select: { id: true },
  });
  return assetKit.id;
}

/**
 * Marks slices as checked out the way the check-out path stamps them.
 *
 * @param tx - Transaction client.
 * @param sliceIds - The slices.
 * @param userId - Who checked them out.
 */
async function stampCheckedOut(
  tx: TxClient,
  sliceIds: string[],
  userId: string
): Promise<void> {
  for (const sliceId of sliceIds) {
    await tx.$executeRaw`
      UPDATE "BookingAsset"
      SET "checkedOutAt" = now(), "checkedOutById" = ${userId}
      WHERE "id" = ${sliceId}
    `;
  }
}

/** A slice as the assertions read it back. */
type SliceState = {
  mode: string;
  converted: boolean;
  quantity: number;
  checkedOutQuantity: number;
  rows: Array<{
    kind: string;
    locationId: string | null;
    quantity: number;
    outQuantity: number;
    releasedQuantity: number;
    dispatchedTotal: number;
  }>;
};

/**
 * Reads a slice's mode, counters and source rows after a commit.
 *
 * @param sliceId - The slice.
 * @returns Its state, rows ordered by kind.
 * @throws {Error} When the slice does not exist.
 */
async function readSlice(sliceId: string): Promise<SliceState> {
  const db = getTestDb();
  const slice = await db.bookingAsset.findUnique({
    where: { id: sliceId },
    select: {
      sourceAllocation: true,
      sourcesConvertedAt: true,
      quantity: true,
      checkedOutQuantity: true,
    },
  });
  if (!slice) throw new Error(`slice ${sliceId} not found`);
  const rows = await db.bookingAssetSource.findMany({
    where: { bookingAssetId: sliceId },
    select: {
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
      dispatchedTotal: true,
    },
    orderBy: { kind: "asc" },
  });
  return {
    mode: slice.sourceAllocation,
    converted: slice.sourcesConvertedAt !== null,
    quantity: slice.quantity,
    checkedOutQuantity: slice.checkedOutQuantity,
    rows,
  };
}

/**
 * Sums a column over a slice's source rows.
 *
 * @param state - The slice state.
 * @param field - The counter to sum.
 * @returns The sum.
 */
function sumRows(
  state: SliceState,
  field: "quantity" | "outQuantity" | "releasedQuantity" | "dispatchedTotal"
): number {
  return state.rows.reduce((sum, row) => sum + row[field], 0);
}

/**
 * Asserts the booking has no source row and no share: the state a binary
 * that knows nothing about sources leaves behind.
 *
 * @param bookingId - The booking.
 */
async function expectNoSourceState(bookingId: string): Promise<void> {
  const db = getTestDb();
  // The source models have no Prisma relation, so the slice join is SQL.
  const [sources] = await db.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "BookingAssetSource" s
    JOIN "BookingAsset" ba ON ba.id = s."bookingAssetId"
    WHERE ba."bookingId" = ${bookingId}
  `;
  expect(sources?.count).toBe(0);
  expect(await db.bookingDispositionShare.count({ where: { bookingId } })).toBe(
    0
  );
}

/**
 * Per disposition log of a booking: its quantity and the units its shares
 * cover. A converted group needs every log fully shared.
 *
 * @param bookingId - The booking.
 * @returns One entry per RETURN, CONSUME, LOSS or DAMAGE log.
 */
function readLogCoverage(
  bookingId: string
): Promise<Array<{ quantity: number; shared: number }>> {
  return getTestDb().$queryRaw<Array<{ quantity: number; shared: number }>>`
    SELECT cl.quantity, COALESCE(SUM(sh.quantity), 0)::int AS shared
    FROM "ConsumptionLog" cl
    LEFT JOIN "BookingDispositionShare" sh ON sh."consumptionLogId" = cl.id
    WHERE cl."bookingId" = ${bookingId}
      AND cl.category::text IN ('RETURN', 'CONSUME', 'LOSS', 'DAMAGE')
    GROUP BY cl.id, cl.quantity
    ORDER BY cl.quantity
  `;
}

/** Arguments of {@link checkInWithFacade}. */
type FacadeCheckIn = {
  pool: SeededOrgWithPool;
  bookingId: string;
  sliceId: string;
  returned: number;
  adoptionEnabled: boolean;
  /** Called once the booking lock is held, before anything else. */
  onLocked?: () => Promise<void>;
};

/**
 * Checks units back in the way a deploy 1 machine does: booking lock, the
 * sorted asset lock, `openSettlement`, `settleUnits` before the log, the
 * RETURN log tagged as the settlement says, then `commitSettlement`. A
 * LEGACY group gets the log exactly as the pre-sources path writes it.
 *
 * @param tx - The check-in transaction.
 * @param args - What comes back, and the machine's adoption flag.
 * @returns Whether the group stayed LEGACY for this check-in.
 */
async function checkInWithFacade(
  tx: TxClient,
  args: FacadeCheckIn
): Promise<{ legacy: boolean }> {
  const { pool, bookingId, sliceId } = args;
  await lockBooking(tx, pool, bookingId);
  await args.onLocked?.();
  await lockPool(tx, pool);
  const settlement = await openSettlement(tx, {
    organizationId: pool.organizationId,
    bookingId,
    assetIds: [pool.assetId],
    assetsLocked: true,
    adoptionEnabled: args.adoptionEnabled,
  });
  const settled = settleUnits(settlement, {
    sliceId,
    assetId: pool.assetId,
    returned: args.returned,
  });
  await insertLog(tx, {
    pool,
    category: "RETURN",
    quantity: args.returned,
    bookingId,
    bookingAssetId: settled.legacy ? sliceId : settled.bookingAssetId,
    locationId: settled.legacy ? shelfA(pool) : settled.returnLocationId,
  });
  await commitSettlement(tx, settlement);
  return { legacy: settled.legacy };
}

/**
 * Seeds an ONGOING booking with one LEGACY standalone slice of 6 units, all
 * checked out from "Shelf A" the pre-sources way (`sourceLocationId`).
 *
 * @param tx - Transaction client.
 * @param pool - The pool.
 * @returns The booking and slice ids.
 */
async function seedLegacyOngoing(
  tx: TxClient,
  pool: SeededOrgWithPool
): Promise<{ bookingId: string; sliceId: string }> {
  const window = currentWindow();
  const booking = await seedBooking(tx, {
    organizationId: pool.organizationId,
    userId: pool.userId,
    status: "ONGOING",
    from: window.from,
    to: window.to,
    slices: [
      {
        assetId: pool.assetId,
        quantity: 6,
        checkedOutQuantity: 6,
        sourceLocationId: shelfA(pool),
      },
    ],
  });
  const sliceId = sliceAt(booking.sliceIds);
  await stampCheckedOut(tx, [sliceId], pool.userId);
  return { bookingId: booking.bookingId, sliceId };
}

/**
 * Replays a pre-sources check-out of whole slices, statement by statement:
 * booking lock, per-asset lock, asset status, the recorded source on slices
 * still at 0, the check-out stamp, the cumulative counter, the stale
 * check-in marker reset and the booking status.
 *
 * @param tx - Transaction client.
 * @param args.pool - The pool.
 * @param args.bookingId - The booking checking out.
 * @param args.slices - Departing slices with their booked quantity.
 */
async function replayLegacyCheckout(
  tx: TxClient,
  args: {
    pool: SeededOrgWithPool;
    bookingId: string;
    slices: Array<{ id: string; quantity: number }>;
  }
): Promise<void> {
  const { pool, bookingId } = args;
  await lockBooking(tx, pool, bookingId);
  await tx.$queryRaw`
    SELECT * FROM "Asset"
    WHERE id = ${pool.assetId} AND "organizationId" = ${pool.organizationId}
    FOR UPDATE
  `;
  await tx.$executeRaw`
    UPDATE "Asset" SET "status" = 'CHECKED_OUT'
    WHERE id = ${pool.assetId} AND "organizationId" = ${pool.organizationId}
  `;
  for (const slice of args.slices) {
    await tx.$executeRaw`
      UPDATE "BookingAsset" SET "sourceLocationId" = ${shelfA(pool)}
      WHERE "id" = ${slice.id} AND "checkedOutQuantity" = 0
    `;
    await tx.$executeRaw`
      UPDATE "BookingAsset"
      SET "checkedOutAt" = now(), "checkedOutById" = ${pool.userId},
          "checkedInAt" = NULL, "checkedInById" = NULL
      WHERE "id" = ${slice.id}
    `;
    await tx.$executeRaw`
      UPDATE "BookingAsset"
      SET "checkedOutQuantity" = "checkedOutQuantity" + ${slice.quantity}::int
      WHERE "id" = ${slice.id}
    `;
  }
  await tx.$executeRaw`
    UPDATE "BookingAsset" SET "checkedInAt" = NULL, "checkedInById" = NULL
    WHERE "bookingId" = ${bookingId}
      AND "checkedOutAt" IS NOT NULL AND "checkedInAt" IS NOT NULL
  `;
  await tx.$executeRaw`
    UPDATE "Booking" SET "status" = 'ONGOING', "updatedAt" = now()
    WHERE id = ${bookingId} AND "organizationId" = ${pool.organizationId}
  `;
}

/**
 * Inserts the `PartialBookingCheckin` session row a check-in session writes.
 *
 * @param tx - Transaction client.
 * @param args.pool - The pool (its owner checks in).
 * @param args.bookingId - The booking.
 * @param args.reconciledAssetIds - Assets fully reconciled in the session.
 */
async function insertCheckinSession(
  tx: TxClient,
  args: {
    pool: SeededOrgWithPool;
    bookingId: string;
    reconciledAssetIds: string[];
  }
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "PartialBookingCheckin" (
      "id", "assetIds", "checkinCount", "bookingId", "checkedInById",
      "updatedAt"
    ) VALUES (
      ${randomUUID()}, ${args.reconciledAssetIds}::text[],
      ${args.reconciledAssetIds.length}::int, ${args.bookingId},
      ${args.pool.userId}, now()
    )
  `;
}

/**
 * Runs two transactions that are open at the same time, `first` holding the
 * booking lock before `second` starts. `second` waits on that lock in the
 * database, so it reads what `first` committed. `first` keeps its lock a
 * moment so `second` is queued on it, not merely started later.
 *
 * @param first - Takes the booking lock and calls `locked()` right after.
 * @param second - Starts once `first` holds the lock.
 * @returns Both outcomes.
 */
async function runWhileLocked(
  first: (tx: TxClient, locked: () => Promise<void>) => Promise<void>,
  second: (tx: TxClient) => Promise<void>
) {
  let signal: () => void = () => undefined;
  const firstHoldsLock = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const firstRun = commitAndExpect(async (tx) => {
    try {
      await first(tx, async () => {
        signal();
        // Gives `second` time to reach the booking lock and queue on it.
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
    } finally {
      // Never leave `second` waiting on a signal that will not come.
      signal();
    }
  });
  await firstHoldsLock;
  const secondRun = commitAndExpect(second);
  const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
  return { firstResult, secondResult };
}

describe("booking source rollout", () => {
  describe("a binary from before deploy 1 on the migrated schema", () => {
    it("checks out a LEGACY slice exactly as before", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const window = currentWindow();
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: window.from,
          to: window.to,
          slices: [{ assetId: pool.assetId, quantity: 6 }],
        });
        return {
          pool,
          bookingId: booking.bookingId,
          sliceId: sliceAt(booking.sliceIds),
        };
      });

      try {
        const result = await commitAndExpect((tx) =>
          replayLegacyCheckout(tx, {
            pool: seeded.pool,
            bookingId: seeded.bookingId,
            slices: [{ id: seeded.sliceId, quantity: 6 }],
          })
        );
        expect(result).toEqual({ ok: true });

        const slice = await getTestDb().bookingAsset.findUnique({
          where: { id: seeded.sliceId },
          select: {
            sourceAllocation: true,
            sourcesConvertedAt: true,
            checkedOutQuantity: true,
            sourceLocationId: true,
          },
        });
        expect(slice).toEqual({
          sourceAllocation: "LEGACY",
          sourcesConvertedAt: null,
          checkedOutQuantity: 6,
          sourceLocationId: shelfA(seeded.pool),
        });
        await expectNoSourceState(seeded.bookingId);
      } finally {
        await cleanup([seeded.pool]);
      }
    });

    it("partially checks in a LEGACY slice, returns and used-up units, exactly as before", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const booking = await seedLegacyOngoing(tx, pool);
        return { pool, ...booking };
      });

      try {
        const { pool, bookingId, sliceId } = seeded;
        const result = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await lockPool(tx, pool);
          // 2 returned to the place they left from, tagged with the slice.
          await insertLog(tx, {
            pool,
            category: "RETURN",
            quantity: 2,
            bookingId,
            bookingAssetId: sliceId,
            locationId: shelfA(pool),
          });
          // 1 used up: the pool shrinks and the stock ledger starts, with an
          // opening balance per place and the CONSUME row of the event.
          await tx.$executeRaw`
            UPDATE "Asset" SET "quantity" = "quantity" - 1
            WHERE id = ${pool.assetId}
          `;
          await tx.$executeRaw`
            UPDATE "Asset" SET "stockLedgerStartedAt" = NOW()
            WHERE id = ${pool.assetId}
              AND "organizationId" = ${pool.organizationId}
          `;
          await insertLog(tx, {
            pool,
            category: "OPENING_BALANCE",
            quantity: 10,
            bookingId: null,
            locationId: shelfA(pool),
            stockChange: 10,
          });
          await insertLog(tx, {
            pool,
            category: "OPENING_BALANCE",
            quantity: 10,
            bookingId: null,
            stockChange: 10,
          });
          await insertLog(tx, {
            pool,
            category: "CONSUME",
            quantity: 1,
            bookingId,
            bookingAssetId: sliceId,
            stockChange: -1,
          });
          await insertCheckinSession(tx, {
            pool,
            bookingId,
            reconciledAssetIds: [],
          });
        });
        expect(result).toEqual({ ok: true });

        const slice = await readSlice(sliceId);
        expect(slice).toMatchObject({
          mode: "LEGACY",
          converted: false,
          checkedOutQuantity: 6,
          rows: [],
        });
        await expectNoSourceState(bookingId);
      } finally {
        await cleanup([seeded.pool]);
      }
    });

    it("returns one untagged log over a standalone and a kit slice, then completes, exactly as before", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const assetKitId = await seedKit(tx, pool, 5);
        const window = currentWindow();
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: window.from,
          to: window.to,
          slices: [
            {
              assetId: pool.assetId,
              quantity: 5,
              checkedOutQuantity: 5,
              sourceLocationId: shelfA(pool),
            },
            {
              assetId: pool.assetId,
              quantity: 5,
              checkedOutQuantity: 5,
              assetKitId,
            },
          ],
        });
        await stampCheckedOut(tx, booking.sliceIds, pool.userId);
        return { pool, ...booking };
      });

      try {
        const { pool, bookingId, sliceIds } = seeded;
        const result = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await lockPool(tx, pool);
          // An older phone names no slice and no place: 8 of the 10 come back.
          await insertLog(tx, {
            pool,
            category: "RETURN",
            quantity: 8,
            bookingId,
          });
          await insertLog(tx, {
            pool,
            category: "RETURN",
            quantity: 2,
            bookingId,
          });
          await insertCheckinSession(tx, {
            pool,
            bookingId,
            reconciledAssetIds: [pool.assetId],
          });
          for (const sliceId of sliceIds) {
            await tx.$executeRaw`
              UPDATE "BookingAsset"
              SET "checkedInAt" = now(), "checkedInById" = ${pool.userId}
              WHERE "id" = ${sliceId} AND "checkedOutAt" IS NOT NULL
                AND "checkedInAt" IS NULL
            `;
          }
          await tx.$executeRaw`
            UPDATE "Booking" SET "status" = 'COMPLETE', "updatedAt" = now()
            WHERE id = ${bookingId} AND "organizationId" = ${pool.organizationId}
          `;
        });
        expect(result).toEqual({ ok: true });

        for (const sliceId of sliceIds) {
          expect(await readSlice(sliceId)).toMatchObject({
            mode: "LEGACY",
            converted: false,
            rows: [],
          });
        }
        await expectNoSourceState(bookingId);
      } finally {
        await cleanup([seeded.pool]);
      }
    });
  });

  describe("rollback floor", () => {
    it("the same writer fails at COMMIT on a converted group and still commits on a LEGACY group of the asset", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const converted = await seedLegacyOngoing(tx, pool);
        const window = currentWindow();
        const legacy = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: window.from,
          to: window.to,
          slices: [{ assetId: pool.assetId, quantity: 2 }],
        });
        return {
          pool,
          converted,
          legacy: {
            bookingId: legacy.bookingId,
            sliceId: sliceAt(legacy.sliceIds),
          },
        };
      });

      try {
        const { pool, converted, legacy } = seeded;
        // A deploy 1 machine with adoption on converts the group at check-in.
        const conversion = await commitAndExpect(async (tx) => {
          const outcome = await checkInWithFacade(tx, {
            pool,
            ...converted,
            returned: 1,
            adoptionEnabled: true,
          });
          expect(outcome.legacy).toBe(false);
        });
        expect(conversion).toEqual({ ok: true });
        expect((await readSlice(converted.sliceId)).mode).toBe("AUTO");

        // The older binary returns a unit on the converted group: its log
        // has no share, so the contract rejects the whole transaction.
        const oldWriterOnConverted = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, converted.bookingId);
          await lockPool(tx, pool);
          await insertLog(tx, {
            pool,
            category: "RETURN",
            quantity: 1,
            bookingId: converted.bookingId,
          });
        });
        expect(oldWriterOnConverted.ok).toBe(false);
        if (!oldWriterOnConverted.ok) {
          expect(oldWriterOnConverted.message).toContain(
            "booking_source_check_9:"
          );
        }

        // The same binary checking out a LEGACY booking of the same asset
        // still commits: the contract is per (booking, asset) group.
        const oldWriterOnLegacy = await commitAndExpect((tx) =>
          replayLegacyCheckout(tx, {
            pool,
            bookingId: legacy.bookingId,
            slices: [{ id: legacy.sliceId, quantity: 2 }],
          })
        );
        expect(oldWriterOnLegacy).toEqual({ ok: true });
        expect(await readSlice(legacy.sliceId)).toMatchObject({
          mode: "LEGACY",
          checkedOutQuantity: 2,
          rows: [],
        });
      } finally {
        await cleanup([seeded.pool]);
      }
    });
  });

  describe("adoption flag on, then off", () => {
    it("keeps a converted group maintained through resize, kit add, check-out and check-in with the flag off", async () => {
      const window = currentWindow();
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const assetKitId = await seedKit(tx, pool, 3);
        const converting = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: window.from,
          to: window.to,
          slices: [{ assetId: pool.assetId, quantity: 6 }],
        });
        const untouched = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: window.from,
          to: window.to,
          slices: [],
        });
        return {
          pool,
          assetKitId,
          bookingId: converting.bookingId,
          sliceId: sliceAt(converting.sliceIds),
          untouchedBookingId: untouched.bookingId,
        };
      });

      try {
        const { pool, bookingId, sliceId } = seeded;
        const base = {
          organizationId: pool.organizationId,
          bookingId,
          window,
        };

        // Flag on: raising the quantity converts the LEGACY group.
        const raise = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await resizeSlices(tx, {
            ...base,
            changes: [{ sliceId, quantity: 8 }],
            adoptionEnabled: true,
          });
          await tx.$executeRaw`
            UPDATE "BookingAsset" SET "quantity" = 8 WHERE "id" = ${sliceId}
          `;
        });
        expect(raise).toEqual({ ok: true });
        const afterRaise = await readSlice(sliceId);
        expect(afterRaise.mode).toBe("AUTO");
        expect(afterRaise.converted).toBe(true);
        expect(sumRows(afterRaise, "quantity")).toBe(8);

        // Flag off from here on. Lowering the quantity still resizes the rows.
        const lower = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await resizeSlices(tx, {
            ...base,
            changes: [{ sliceId, quantity: 5 }],
            adoptionEnabled: false,
          });
          await tx.$executeRaw`
            UPDATE "BookingAsset" SET "quantity" = 5 WHERE "id" = ${sliceId}
          `;
        });
        expect(lower).toEqual({ ok: true });
        const afterLower = await readSlice(sliceId);
        expect(afterLower.mode).toBe("AUTO");
        expect(sumRows(afterLower, "quantity")).toBe(5);

        // A kit slice added to the converted group is created KIT.
        const kitSliceId = randomUUID();
        const addKit = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await tx.$executeRaw`
            INSERT INTO "BookingAsset" (
              "id", "bookingId", "assetId", "quantity", "assetKitId"
            ) VALUES (
              ${kitSliceId}, ${bookingId}, ${pool.assetId}, 3,
              ${seeded.assetKitId}
            )
          `;
          await allocateNewSlices(tx, {
            ...base,
            sliceIds: [kitSliceId],
            holdsNow: true,
            adoptionEnabled: false,
          });
        });
        expect(addKit).toEqual({ ok: true });
        const kitSlice = await readSlice(kitSliceId);
        expect(kitSlice.mode).toBe("KIT");
        expect(kitSlice.rows).toEqual([
          expect.objectContaining({ kind: "KIT", quantity: 3 }),
        ]);

        // A slice added to a booking with no converted group stays LEGACY.
        const legacySliceId = randomUUID();
        const addLegacy = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, seeded.untouchedBookingId);
          await tx.$executeRaw`
            INSERT INTO "BookingAsset" ("id", "bookingId", "assetId", "quantity")
            VALUES (${legacySliceId}, ${seeded.untouchedBookingId},
                    ${pool.assetId}, 2)
          `;
          await allocateNewSlices(tx, {
            organizationId: pool.organizationId,
            bookingId: seeded.untouchedBookingId,
            window,
            sliceIds: [legacySliceId],
            holdsNow: true,
            adoptionEnabled: false,
          });
        });
        expect(addLegacy).toEqual({ ok: true });
        expect(await readSlice(legacySliceId)).toMatchObject({
          mode: "LEGACY",
          rows: [],
        });

        // Check-out of the standalone slice dispatches from its rows.
        const checkout = await commitAndExpect(async (tx) => {
          await lockBooking(tx, pool, bookingId);
          await lockPool(tx, pool);
          const result = await dispatchUnits(tx, {
            ...base,
            picks: [{ sliceId, units: 5 }],
            adoptionEnabled: false,
          });
          expect(result.legacySliceIds).toEqual([]);
          await tx.$executeRaw`
            UPDATE "BookingAsset"
            SET "checkedOutQuantity" = "checkedOutQuantity" + 5,
                "checkedOutAt" = now(), "checkedOutById" = ${pool.userId}
            WHERE "id" = ${sliceId}
          `;
          await tx.$executeRaw`
            UPDATE "Booking" SET "status" = 'ONGOING', "updatedAt" = now()
            WHERE id = ${bookingId}
          `;
        });
        expect(checkout).toEqual({ ok: true });
        const afterCheckout = await readSlice(sliceId);
        expect(sumRows(afterCheckout, "outQuantity")).toBe(5);
        expect(sumRows(afterCheckout, "dispatchedTotal")).toBe(5);

        // Check-in of 2 settles on the rows and shares the log.
        const checkin = await commitAndExpect(async (tx) => {
          const outcome = await checkInWithFacade(tx, {
            pool,
            bookingId,
            sliceId,
            returned: 2,
            adoptionEnabled: false,
          });
          expect(outcome.legacy).toBe(false);
        });
        expect(checkin).toEqual({ ok: true });
        const afterCheckin = await readSlice(sliceId);
        expect(afterCheckin.mode).toBe("AUTO");
        expect(sumRows(afterCheckin, "quantity")).toBe(5);
        expect(sumRows(afterCheckin, "outQuantity")).toBe(3);
        expect(sumRows(afterCheckin, "releasedQuantity")).toBe(2);
        expect(sumRows(afterCheckin, "dispatchedTotal")).toBe(5);
        expect(await readLogCoverage(bookingId)).toEqual([
          { quantity: 2, shared: 2 },
        ]);
      } finally {
        await cleanup([seeded.pool]);
      }
    });
  });

  describe("mixed flag values in concurrent transactions", () => {
    /** Final state both orders must reach: 6 out from A, 3 back. */
    async function expectSettledGroup(seeded: {
      pool: SeededOrgWithPool;
      bookingId: string;
      sliceId: string;
    }) {
      const slice = await readSlice(seeded.sliceId);
      expect(slice.mode).toBe("AUTO");
      expect(slice.rows).toEqual([
        {
          kind: "LOCATION",
          locationId: shelfA(seeded.pool),
          quantity: 6,
          outQuantity: 3,
          releasedQuantity: 3,
          dispatchedTotal: 6,
        },
      ]);
      const coverage = await readLogCoverage(seeded.bookingId);
      expect(coverage).toEqual([
        { quantity: 1, shared: 1 },
        { quantity: 2, shared: 2 },
      ]);
    }

    it("flag on converts, then a flag-off machine queued on the booking lock maintains the group", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        return { pool, ...(await seedLegacyOngoing(tx, pool)) };
      });

      try {
        const target = {
          pool: seeded.pool,
          bookingId: seeded.bookingId,
          sliceId: seeded.sliceId,
        };
        const legacyByOrder: boolean[] = [];
        const { firstResult, secondResult } = await runWhileLocked(
          async (tx, locked) => {
            const outcome = await checkInWithFacade(tx, {
              ...target,
              returned: 2,
              adoptionEnabled: true,
              onLocked: locked,
            });
            legacyByOrder.push(outcome.legacy);
          },
          async (tx) => {
            const outcome = await checkInWithFacade(tx, {
              ...target,
              returned: 1,
              adoptionEnabled: false,
            });
            legacyByOrder.push(outcome.legacy);
          }
        );
        expect(firstResult).toEqual({ ok: true });
        expect(secondResult).toEqual({ ok: true });
        // The flag-off machine found the group converted and settled on rows.
        expect(legacyByOrder).toEqual([false, false]);
        await expectSettledGroup(target);
      } finally {
        await cleanup([seeded.pool]);
      }
    });

    it("a flag-off machine writes the LEGACY way, then a flag-on machine queued behind it converts with that log seeded", async () => {
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        return { pool, ...(await seedLegacyOngoing(tx, pool)) };
      });

      try {
        const target = {
          pool: seeded.pool,
          bookingId: seeded.bookingId,
          sliceId: seeded.sliceId,
        };
        const legacyByOrder: boolean[] = [];
        const { firstResult, secondResult } = await runWhileLocked(
          async (tx, locked) => {
            const outcome = await checkInWithFacade(tx, {
              ...target,
              returned: 1,
              adoptionEnabled: false,
              onLocked: locked,
            });
            legacyByOrder.push(outcome.legacy);
          },
          async (tx) => {
            const outcome = await checkInWithFacade(tx, {
              ...target,
              returned: 2,
              adoptionEnabled: true,
            });
            legacyByOrder.push(outcome.legacy);
          }
        );
        expect(firstResult).toEqual({ ok: true });
        expect(secondResult).toEqual({ ok: true });
        // First: LEGACY group, adoption off. Second: converted on arrival.
        expect(legacyByOrder).toEqual([true, false]);
        await expectSettledGroup(target);

        // The flag-off machine's log was seeded at conversion, the flag-on
        // machine's own log recorded by its settlement.
        const origins = await getTestDb().bookingDispositionShare.findMany({
          where: { bookingId: seeded.bookingId },
          select: { origin: true, quantity: true },
          orderBy: { quantity: "asc" },
        });
        expect(origins).toEqual([
          { origin: "SEEDED", quantity: 1 },
          { origin: "RECORDED", quantity: 2 },
        ]);
      } finally {
        await cleanup([seeded.pool]);
      }
    });

    it("flag on and flag off on two bookings of one asset at the same time leave one group converted and one LEGACY", async () => {
      const window = currentWindow();
      const seeded = await commitSeed(async (tx) => {
        const pool = await seedPool(tx);
        const bookings: Array<{ bookingId: string; sliceId: string }> = [];
        for (let i = 0; i < 2; i += 1) {
          const booking = await seedBooking(tx, {
            organizationId: pool.organizationId,
            userId: pool.userId,
            status: "RESERVED",
            from: window.from,
            to: window.to,
            slices: [{ assetId: pool.assetId, quantity: 3 }],
          });
          bookings.push({
            bookingId: booking.bookingId,
            sliceId: sliceAt(booking.sliceIds),
          });
        }
        const [on, off] = bookings;
        if (!on || !off) throw new Error("expected two bookings");
        return { pool, on, off };
      });

      try {
        const { pool, on, off } = seeded;
        /**
         * One deploy 1 resize to 4 units on a booking, with the machine's
         * adoption flag.
         */
        const resizeTo4 = (
          target: { bookingId: string; sliceId: string },
          adoptionEnabled: boolean
        ) =>
          commitAndExpect(async (tx) => {
            await lockBooking(tx, pool, target.bookingId);
            await resizeSlices(tx, {
              organizationId: pool.organizationId,
              bookingId: target.bookingId,
              window,
              changes: [{ sliceId: target.sliceId, quantity: 4 }],
              adoptionEnabled,
            });
            await tx.$executeRaw`
              UPDATE "BookingAsset" SET "quantity" = 4
              WHERE "id" = ${target.sliceId}
            `;
          });

        const [onResult, offResult] = await Promise.all([
          resizeTo4(on, true),
          resizeTo4(off, false),
        ]);
        expect(onResult).toEqual({ ok: true });
        expect(offResult).toEqual({ ok: true });

        const converted = await readSlice(on.sliceId);
        expect(converted.mode).toBe("AUTO");
        expect(sumRows(converted, "quantity")).toBe(4);
        expect(await readSlice(off.sliceId)).toMatchObject({
          mode: "LEGACY",
          quantity: 4,
          rows: [],
        });
        await expectNoSourceState(off.bookingId);
      } finally {
        await cleanup([seeded.pool]);
      }
    });
  });
});
