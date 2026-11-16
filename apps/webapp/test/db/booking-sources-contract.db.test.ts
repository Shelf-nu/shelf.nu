/**
 * Booking source contract: deferred trigger checks
 *
 * Pins the deferred constraint triggers that check the booking source
 * contract at COMMIT against a real database. Each check (1 to 10) gets a
 * transaction whose final state breaks exactly that check, asserted through
 * the `booking_source_check_<n>` prefix of the error. The remaining cases pin
 * what must keep committing: all-LEGACY groups, orphaned shares with
 * identical tuples, violations that are repaired before COMMIT, deleting a
 * booking with many shares, and the writes an older binary makes against
 * unconverted groups.
 *
 * A failing transaction rolls back, so those tests seed and break the data
 * in one transaction and leave nothing behind. Tests that commit clean up
 * their workspaces in `finally`.
 *
 * Runs only under `vitest.db.config.ts` (CI "Database tests" job).
 *
 * @see {@link file://./../../../../packages/database/prisma/migrations/20261112100100_booking_source_contract/migration.sql}
 * @see {@link file://./client.ts}
 * @see {@link file://./fixtures.ts}
 */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { CommitResult, TxClient } from "./client";
import { commitAndExpect, disconnectTestDb, getTestDb } from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedBooking, seedOrgWithPool } from "./fixtures";

/** `BookingSourceKind` values, as written in raw SQL. */
type SourceKind = "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED" | "KIT";

/** Non-LEGACY `BookingSourceAllocation` values. */
type ConvertedMode = "KIT" | "AUTO" | "MANUAL";

/** A booking window in the future, shared by every seeded booking. */
const FROM = new Date("2030-01-01T09:00:00Z");
const TO = new Date("2030-01-02T09:00:00Z");

afterAll(async () => {
  await disconnectTestDb();
});

/**
 * Seeds a workspace with a 1000-unit pool and one 10-unit placement.
 *
 * @param tx - Transaction client to write with.
 * @returns The workspace, asset, location and user ids.
 */
function seedPool(tx: TxClient): Promise<SeededOrgWithPool> {
  return seedOrgWithPool(tx, {
    total: 1000,
    placements: [{ name: "Shelf A", quantity: 10 }],
  });
}

/**
 * Returns the only slice id of a seeded booking.
 *
 * @param sliceIds - Slice ids returned by `seedBooking`.
 * @returns The first slice id.
 * @throws {Error} When the booking has no slice.
 */
function firstSlice(sliceIds: string[]): string {
  const [sliceId] = sliceIds;
  if (!sliceId) {
    throw new Error("seedBooking returned no slice");
  }
  return sliceId;
}

/**
 * Converts a slice: sets its mode and stamps `sourcesConvertedAt`.
 *
 * @param tx - Transaction client to write with.
 * @param sliceId - The slice to convert.
 * @param mode - The non-LEGACY mode to set.
 */
async function convertSlice(
  tx: TxClient,
  sliceId: string,
  mode: ConvertedMode
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "BookingAsset"
    SET "sourceAllocation" = ${mode}::"BookingSourceAllocation",
        "sourcesConvertedAt" = now()
    WHERE "id" = ${sliceId}
  `;
}

/** Values for {@link insertSource}. */
type SourceInput = {
  organizationId: string;
  sliceId: string;
  kind: SourceKind;
  /** Set for LOCATION rows only. */
  locationId?: string | null;
  quantity: number;
  outQuantity?: number;
  releasedQuantity?: number;
  dispatchedTotal?: number;
};

/**
 * Inserts a `BookingAssetSource` row.
 *
 * @param tx - Transaction client to write with.
 * @param input - Row values; counters default to 0.
 * @returns The new row id.
 */
async function insertSource(tx: TxClient, input: SourceInput): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "BookingAssetSource" (
      "id", "organizationId", "bookingAssetId", "kind", "locationId",
      "quantity", "outQuantity", "releasedQuantity", "dispatchedTotal",
      "updatedAt"
    ) VALUES (
      ${id}, ${input.organizationId}, ${input.sliceId},
      ${input.kind}::"BookingSourceKind", ${input.locationId ?? null},
      ${input.quantity}::int, ${input.outQuantity ?? 0}::int,
      ${input.releasedQuantity ?? 0}::int, ${input.dispatchedTotal ?? 0}::int,
      now()
    )
  `;
  return id;
}

