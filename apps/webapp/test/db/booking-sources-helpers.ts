/**
 * Real-database helpers for the booking sources scenario, concurrency and
 * tenancy tests.
 *
 * Booking writers in the app lock the booking row, then call the booking
 * sources facade, then write the slice counters themselves. These helpers do
 * the same around the real facade functions, so a test reads like the
 * product path it covers: {@link checkOutUnits} is a check-out,
 * {@link checkInUnits} a check-in. Raw inserts ({@link insertSource},
 * {@link insertLog}, {@link insertShare}) seed states the services would have
 * reached through history, and {@link assertContractHolds} runs the deferred
 * contract checks by hand on the final state.
 *
 * Every helper passes `adoptionEnabled` explicitly, so no test depends on
 * the `BOOKING_SOURCES_ENABLED` environment variable.
 *
 * @see {@link file://./client.ts} the client and transaction helpers
 * @see {@link file://./fixtures.ts} the workspace and booking fixtures
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts} the facade
 */

import { randomUUID } from "node:crypto";

import type { BookingStatus } from "@shelf/database";

import {
  dispatchUnits,
  openSettlement,
  commitSettlement,
} from "~/modules/booking/sources/booking-sources.server";
import type {
  DispatchPick,
  DispatchResult,
} from "~/modules/booking/sources/booking-sources.server";
import { settleUnits } from "~/modules/booking/sources/settlement";
import type {
  SettledDisposition,
  SettlementDisposition,
} from "~/modules/booking/sources/settlement";

import type { TxClient } from "./client";
import { getTestDb, withRollback } from "./client";
import type { SeededOrgWithPool } from "./fixtures";

/** `BookingSourceKind` values, as written in raw SQL. */
export type SourceKind =
  | "LOCATION"
  | "UNPLACED"
  | "UNKNOWN"
  | "UNASSIGNED"
  | "KIT";

/** `BookingSourceAllocation` values. */
export type SourceMode = "LEGACY" | "KIT" | "AUTO" | "MANUAL";

/** Disposition categories a booking log can carry. */
export type DispositionCategory = "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";

/** A booking window, half-open `[from, to)`. */
export type TestWindow = { from: Date; to: Date };

/** A group key: one asset on one booking. */
export type TestGroup = { bookingId: string; assetId: string };

/**
 * A date `hours` from now (negative for the past).
 *
 * @param hours - Offset in hours.
 * @returns The date.
 */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Commits a transaction on the shared test client and returns its value.
 * Errors, including those raised by deferred triggers at COMMIT, are thrown.
 *
 * @param fn - Writes to commit.
 * @returns Whatever `fn` returned.
 */
export function commitTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return getTestDb().$transaction(fn, { timeout: 25_000 });
}

/**
 * Removes committed workspaces and their owners.
 *
 * Runs every delete even when one fails, so one stuck row does not leave the
 * rest behind, and logs each failure with the row it concerns. A leftover row
 * is harmless to other tests (each seeds its own workspace), but a failing
 * delete points at a cascade or trigger that blocks removing a workspace, so
 * it is reported, not swallowed. Callers that want to assert a clean removal
 * check the returned list.
 *
 * @param pools - Workspaces seeded by `seedOrgWithPool`.
 * @returns One message per failed delete; empty when everything was removed.
 */
export async function cleanupPools(
  pools: SeededOrgWithPool[]
): Promise<string[]> {
  const db = getTestDb();
  const failures: string[] = [];
  /** Runs one delete and records its error instead of throwing it. */
  const attempt = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (cause) {
      const message = `cleanupPools: could not delete ${what}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
      console.error(message);
      failures.push(message);
    }
  };
  for (const pool of pools) {
    await attempt(
      `Organization ${pool.organizationId}`,
      () => db.$executeRaw`
        DELETE FROM "Organization" WHERE "id" = ${pool.organizationId}
      `
    );
    await attempt(
      `User ${pool.userId}`,
      () => db.$executeRaw`
        DELETE FROM "User" WHERE "id" = ${pool.userId}
      `
    );
  }
  return failures;
}

/**
 * Takes the booking row lock, the first lock every booking writer takes.
 *
 * @param tx - Transaction client.
 * @param bookingId - The booking to lock.
 */
export async function lockBooking(
  tx: TxClient,
  bookingId: string
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE
  `;
}

/**
 * Returns the element at `index`, or fails loudly.
 *
 * @param items - Ids (or other values) returned by a fixture.
 * @param index - Position wanted.
 * @returns The element.
 * @throws {Error} When the list is shorter than expected.
 */
export function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (!item) {
    throw new Error(`Expected an element at position ${index}`);
  }
  return item;
}