/** Values for {@link insertReturnLog}. */
type LogInput = {
  assetId: string;
  userId: string;
  bookingId: string;
  /** The slice the writer attributed the log to, if any. */
  sliceId?: string | null;
  quantity: number;
};

/**
 * Inserts a RETURN `ConsumptionLog` on a booking.
 *
 * @param tx - Transaction client to write with.
 * @param input - Log values.
 * @returns The new log id.
 */
async function insertReturnLog(tx: TxClient, input: LogInput): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "ConsumptionLog" (
      "id", "assetId", "category", "quantity", "userId", "bookingId",
      "bookingAssetId"
    ) VALUES (
      ${id}, ${input.assetId}, 'RETURN', ${input.quantity}::int,
      ${input.userId}, ${input.bookingId}, ${input.sliceId ?? null}
    )
  `;
  return id;
}

/** Values for {@link insertShare}. */
type ShareInput = {
  organizationId: string;
  logId: string;
  bookingId: string;
  assetId: string;
  /** NULL for an orphaned share. */
  sliceId: string | null;
  sourceId: string | null;
  quantity: number;
};

/**
 * Inserts a RECORDED `BookingDispositionShare`.
 *
 * @param tx - Transaction client to write with.
 * @param input - Share values.
 * @returns The new share id.
 */
async function insertShare(tx: TxClient, input: ShareInput): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "BookingDispositionShare" (
      "id", "organizationId", "consumptionLogId", "bookingId", "assetId",
      "bookingAssetId", "bookingAssetSourceId", "quantity", "origin"
    ) VALUES (
      ${id}, ${input.organizationId}, ${input.logId}, ${input.bookingId},
      ${input.assetId}, ${input.sliceId}, ${input.sourceId},
      ${input.quantity}::int, 'RECORDED'
    )
  `;
  return id;
}

/** Ids of a group seeded by {@link seedConvertedGroup}. */
type ConvertedGroup = SeededOrgWithPool & {
  bookingId: string;
  sliceId: string;
  sourceId: string;
  logId: string;
  shareId: string;
};

/**
 * Seeds a valid converted group: an ONGOING booking with one AUTO slice of 4
 * units, all 4 checked out from one LOCATION row, 2 of them returned. The row
 * reads quantity 4, out 2, released 2, dispatched 4, and the RETURN log of 2
 * is fully shared onto it, so `4 - 2 = 2` reconciles.
 *
 * @param tx - Transaction client to write with.
 * @returns The ids of everything created.
 */
async function seedConvertedGroup(tx: TxClient): Promise<ConvertedGroup> {
  const pool = await seedPool(tx);
  const [locationId] = pool.locationIds;
  const booking = await seedBooking(tx, {
    organizationId: pool.organizationId,
    userId: pool.userId,
    status: "ONGOING",
    from: FROM,
    to: TO,
    slices: [{ assetId: pool.assetId, quantity: 4, checkedOutQuantity: 4 }],
  });
  const sliceId = firstSlice(booking.sliceIds);
  await convertSlice(tx, sliceId, "AUTO");
  const sourceId = await insertSource(tx, {
    organizationId: pool.organizationId,
    sliceId,
    kind: "LOCATION",
    locationId,
    quantity: 4,
    outQuantity: 2,
    releasedQuantity: 2,
    dispatchedTotal: 4,
  });
  const logId = await insertReturnLog(tx, {
    assetId: pool.assetId,
    userId: pool.userId,
    bookingId: booking.bookingId,
    sliceId,
    quantity: 2,
  });
  const shareId = await insertShare(tx, {
    organizationId: pool.organizationId,
    logId,
    bookingId: booking.bookingId,
    assetId: pool.assetId,
    sliceId,
    sourceId,
    quantity: 2,
  });
  return {
    ...pool,
    bookingId: booking.bookingId,
    sliceId,
    sourceId,
    logId,
    shareId,
  };
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
 * Asserts a transaction failed on the given contract check.
 *
 * @param result - Outcome of `commitAndExpect`.
 * @param check - The expected check number.
 */
function expectCheckFailure(result: CommitResult, check: number): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.message).toContain(`booking_source_check_${check}:`);
  }
}