/**
 * Creates a kit holding `quantity` units of the pool and returns the
 * `AssetKit` membership id a kit slice points at.
 *
 * @param tx - Transaction client.
 * @param pool - The seeded workspace and pool.
 * @param quantity - Units of the pool in the kit.
 * @returns The `AssetKit` id and the kit id.
 */
export async function seedKit(
  tx: TxClient,
  pool: SeededOrgWithPool,
  quantity: number
): Promise<{ assetKitId: string; kitId: string }> {
  const kit = await tx.kit.create({
    data: {
      name: "Kit",
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
  return { assetKitId: assetKit.id, kitId: kit.id };
}

/**
 * Creates a location with no placement, in the pool's workspace.
 *
 * @param tx - Transaction client.
 * @param pool - The seeded workspace.
 * @param name - The location name.
 * @returns The location id.
 */
export async function seedLocation(
  tx: TxClient,
  pool: SeededOrgWithPool,
  name: string
): Promise<string> {
  const location = await tx.location.create({
    data: {
      name,
      userId: pool.userId,
      organizationId: pool.organizationId,
    },
    select: { id: true },
  });
  return location.id;
}

/** Values for {@link addSlice}. */
export type AddSliceInput = {
  bookingId: string;
  assetId: string;
  quantity: number;
  assetKitId?: string | null;
  checkedOutQuantity?: number;
  sourceLocationId?: string | null;
};

/**
 * Adds a slice to an existing booking. It is LEGACY until the facade gives
 * it sources.
 *
 * @param tx - Transaction client.
 * @param input - Slice values.
 * @returns The new slice id.
 */
export async function addSlice(
  tx: TxClient,
  input: AddSliceInput
): Promise<string> {
  const slice = await tx.bookingAsset.create({
    data: {
      bookingId: input.bookingId,
      assetId: input.assetId,
      quantity: input.quantity,
      assetKitId: input.assetKitId ?? null,
      checkedOutQuantity: input.checkedOutQuantity ?? 0,
      sourceLocationId: input.sourceLocationId ?? null,
    },
    select: { id: true },
  });
  return slice.id;
}

/**
 * Sets a slice's mode and stamps `sourcesConvertedAt`, for raw seeds of
 * converted groups.
 *
 * @param tx - Transaction client.
 * @param sliceId - The slice.
 * @param mode - The mode to set.
 */
export async function setSliceMode(
  tx: TxClient,
  sliceId: string,
  mode: Exclude<SourceMode, "LEGACY">
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "BookingAsset"
    SET "sourceAllocation" = ${mode}::"BookingSourceAllocation",
        "sourcesConvertedAt" = now()
    WHERE "id" = ${sliceId}
  `;
}

/** Values for {@link insertSource}. */
export type SourceInput = {
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
 * @param tx - Transaction client.
 * @param input - Row values; counters default to 0.
 * @returns The new row id.
 */
export async function insertSource(
  tx: TxClient,
  input: SourceInput
): Promise<string> {
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

/** Values for {@link insertLog}. */
export type LogInput = {
  assetId: string;
  userId: string;
  bookingId: string;
  category?: DispositionCategory;
  /** The slice the writer attributed the log to, if any. */
  sliceId?: string | null;
  /** Where the stock left or arrived, if anywhere. */
  locationId?: string | null;
  quantity: number;
  /** Defaults to the transaction time. */
  createdAt?: Date;
};

/**
 * Inserts a disposition `ConsumptionLog` on a booking (RETURN by default),
 * the way a check-in writes it.
 *
 * @param tx - Transaction client.
 * @param input - Log values.
 * @returns The new log id.
 */
export async function insertLog(
  tx: TxClient,
  input: LogInput
): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "ConsumptionLog" (
      "id", "assetId", "category", "quantity", "userId", "bookingId",
      "bookingAssetId", "locationId", "createdAt"
    ) VALUES (
      ${id}, ${input.assetId},
      ${input.category ?? "RETURN"}::"ConsumptionCategory",
      ${input.quantity}::int, ${input.userId}, ${input.bookingId},
      ${input.sliceId ?? null}, ${input.locationId ?? null},
      COALESCE(${input.createdAt ?? null}::timestamptz, now())
    )
  `;
  return id;
}

/** Values for {@link insertShare}. */
export type ShareInput = {
  organizationId: string;
  logId: string;
  bookingId: string;
  assetId: string;
  /** NULL for an orphaned share. */
  sliceId: string | null;
  sourceId: string | null;
  quantity: number;
  origin?: "SEEDED" | "RECORDED" | "OVERFLOW";
};

/**
 * Inserts a `BookingDispositionShare` (RECORDED by default).
 *
 * @param tx - Transaction client.
 * @param input - Share values.
 * @returns The new share id.
 */
export async function insertShare(
  tx: TxClient,
  input: ShareInput
): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO "BookingDispositionShare" (
      "id", "organizationId", "consumptionLogId", "bookingId", "assetId",
      "bookingAssetId", "bookingAssetSourceId", "quantity", "origin"
    ) VALUES (
      ${id}, ${input.organizationId}, ${input.logId}, ${input.bookingId},
      ${input.assetId}, ${input.sliceId}, ${input.sourceId},
      ${input.quantity}::int,
      ${input.origin ?? "RECORDED"}::"DispositionShareOrigin"
    )
  `;
  return id;
}

/** A source row as the tests read it back. */
export type RowRead = {
  id: string;
  kind: SourceKind;
  locationId: string | null;
  quantity: number;
  outQuantity: number;
  releasedQuantity: number;
  dispatchedTotal: number;
};

/**
 * Reads a slice's source rows, ordered by kind then location.
 *
 * @param sliceId - The slice.
 * @param db - Client to read with; the shared test client by default.
 * @returns The rows.
 */
export function readRows(
  sliceId: string,
  db: TxClient = getTestDb()
): Promise<RowRead[]> {
  return db.$queryRaw<RowRead[]>`
    SELECT "id", "kind"::text AS "kind", "locationId", "quantity",
           "outQuantity", "releasedQuantity", "dispatchedTotal"
    FROM "BookingAssetSource"
    WHERE "bookingAssetId" = ${sliceId}
    ORDER BY "kind"::text, "locationId" NULLS FIRST
  `;
}

/**
 * Finds the row of a kind (and location) among a slice's rows.
 *
 * @param rows - Rows from {@link readRows}.
 * @param kind - The kind wanted.
 * @param locationId - The location, for a LOCATION row.
 * @returns The row.
 * @throws {Error} When no such row exists.
 */
export function rowOf(
  rows: RowRead[],
  kind: SourceKind,
  locationId: string | null = null
): RowRead {
  const row = rows.find((r) => r.kind === kind && r.locationId === locationId);
  if (!row) {
    throw new Error(
      `No ${kind} row${
        locationId ? ` at ${locationId}` : ""
      } in ${JSON.stringify(rows)}`
    );
  }
  return row;
}

/**
 * The counters of a row, without its id: what most assertions compare.
 *
 * @param row - A row from {@link readRows}.
 * @returns `[quantity, out, released, dispatched]`.
 */
export function countersOf(row: RowRead): [number, number, number, number] {
  return [
    row.quantity,
    row.outQuantity,
    row.releasedQuantity,
    row.dispatchedTotal,
  ];
}

/** A share as the tests read it back. */
export type ShareRead = {
  bookingAssetId: string | null;
  bookingAssetSourceId: string | null;
  quantity: number;
  origin: string;
};

/**
 * Reads the shares of one disposition log, largest first.
 *
 * @param logId - The log.
 * @returns The shares.
 */
export function readShares(logId: string): Promise<ShareRead[]> {
  return getTestDb().$queryRaw<ShareRead[]>`
    SELECT "bookingAssetId", "bookingAssetSourceId", "quantity",
           "origin"::text AS "origin"
    FROM "BookingDispositionShare"
    WHERE "consumptionLogId" = ${logId}
    ORDER BY "quantity" DESC, "bookingAssetId" NULLS LAST
  `;
}

/**
 * Reads a slice's mode and counters.
 *
 * @param sliceId - The slice.
 * @returns The slice, or null when it is gone.
 */
export async function readSlice(sliceId: string): Promise<{
  sourceAllocation: SourceMode;
  quantity: number;
  checkedOutQuantity: number;
} | null> {
  const slice = await getTestDb().bookingAsset.findUnique({
    where: { id: sliceId },
    select: {
      sourceAllocation: true,
      quantity: true,
      checkedOutQuantity: true,
    },
  });
  return slice;
}

/**
 * Runs the deferred contract checks (`check_booking_source_slice` and
 * `check_booking_source_group`) by hand on the committed state, in a
 * transaction that is rolled back. A violation raises, which fails the test
 * with the check's message.
 *
 * @param args.sliceIds - Slices to check (removed slices are skipped by the check).
 * @param args.groups - Groups to check.
 */
export async function assertContractHolds(args: {
  sliceIds: string[];
  groups: TestGroup[];
}): Promise<void> {
  await withRollback(async (tx) => {
    for (const sliceId of args.sliceIds) {
      await tx.$queryRaw<Array<{ checked: string | null }>>`
        SELECT check_booking_source_slice(${sliceId})::text AS "checked"
      `;
    }
    for (const group of args.groups) {
      await tx.$queryRaw<Array<{ checked: string | null }>>`
        SELECT check_booking_source_group(${group.bookingId}, ${group.assetId})::text AS "checked"
      `;
    }
  });
}

/**
 * Sum of units out on ONGOING and OVERDUE bookings at each manual placement
 * of a pool, next to what is placed there: the "no source over-occupied"
 * invariant compares the two.
 *
 * @param assetId - The pool.
 * @returns One entry per location with units placed or out.
 */
export function readOccupancy(
  assetId: string
): Promise<Array<{ locationId: string; placed: number; out: number }>> {
  return getTestDb().$queryRaw<
    Array<{ locationId: string; placed: number; out: number }>
  >`
    SELECT l."locationId",
           COALESCE(p."placed", 0)::int AS "placed",
           COALESCE(o."out", 0)::int AS "out"
    FROM (
      SELECT "locationId" FROM "AssetLocation"
      WHERE "assetId" = ${assetId} AND "assetKitId" IS NULL
      UNION
      SELECT s."locationId" FROM "BookingAssetSource" s
      JOIN "BookingAsset" ba ON ba.id = s."bookingAssetId"
      WHERE ba."assetId" = ${assetId} AND s."locationId" IS NOT NULL
    ) l
    LEFT JOIN (
      SELECT "locationId", sum("quantity") AS "placed" FROM "AssetLocation"
      WHERE "assetId" = ${assetId} AND "assetKitId" IS NULL
      GROUP BY "locationId"
    ) p ON p."locationId" = l."locationId"
    LEFT JOIN (
      SELECT s."locationId", sum(s."outQuantity") AS "out"
      FROM "BookingAssetSource" s
      JOIN "BookingAsset" ba ON ba.id = s."bookingAssetId"
      JOIN "Booking" b ON b.id = ba."bookingId"
      WHERE ba."assetId" = ${assetId} AND s."kind" = 'LOCATION'
        AND b."status" IN ('ONGOING', 'OVERDUE')
      GROUP BY s."locationId"
    ) o ON o."locationId" = l."locationId"
    ORDER BY l."locationId"
  `;
}

/** Arguments of {@link checkOutUnits}. */
export type CheckOutArgs = {
  organizationId: string;
  bookingId: string;
  picks: DispatchPick[];
  window: TestWindow;
  clientSupportsSources?: boolean;
  now?: Date;
};

/**
 * A check-out: locks the booking, dispatches through the facade, then adds
 * the units to each slice's `checkedOutQuantity`, stamps `checkedOutAt` and
 * moves the booking to ONGOING, as the check-out paths do.
 *
 * @param tx - The check-out transaction.
 * @param args - The booking, the picks and the window it commits.
 * @returns What the facade dispatched.
 */
export async function checkOutUnits(
  tx: TxClient,
  args: CheckOutArgs
): Promise<DispatchResult> {
  await lockBooking(tx, args.bookingId);
  const result = await dispatchUnits(tx, {
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    picks: args.picks,
    window: args.window,
    clientSupportsSources: args.clientSupportsSources,
    now: args.now,
    adoptionEnabled: true,
  });
  for (const pick of args.picks) {
    await tx.bookingAsset.update({
      where: { id: pick.sliceId },
      data: {
        checkedOutQuantity: { increment: pick.units },
        checkedOutAt: new Date(),
      },
    });
  }
  await tx.booking.update({
    where: { id: args.bookingId },
    data: { status: "ONGOING" satisfies BookingStatus },
  });
  return result;
}

/** One disposition of a check-in and the logs the check-in writes for it. */
export type CheckInStep = {
  disposition: SettlementDisposition;
  /** The logs written after the settle, as the ledger splits them. */
  logs: Array<Omit<LogInput, "assetId" | "userId" | "bookingId">>;
};

/** Arguments of {@link checkInUnits}. */
export type CheckInArgs = {
  organizationId: string;
  bookingId: string;
  assetId: string;
  userId: string;
  steps: CheckInStep[];
  /** Skip the booking lock (a writer that holds the asset lock only). */
  skipBookingLock?: boolean;
  now?: Date;
};

/**
 * A check-in: locks the booking, opens the settlement (which locks the
 * assets and converts LEGACY groups), settles each disposition, writes its
 * logs, then commits the settlement, as the check-in paths do.
 *
 * @param tx - The check-in transaction.
 * @param args - The booking, the asset and the dispositions.
 * @returns What each disposition settled, and the ids of the logs written.
 */
export async function checkInUnits(
  tx: TxClient,
  args: CheckInArgs
): Promise<{ settled: SettledDisposition[]; logIds: string[] }> {
  if (!args.skipBookingLock) await lockBooking(tx, args.bookingId);
  const settlement = await openSettlement(tx, {
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    assetIds: [args.assetId],
    now: args.now,
    adoptionEnabled: true,
  });
  const settled: SettledDisposition[] = [];
  const logIds: string[] = [];
  for (const step of args.steps) {
    settled.push(settleUnits(settlement, step.disposition));
    for (const log of step.logs) {
      logIds.push(
        await insertLog(tx, {
          ...log,
          assetId: args.assetId,
          userId: args.userId,
          bookingId: args.bookingId,
        })
      );
    }
  }
  await commitSettlement(tx, settlement);
  return { settled, logIds };
}

/**
 * A barrier for `parties` concurrent transactions: each caller waits until
 * every party has arrived. Rejects after `timeoutMs` so a party that failed
 * before arriving never hangs the others until the transaction timeout.
 *
 * @param parties - How many callers must arrive.
 * @param timeoutMs - How long to wait at most.
 * @returns The function each party awaits.
 */
export function createBarrier(
  parties: number,
  timeoutMs = 10_000
): () => Promise<void> {
  let arrived = 0;
  let release: () => void = () => undefined;
  const all = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("barrier: a party never arrived")),
        timeoutMs
      );
    });
    try {
      await Promise.race([all, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * A one-shot signal between concurrent transactions.
 *
 * @returns `fire` to raise it and `wait` to await it.
 */
export function createSignal(): {
  fire: () => void;
  wait: () => Promise<void>;
} {
  let fire: () => void = () => undefined;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fire, wait: () => fired };
}

/**
 * Waits `ms` milliseconds.
 *
 * @param ms - Milliseconds.
 */
export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The HTTP status a facade refusal carries (`ShelfError.status`), or null for
 * any other error.
 *
 * @param reason - A rejection reason.
 * @returns The status, or null.
 */
export function statusOf(reason: unknown): number | null {
  if (
    typeof reason === "object" &&
    reason !== null &&
    "status" in reason &&
    typeof reason.status === "number"
  ) {
    return reason.status;
  }
  return null;
}

/**
 * The message of a rejection reason.
 *
 * @param reason - A rejection reason.
 * @returns Its message, or its string form.
 */
export function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * True when a rejection is a Postgres deadlock abort (40P01), however Prisma
 * reports it.
 *
 * @param reason - A rejection reason.
 */
export function isDeadlock(reason: unknown): boolean {
  return /deadlock|40P01|P2034/i.test(messageOf(reason));
}