describe("booking source contract", () => {
  it("check 1 downgrade AUTO to LEGACY fails", async () => {
    const seeded = await commitSeed(seedConvertedGroup);
    try {
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "sourceAllocation" = 'LEGACY'
          WHERE "id" = ${seeded.sliceId}
        `;
      });
      expectCheckFailure(result, 1);
    } finally {
      await cleanup([seeded]);
    }
  });

  it("check 1 requires sourcesConvertedAt on a converted slice", async () => {
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAsset" SET "sourcesConvertedAt" = NULL
        WHERE "id" = ${seeded.sliceId}
      `;
    });
    expectCheckFailure(result, 1);
  });

  it("check 2 LEGACY slice in a group with shares fails", async () => {
    // The only slice is LEGACY, but an orphaned share makes the group
    // converted.
    const result = await commitAndExpect(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 2, checkedOutQuantity: 2 }],
      });
      const logId = await insertReturnLog(tx, {
        assetId: pool.assetId,
        userId: pool.userId,
        bookingId: booking.bookingId,
        quantity: 2,
      });
      await insertShare(tx, {
        organizationId: pool.organizationId,
        logId,
        bookingId: booking.bookingId,
        assetId: pool.assetId,
        sliceId: null,
        sourceId: null,
        quantity: 2,
      });
    });
    expectCheckFailure(result, 2);
  });

  it("check 2 passes for all-LEGACY groups", async () => {
    const created: SeededOrgWithPool[] = [];
    try {
      const result = await commitAndExpect(async (tx) => {
        const pool = await seedPool(tx);
        created.push(pool);
        const kit = await tx.kit.create({
          data: {
            name: "Kit A",
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
            quantity: 3,
          },
          select: { id: true },
        });
        // A standalone and a kit slice of the same asset, both LEGACY, and an
        // untagged RETURN log with no shares.
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: FROM,
          to: TO,
          slices: [
            { assetId: pool.assetId, quantity: 2, checkedOutQuantity: 2 },
            {
              assetId: pool.assetId,
              quantity: 3,
              checkedOutQuantity: 3,
              assetKitId: assetKit.id,
            },
          ],
        });
        await insertReturnLog(tx, {
          assetId: pool.assetId,
          userId: pool.userId,
          bookingId: booking.bookingId,
          quantity: 4,
        });
      });
      expect(result).toEqual({ ok: true });
    } finally {
      await cleanup(created);
    }
  });

  it("check 3 LEGACY slice with a source row fails", async () => {
    const result = await commitAndExpect(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "RESERVED",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 4 }],
      });
      await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId: firstSlice(booking.sliceIds),
        kind: "UNPLACED",
        quantity: 4,
      });
    });
    expectCheckFailure(result, 3);
  });

  it("check 1 allows LEGACY to AUTO and back to LEGACY within one transaction", async () => {
    // The first-mode record of the LEGACY to AUTO update is 'LEGACY', so the
    // final LEGACY is not a downgrade.
    const created: SeededOrgWithPool[] = [];
    try {
      const result = await commitAndExpect(async (tx) => {
        const pool = await seedPool(tx);
        created.push(pool);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "RESERVED",
          from: FROM,
          to: TO,
          slices: [{ assetId: pool.assetId, quantity: 4 }],
        });
        const sliceId = firstSlice(booking.sliceIds);
        await convertSlice(tx, sliceId, "AUTO");
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "sourceAllocation" = 'LEGACY'
          WHERE "id" = ${sliceId}
        `;
      });
      expect(result).toEqual({ ok: true });
    } finally {
      await cleanup(created);
    }
  });

  it("check 2 LEGACY standalone slice next to a KIT slice of the same asset fails", async () => {
    // The group is converted only through its kit slice, so this pins the kit
    // half of the converted-group lookup.
    const result = await commitAndExpect(async (tx) => {
      const pool = await seedPool(tx);
      const kit = await tx.kit.create({
        data: {
          name: "Kit A",
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
          quantity: 3,
        },
        select: { id: true },
      });
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "RESERVED",
        from: FROM,
        to: TO,
        slices: [
          { assetId: pool.assetId, quantity: 2 },
          { assetId: pool.assetId, quantity: 3, assetKitId: assetKit.id },
        ],
      });
      const [, kitSliceId] = booking.sliceIds;
      if (!kitSliceId) {
        throw new Error("seedBooking returned no kit slice");
      }
      // A valid KIT slice: one KIT row planning all 3 units.
      await convertSlice(tx, kitSliceId, "KIT");
      await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId: kitSliceId,
        kind: "KIT",
        quantity: 3,
      });
    });
    expectCheckFailure(result, 2);
  });

  it("check 4 KIT slice with no assetKitId fails", async () => {
    const result = await commitAndExpect(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "RESERVED",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 3 }],
      });
      const sliceId = firstSlice(booking.sliceIds);
      await convertSlice(tx, sliceId, "KIT");
      await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId,
        kind: "KIT",
        quantity: 3,
      });
    });
    expectCheckFailure(result, 4);
  });

  it("check 4 kit/AUTO mismatch fails", async () => {
    // An AUTO slice may not carry a KIT row.
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAssetSource" SET "kind" = 'KIT', "locationId" = NULL
        WHERE "id" = ${seeded.sourceId}
      `;
    });
    expectCheckFailure(result, 4);
  });

  it("check 5 sum of row quantities must equal the booked quantity", async () => {
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAssetSource" SET "quantity" = 5
        WHERE "id" = ${seeded.sourceId}
      `;
    });
    expectCheckFailure(result, 5);
  });

  it("check 6 cross-org share fails", async () => {
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      const otherPool = await seedPool(tx);
      await tx.$executeRaw`
        UPDATE "BookingDispositionShare"
        SET "organizationId" = ${otherPool.organizationId}
        WHERE "id" = ${seeded.shareId}
      `;
    });
    expectCheckFailure(result, 6);
  });

  it("check 7 dispatched sum must equal checkedOutQuantity", async () => {
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAsset" SET "checkedOutQuantity" = 3
        WHERE "id" = ${seeded.sliceId}
      `;
    });
    expectCheckFailure(result, 7);
  });

  it("check 8 reconciliation and kind rules", async () => {
    // Reconciliation: dispatched 4 - shared 2 = 2, but out is 1.
    const reconciliation = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAssetSource"
        SET "outQuantity" = 1, "releasedQuantity" = 3
        WHERE "id" = ${seeded.sourceId}
      `;
    });
    expectCheckFailure(reconciliation, 8);

    // UNKNOWN: quantity must equal out and nothing released. Sums stay valid
    // (quantity 3 + 1 = 4, dispatched 4 + 0 = 4).
    const unknown = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAssetSource"
        SET "quantity" = 3, "releasedQuantity" = 1
        WHERE "id" = ${seeded.sourceId}
      `;
      await insertSource(tx, {
        organizationId: seeded.organizationId,
        sliceId: seeded.sliceId,
        kind: "UNKNOWN",
        quantity: 1,
        releasedQuantity: 1,
      });
    });
    expectCheckFailure(unknown, 8);

    // UNASSIGNED: never out, never dispatched. The LOCATION row gives up one
    // dispatched and one out unit so every sum and reconciliation still holds.
    const unassigned = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      await tx.$executeRaw`
        UPDATE "BookingAssetSource"
        SET "quantity" = 3, "outQuantity" = 1, "releasedQuantity" = 2,
            "dispatchedTotal" = 3
        WHERE "id" = ${seeded.sourceId}
      `;
      await insertSource(tx, {
        organizationId: seeded.organizationId,
        sliceId: seeded.sliceId,
        kind: "UNASSIGNED",
        quantity: 1,
        outQuantity: 1,
        dispatchedTotal: 1,
      });
    });
    expectCheckFailure(unassigned, 8);
  });

  it("check 9 partially shared log fails", async () => {
    const result = await commitAndExpect(async (tx) => {
      const seeded = await seedConvertedGroup(tx);
      const logId = await insertReturnLog(tx, {
        assetId: seeded.assetId,
        userId: seeded.userId,
        bookingId: seeded.bookingId,
        quantity: 3,
      });
      // One of the three units is shared (orphaned, so no row changes).
      await insertShare(tx, {
        organizationId: seeded.organizationId,
        logId,
        bookingId: seeded.bookingId,
        assetId: seeded.assetId,
        sliceId: null,
        sourceId: null,
        quantity: 1,
      });
    });
    expectCheckFailure(result, 9);
  });

  it("check 10 share naming source A of booking 1 and slice B of booking 2 fails", async () => {
    // Every other check holds on both sides: source A counts the share
    // (dispatched 1 - shared 1 = out 0) and booking 2's log is fully shared.
    // Whichever slice or group is checked first, check 10 rejects the share.
    const result = await commitAndExpect(async (tx) => {
      const pool = await seedPool(tx);
      const bookingOne = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 2, checkedOutQuantity: 1 }],
      });
      const sliceA = firstSlice(bookingOne.sliceIds);
      await convertSlice(tx, sliceA, "AUTO");
      const sourceA = await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId: sliceA,
        kind: "UNPLACED",
        quantity: 2,
        releasedQuantity: 1,
        dispatchedTotal: 1,
      });

      const bookingTwo = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 2 }],
      });
      const sliceB = firstSlice(bookingTwo.sliceIds);
      await convertSlice(tx, sliceB, "AUTO");
      await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId: sliceB,
        kind: "UNPLACED",
        quantity: 2,
      });

      const logId = await insertReturnLog(tx, {
        assetId: pool.assetId,
        userId: pool.userId,
        bookingId: bookingTwo.bookingId,
        sliceId: sliceB,
        quantity: 1,
      });
      await insertShare(tx, {
        organizationId: pool.organizationId,
        logId,
        bookingId: bookingTwo.bookingId,
        assetId: pool.assetId,
        sliceId: sliceB,
        sourceId: sourceA,
        quantity: 1,
      });
    });
    expectCheckFailure(result, 10);
  });

  it("orphaned shares with identical tuples are allowed", async () => {
    // One AUTO slice whose 4 returned units are split over two shares with
    // the same (log, slice, row) tuple. Deleting the slice orphans both into
    // identical (log, NULL, NULL) rows; the log stays fully shared.
    const seeded = await commitSeed(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [{ assetId: pool.assetId, quantity: 4, checkedOutQuantity: 4 }],
      });
      const sliceId = firstSlice(booking.sliceIds);
      await convertSlice(tx, sliceId, "AUTO");
      const sourceId = await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId,
        kind: "UNPLACED",
        quantity: 4,
        releasedQuantity: 4,
        dispatchedTotal: 4,
      });
      const logId = await insertReturnLog(tx, {
        assetId: pool.assetId,
        userId: pool.userId,
        bookingId: booking.bookingId,
        sliceId,
        quantity: 4,
      });
      for (let i = 0; i < 2; i++) {
        await insertShare(tx, {
          organizationId: pool.organizationId,
          logId,
          bookingId: booking.bookingId,
          assetId: pool.assetId,
          sliceId,
          sourceId,
          quantity: 2,
        });
      }
      return { ...pool, sliceId, logId };
    });

    try {
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          DELETE FROM "BookingAsset" WHERE "id" = ${seeded.sliceId}
        `;
      });
      expect(result).toEqual({ ok: true });

      const shares = await getTestDb().$queryRaw<
        Array<{
          bookingAssetId: string | null;
          bookingAssetSourceId: string | null;
          quantity: number;
        }>
      >`
        SELECT "bookingAssetId", "bookingAssetSourceId", "quantity"
        FROM "BookingDispositionShare"
        WHERE "consumptionLogId" = ${seeded.logId}
      `;
      expect(shares).toEqual([
        { bookingAssetId: null, bookingAssetSourceId: null, quantity: 2 },
        { bookingAssetId: null, bookingAssetSourceId: null, quantity: 2 },
      ]);
    } finally {
      await cleanup([seeded]);
    }
  });

  it("transient violations inside the transaction that end valid commit", async () => {
    const seeded = await commitSeed(seedConvertedGroup);
    try {
      const result = await commitAndExpect(async (tx) => {
        // Downgrade and restore the mode (check 1 compares first and final).
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "sourceAllocation" = 'LEGACY'
          WHERE "id" = ${seeded.sliceId}
        `;
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "sourceAllocation" = 'AUTO'
          WHERE "id" = ${seeded.sliceId}
        `;
        // Break and restore the planned sum (check 5).
        await tx.$executeRaw`
          UPDATE "BookingAssetSource" SET "quantity" = 5
          WHERE "id" = ${seeded.sourceId}
        `;
        await tx.$executeRaw`
          UPDATE "BookingAssetSource" SET "quantity" = 4
          WHERE "id" = ${seeded.sourceId}
        `;
        // Return one more unit: the log is unshared (check 9) and the row
        // unreconciled (check 8) until the share and counters land.
        const logId = await insertReturnLog(tx, {
          assetId: seeded.assetId,
          userId: seeded.userId,
          bookingId: seeded.bookingId,
          sliceId: seeded.sliceId,
          quantity: 1,
        });
        await tx.$executeRaw`
          UPDATE "BookingAssetSource"
          SET "outQuantity" = 1, "releasedQuantity" = 3
          WHERE "id" = ${seeded.sourceId}
        `;
        await insertShare(tx, {
          organizationId: seeded.organizationId,
          logId,
          bookingId: seeded.bookingId,
          assetId: seeded.assetId,
          sliceId: seeded.sliceId,
          sourceId: seeded.sourceId,
          quantity: 1,
        });
      });
      expect(result).toEqual({ ok: true });
    } finally {
      await cleanup([seeded]);
    }
  });

  it("booking delete with heavy shares commits", async () => {
    const LOGS = 100;
    const seeded = await commitSeed(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [
          {
            assetId: pool.assetId,
            quantity: LOGS * 2,
            checkedOutQuantity: LOGS * 2,
          },
        ],
      });
      const sliceId = firstSlice(booking.sliceIds);
      await convertSlice(tx, sliceId, "AUTO");
      const sourceId = await insertSource(tx, {
        organizationId: pool.organizationId,
        sliceId,
        kind: "UNPLACED",
        quantity: LOGS * 2,
        releasedQuantity: LOGS * 2,
        dispatchedTotal: LOGS * 2,
      });
      // Each RETURN log of 2 carries two shares of 1 on the same row.
      const logIds = Array.from({ length: LOGS }, () => randomUUID());
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
        data: logIds.flatMap((logId) =>
          [0, 1].map(() => ({
            organizationId: pool.organizationId,
            consumptionLogId: logId,
            bookingId: booking.bookingId,
            assetId: pool.assetId,
            bookingAssetId: sliceId,
            bookingAssetSourceId: sourceId,
            quantity: 1,
            origin: "SEEDED" as const,
          }))
        ),
      });
      return { ...pool, bookingId: booking.bookingId };
    });

    try {
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          DELETE FROM "Booking" WHERE "id" = ${seeded.bookingId}
        `;
      });
      expect(result).toEqual({ ok: true });

      const db = getTestDb();
      expect(
        await db.bookingDispositionShare.count({
          where: { bookingId: seeded.bookingId },
        })
      ).toBe(0);
      // The logs outlive the booking and lose their booking link.
      expect(
        await db.consumptionLog.count({
          where: { assetId: seeded.assetId, bookingId: null },
        })
      ).toBe(LOGS);
    } finally {
      await cleanup([seeded]);
    }
  });

  it("legacy writes (insert slice, update checkedOutQuantity, insert untagged RETURN log) commit unchanged", async () => {
    const seeded = await commitSeed(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [],
      });
      return { ...pool, bookingId: booking.bookingId };
    });

    try {
      const sliceId = randomUUID();
      // The writes a binary that knows nothing about source rows makes.
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "BookingAsset" ("id", "bookingId", "assetId", "quantity")
          VALUES (${sliceId}, ${seeded.bookingId}, ${seeded.assetId}, 5)
        `;
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "checkedOutQuantity" = 5
          WHERE "id" = ${sliceId}
        `;
        await insertReturnLog(tx, {
          assetId: seeded.assetId,
          userId: seeded.userId,
          bookingId: seeded.bookingId,
          quantity: 2,
        });
      });
      expect(result).toEqual({ ok: true });

      const db = getTestDb();
      const slice = await db.bookingAsset.findUnique({
        where: { id: sliceId },
        select: { sourceAllocation: true, sourcesConvertedAt: true },
      });
      expect(slice).toEqual({
        sourceAllocation: "LEGACY",
        sourcesConvertedAt: null,
      });
      expect(
        await db.bookingAssetSource.count({
          where: { bookingAssetId: sliceId },
        })
      ).toBe(0);
      expect(
        await db.bookingDispositionShare.count({
          where: { bookingId: seeded.bookingId },
        })
      ).toBe(0);
    } finally {
      await cleanup([seeded]);
    }
  });

  it("legacy writes on an unconverted group create no temp table", async () => {
    const created: SeededOrgWithPool[] = [];
    const tempTables: Array<{
      checked: string | null;
      firstMode: string | null;
    }> = [];
    try {
      const result = await commitAndExpect(async (tx) => {
        const pool = await seedPool(tx);
        created.push(pool);
        const booking = await seedBooking(tx, {
          organizationId: pool.organizationId,
          userId: pool.userId,
          status: "ONGOING",
          from: FROM,
          to: TO,
          slices: [],
        });
        const sliceId = randomUUID();
        await tx.$executeRaw`
          INSERT INTO "BookingAsset" ("id", "bookingId", "assetId", "quantity")
          VALUES (${sliceId}, ${booking.bookingId}, ${pool.assetId}, 5)
        `;
        await tx.$executeRaw`
          UPDATE "BookingAsset" SET "checkedOutQuantity" = 5
          WHERE "id" = ${sliceId}
        `;
        await insertReturnLog(tx, {
          assetId: pool.assetId,
          userId: pool.userId,
          bookingId: booking.bookingId,
          quantity: 2,
        });
        // Fire the deferred triggers now, so the temp tables they would
        // create are visible to the query below, inside the transaction.
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        const rows = await tx.$queryRaw<
          Array<{ checked: string | null; firstMode: string | null }>
        >`
          SELECT
            to_regclass('pg_temp.booking_source_checked')::text AS "checked",
            to_regclass('pg_temp.booking_source_first_mode')::text AS "firstMode"
        `;
        tempTables.push(...rows);
      });
      expect(result).toEqual({ ok: true });
      expect(tempTables).toEqual([{ checked: null, firstMode: null }]);
    } finally {
      await cleanup(created);
    }
  });

  it("a LEGACY slice inserted into a group that already has shares fails check 2", async () => {
    // Committed first, so the slice insert alone must bring the group check:
    // the booking has no slice, only a RETURN log fully covered by an
    // orphaned share, which makes the group converted.
    const seeded = await commitSeed(async (tx) => {
      const pool = await seedPool(tx);
      const booking = await seedBooking(tx, {
        organizationId: pool.organizationId,
        userId: pool.userId,
        status: "ONGOING",
        from: FROM,
        to: TO,
        slices: [],
      });
      const logId = await insertReturnLog(tx, {
        assetId: pool.assetId,
        userId: pool.userId,
        bookingId: booking.bookingId,
        quantity: 2,
      });
      await insertShare(tx, {
        organizationId: pool.organizationId,
        logId,
        bookingId: booking.bookingId,
        assetId: pool.assetId,
        sliceId: null,
        sourceId: null,
        quantity: 2,
      });
      return { ...pool, bookingId: booking.bookingId };
    });

    try {
      const result = await commitAndExpect(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "BookingAsset" ("id", "bookingId", "assetId", "quantity")
          VALUES (${randomUUID()}, ${seeded.bookingId}, ${seeded.assetId}, 2)
        `;
      });
      expectCheckFailure(result, 2);
    } finally {
      await cleanup([seeded]);
    }
  });
});
