/**
 * Booking sources: performance benchmark against a real database
 *
 * Opt-in: skipped unless `RUN_BENCHMARKS=1`. CI runs it only in the
 * "Database tests" job when asked (see `apps/docs/real-database-tests.md`),
 * because the fixture alone writes tens of thousands of rows.
 *
 * Two copies of the large fixture (`fixtures-large.ts`) are built: one left
 * LEGACY and one converted through the real check-in entry points. Each
 * operation runs on both, through the real services:
 *
 * - the "legacy" arm: LEGACY data with adoption off, which is today's
 *   behaviour (`BOOKING_SOURCES_ENABLED=false`);
 * - the "sources" arm: converted data with adoption on.
 *
 * The two conversion operations run on the LEGACY copy for both arms, so the
 * sources arm measures converting a group with heavy history.
 *
 * Every write sample runs in a transaction that ends with
 * `SET CONSTRAINTS ALL IMMEDIATE`, which fires the deferred contract triggers
 * at that statement exactly as COMMIT would, and is then rolled back. The
 * sample therefore includes the deferred checks, and every sample starts from
 * the same committed fixture. BEGIN and the COMMIT round trip itself are
 * outside the timing; they cost the same on both arms.
 *
 * What is asserted:
 * - each operation's sources median within 10% of its legacy median, only
 *   when both arms are stable (spread at most {@link STABLE_SPREAD}) and the
 *   legacy median is at least {@link MIN_ASSERTED_MS}; otherwise it is logged;
 * - partial check-out and both conversions under half of the partial
 *   check-out transaction timeout, on every sample.
 *
 * The second test prints `EXPLAIN (ANALYZE, BUFFERS)` for every distinct
 * statement the operations send (captured from Prisma's query log), for the
 * foreign key lookups of the new tables, and for the delete statements with
 * their cascades, for the PR description. Plans are logged, never asserted.
 *
 * @see {@link file://./fixtures-large.ts} the fixture
 * @see {@link file://./booking-sources-helpers.ts} shared helpers
 * @see {@link file://./../../app/modules/booking/sources/booking-sources.server.ts} the facade
 */

import { performance } from "node:perf_hooks";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db as appDb } from "~/database/db.server";
import { BOOKING_WITH_ASSETS_INCLUDE } from "~/modules/booking/constants";
import {
  admitWindowChange,
  allocateNewSlices,
  commitSettlement,
  dispatchUnits,
  getSliceSourceSummaries,
  openSettlement,
} from "~/modules/booking/sources/booking-sources.server";
import {
  computeFreeBySourceForPools,
  loadCompetingHoldsByPool,
  loadPhysicalNow,
  loadSourceCapacity,
} from "~/modules/booking/sources/capacity.server";
import {
  KIT_PROPAGATION_STATUSES,
  isConvertedSlice,
  lockKitDetachPools,
  resizeKitSourceRows,
} from "~/modules/booking/sources/kit-sources.server";
import { evacuateLocationsForDelete } from "~/modules/booking/sources/location-delete.server";
import { loadGroupStates } from "~/modules/booking/sources/repository.server";
import { settleUnits } from "~/modules/booking/sources/settlement";

import {
  addSlice,
  cleanupPools,
  insertLog,
  lockBooking,
  messageOf,
} from "./booking-sources-helpers";
import type { TxClient } from "./client";
import { disconnectTestDb, getTestDb, readTestDatabaseUrl } from "./client";
import type { ConversionStats, LargeWorld } from "./fixtures-large";
import {
  LARGE_FIXTURE,
  assetIdsOf,
  buildLargeWorld,
  convertLargeWorld,
} from "./fixtures-large";

/** The benchmark runs only when explicitly asked for. */
const RUN_BENCHMARKS = process.env.RUN_BENCHMARKS === "1";

/** Timed samples per arm, after one warm-up run each. */
const SAMPLES = 5;

/** The budget: the sources median at most this much above the legacy one. */
const BUDGET_RATIO = 0.1;

/** An arm is stable when (max - min) / median is at most this. */
const STABLE_SPREAD = 0.3;

/** Below this legacy median, timer and network noise dominate; logged only. */
const MIN_ASSERTED_MS = 20;

/**
 * The interactive transaction timeout of `partialCheckoutBooking`
 * (`db.$transaction(..., { timeout: 15000 })` in
 * `app/modules/booking/service.server.ts`). Check-in uses the same value.
 */
const PARTIAL_CHECKOUT_TX_TIMEOUT_MS = 15_000;

/** Operations bound by the timeout must stay under this share of it. */
const TIMEOUT_MARGIN = 0.5;

/** Timeout of one sample's transaction. */
const SAMPLE_TX_TIMEOUT_MS = 120_000;

/**
 * Per-hook and per-test time limits. Their sum, 80 minutes, is the
 * `timeout-minutes` of the benchmark step in
 * `.github/workflows/test.yml`, and the job allows 20 more for the main
 * database suite (100 in all). Change one, change the workflow with it.
 */
const BUILD_TIMEOUT_MS = 30 * 60_000;
const CLEANUP_TIMEOUT_MS = 10 * 60_000;
const TIMINGS_TIMEOUT_MS = 25 * 60_000;
const PLANS_TIMEOUT_MS = 15 * 60_000;

/** Slices of the big RESERVED booking a partial check-out sends out. */
const PARTIAL_CHECKOUT_SLICES = 250;

/** Units per slice in the partial check-out. */
const PARTIAL_CHECKOUT_UNITS = 2;

/** Slices of the big ONGOING booking a check-in returns units on. */
const CHECKIN_SLICES = 50;

/** Units returned per slice in the check-in. */
const CHECKIN_UNITS = 2;

/** Locations deleted in one bulk location delete. */
const DELETED_LOCATIONS = 5;

/** Most distinct statements EXPLAINed, to bound the CI log. */
const MAX_EXPLAINED = 200;

/** Prefix of every line the benchmark prints. */
const TAG = "[booking sources benchmark]";

/** Thrown to roll a sample's transaction back after timing it. */
class RollbackSignal extends Error {
  constructor() {
    super("benchmark sample: intentional rollback");
  }
}

/** One row of an EXPLAIN result. */
type PlanRow = { "QUERY PLAN": string };

/** How an operation's result is judged. */
type Budget =
  /** Sources within 10% of legacy (asserted when stable). */
  | "ten-percent"
  /** Under half the partial check-out timeout, every sample. */
  | "timeout"
  /** Within 10% when stable, and under half the timeout. */
  | "ten-percent-and-timeout"
  /** Printed only. */
  | "info";

/** One measured arm. */
type ArmRun = {
  /** The world the arm runs on. */
  world: () => LargeWorld;
  /** Adoption flag passed to every facade call. */
  adoptionEnabled: boolean;
};

/** The body of a write operation, run inside a sample transaction. */
type WriteBody = (
  tx: TxClient,
  world: LargeWorld,
  adoptionEnabled: boolean
) => Promise<void>;

/** One benchmarked operation. */
type Operation = {
  name: string;
  budget: Budget;
  legacy: ArmRun;
  sources: ArmRun;
} & (
  | { kind: "write"; body: WriteBody }
  | { kind: "read"; read: (world: LargeWorld) => Promise<void> }
);

/** Summary of one arm's samples. */
type ArmStats = {
  median: number;
  min: number;
  max: number;
  /** (max - min) / median. */
  spread: number;
};

/** One printed result line. */
type Result = {
  name: string;
  budget: Budget;
  legacy: ArmStats;
  sources: ArmStats;
  /** sources median / legacy median - 1. */
  delta: number;
  verdict: string;
  /** Set when an asserted budget failed. */
  failure: string | null;
};

/**
 * Times one write sample: runs `body`, fires the deferred triggers with
 * `SET CONSTRAINTS ALL IMMEDIATE`, stops the clock, rolls back.
 *
 * @param body - The writes to time.
 * @returns Elapsed milliseconds.
 */
async function timeWrite(body: (tx: TxClient) => Promise<void>) {
  let elapsed = -1;
  try {
    await getTestDb().$transaction(
      async (tx) => {
        const started = performance.now();
        await body(tx);
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        elapsed = performance.now() - started;
        throw new RollbackSignal();
      },
      { timeout: SAMPLE_TX_TIMEOUT_MS, maxWait: 10_000 }
    );
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
  return elapsed;
}

/**
 * Times one read sample.
 *
 * @param read - The reads to time.
 * @returns Elapsed milliseconds.
 */
async function timeRead(read: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await read();
  return performance.now() - started;
}

/**
 * Runs one sample of an operation's arm.
 *
 * @param op - The operation.
 * @param arm - Which arm.
 * @returns Elapsed milliseconds.
 */
function runSample(op: Operation, arm: ArmRun): Promise<number> {
  const world = arm.world();
  if (op.kind === "read") {
    const { read } = op;
    return timeRead(() => read(world));
  }
  const { body } = op;
  return timeWrite((tx) => body(tx, world, arm.adoptionEnabled));
}

/**
 * Median, min, max and spread of samples.
 *
 * @param samples - Elapsed milliseconds.
 * @returns The summary.
 */
function statsOf(samples: number[]): ArmStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[mid] ?? 0
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return { median, min, max, spread: median > 0 ? (max - min) / median : 0 };
}

/**
 * Judges an operation's samples against its budget.
 *
 * @param op - The operation.
 * @param legacy - Legacy arm summary.
 * @param sources - Sources arm summary.
 * @returns The printed verdict and, when an asserted budget failed, why.
 */
function judge(
  op: Operation,
  legacy: ArmStats,
  sources: ArmStats
): Pick<Result, "verdict" | "failure"> {
  const verdicts: string[] = [];
  const failures: string[] = [];
  const delta = legacy.median > 0 ? sources.median / legacy.median - 1 : 0;

  if (op.budget === "ten-percent" || op.budget === "ten-percent-and-timeout") {
    const stable =
      legacy.spread <= STABLE_SPREAD &&
      sources.spread <= STABLE_SPREAD &&
      legacy.median >= MIN_ASSERTED_MS;
    if (!stable) {
      verdicts.push("10%: logged only (unstable or too small)");
    } else if (delta <= BUDGET_RATIO) {
      verdicts.push("10%: pass");
    } else {
      verdicts.push("10%: FAIL");
      failures.push(
        `${op.name}: sources median ${sources.median.toFixed(1)} ms is ` +
          `${(delta * 100).toFixed(1)}% above legacy ${legacy.median.toFixed(
            1
          )} ms`
      );
    }
  }

  if (op.budget === "timeout" || op.budget === "ten-percent-and-timeout") {
    const bound = PARTIAL_CHECKOUT_TX_TIMEOUT_MS * TIMEOUT_MARGIN;
    if (sources.max < bound) {
      verdicts.push(`timeout: pass (< ${bound} ms)`);
    } else {
      verdicts.push("timeout: FAIL");
      failures.push(
        `${op.name}: slowest sources sample ${sources.max.toFixed(1)} ms ` +
          `is not under ${bound} ms (half the ${PARTIAL_CHECKOUT_TX_TIMEOUT_MS} ms timeout)`
      );
    }
  }

  if (op.budget === "info") verdicts.push("info");
  return {
    verdict: verdicts.join("; "),
    failure: failures.length > 0 ? failures.join("; ") : null,
  };
}

/**
 * Measures an operation: one warm-up per arm, then {@link SAMPLES} samples
 * per arm, alternating which arm goes first so drift hits both alike.
 *
 * @param op - The operation.
 * @returns Its result line.
 */
async function measure(op: Operation): Promise<Result> {
  await runSample(op, op.legacy);
  await runSample(op, op.sources);
  const legacySamples: number[] = [];
  const sourcesSamples: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    if (i % 2 === 0) {
      legacySamples.push(await runSample(op, op.legacy));
      sourcesSamples.push(await runSample(op, op.sources));
    } else {
      sourcesSamples.push(await runSample(op, op.sources));
      legacySamples.push(await runSample(op, op.legacy));
    }
  }
  const legacy = statsOf(legacySamples);
  const sources = statsOf(sourcesSamples);
  const delta = legacy.median > 0 ? sources.median / legacy.median - 1 : 0;
  return {
    name: op.name,
    budget: op.budget,
    legacy,
    sources,
    delta,
    ...judge(op, legacy, sources),
  };
}

/**
 * Formats the results as a fixed-width table for the CI log.
 *
 * @param results - Result lines.
 * @returns The table text.
 */
function formatTable(results: Result[]): string {
  const ms = (n: number) => n.toFixed(1);
  const header = [
    "operation".padEnd(48),
    "legacy med".padStart(11),
    "(min-max)".padStart(19),
    "sources med".padStart(12),
    "(min-max)".padStart(19),
    "delta".padStart(8),
    "  verdict",
  ].join(" ");
  const lines = results.map((r) =>
    [
      r.name.padEnd(48),
      ms(r.legacy.median).padStart(11),
      `(${ms(r.legacy.min)}-${ms(r.legacy.max)})`.padStart(19),
      ms(r.sources.median).padStart(12),
      `(${ms(r.sources.min)}-${ms(r.sources.max)})`.padStart(19),
      `${(r.delta * 100).toFixed(1)}%`.padStart(8),
      `  ${r.verdict}`,
    ].join(" ")
  );
  return [header, "-".repeat(header.length), ...lines].join("\n");
}

// -- Operation bodies -------------------------------------------------------

/**
 * Booking details: the overview loader's booking read (with every slice and
 * its asset), then the Location cell summaries when a standalone slice is
 * AUTO or MANUAL, as the loader decides. Both read through the app client.
 *
 * @param world - The world to read.
 */
async function bookingDetails(world: LargeWorld): Promise<void> {
  const { organizationId } = world;
  const bookingId = world.bigReserved.bookingId;
  const booking = await appDb.booking.findFirst({
    where: { id: bookingId, organizationId },
    include: BOOKING_WITH_ASSETS_INCLUDE,
  });
  if (!booking) throw new Error("benchmark: big reserved booking not found");
  const hasSourcedPoolSlice = booking.bookingAssets.some(
    (ba) =>
      ba.assetKitId === null &&
      (ba.sourceAllocation === "AUTO" || ba.sourceAllocation === "MANUAL")
  );
  if (hasSourcedPoolSlice) {
    await getSliceSourceSummaries({ organizationId, bookingId });
  }
}

/** Reserve: a 500-slice draft becomes a reservation. */
const reserve: WriteBody = async (tx, world, adoptionEnabled) => {
  const { bookingId, window } = world.bigDraft;
  await lockBooking(tx, bookingId);
  await admitWindowChange(tx, {
    organizationId: world.organizationId,
    bookingId,
    from: window.from,
    to: window.to,
    previous: window,
    kind: "reserve",
    adoptionEnabled,
  });
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: "RESERVED" },
  });
};

/** Scan-add: one pool asset added to the 500-slice reservation. */
const scanAdd: WriteBody = async (tx, world, adoptionEnabled) => {
  const { bookingId, window } = world.bigReserved;
  await lockBooking(tx, bookingId);
  const sliceId = await addSlice(tx, {
    bookingId,
    assetId: world.spareAssetId,
    quantity: 2,
  });
  await allocateNewSlices(tx, {
    organizationId: world.organizationId,
    bookingId,
    sliceIds: [sliceId],
    window,
    holdsNow: true,
    adoptionEnabled,
  });
};

/** Partial check-out: 250 slices of the reservation send 2 units each. */
const partialCheckout: WriteBody = async (tx, world, adoptionEnabled) => {
  const { bookingId, window, slices } = world.bigReserved;
  const picked = slices.slice(0, PARTIAL_CHECKOUT_SLICES);
  await lockBooking(tx, bookingId);
  await dispatchUnits(tx, {
    organizationId: world.organizationId,
    bookingId,
    picks: picked.map((s) => ({
      sliceId: s.id,
      units: PARTIAL_CHECKOUT_UNITS,
    })),
    window,
    adoptionEnabled,
  });
  await tx.bookingAsset.updateMany({
    where: { id: { in: picked.map((s) => s.id) } },
    data: {
      checkedOutQuantity: { increment: PARTIAL_CHECKOUT_UNITS },
      checkedOutAt: new Date(),
    },
  });
  await tx.booking.update({
    where: { id: bookingId },
    data: { status: "ONGOING" },
  });
};

/** Check-in: 50 slices of the ongoing booking return 2 units each. */
const checkIn: WriteBody = async (tx, world, adoptionEnabled) => {
  const { bookingId, slices } = world.bigOngoing;
  const picked = slices.slice(0, CHECKIN_SLICES);
  await lockBooking(tx, bookingId);
  const settlement = await openSettlement(tx, {
    organizationId: world.organizationId,
    bookingId,
    assetIds: picked.map((s) => s.assetId),
    adoptionEnabled,
  });
  for (const slice of picked) {
    const settled = settleUnits(settlement, {
      sliceId: slice.id,
      assetId: slice.assetId,
      returned: CHECKIN_UNITS,
    });
    await insertLog(tx, {
      assetId: slice.assetId,
      userId: world.userId,
      bookingId,
      sliceId: settled.bookingAssetId,
      locationId: settled.returnLocationId ?? slice.sourceLocationId,
      quantity: CHECKIN_UNITS,
    });
  }
  await commitSettlement(tx, settlement);
};

/** Bulk location delete: 5 of the 20 locations, evacuated first. */
const bulkLocationDelete: WriteBody = async (tx, world) => {
  const ids = world.locationIds.slice(0, DELETED_LOCATIONS);
  await evacuateLocationsForDelete(tx, {
    organizationId: world.organizationId,
    locationIds: ids,
  });
  await tx.location.deleteMany({
    where: { id: { in: ids }, organizationId: world.organizationId },
  });
};

/** Bulk booking delete: the 50 bookings with heavy disposition history. */
const bulkBookingDelete: WriteBody = async (tx, world) => {
  await tx.booking.deleteMany({
    where: {
      id: { in: world.historyBookings.map((b) => b.bookingId) },
      organizationId: world.organizationId,
    },
  });
};

/** Asset delete: the first pool asset, on every big booking and more. */
const assetDelete: WriteBody = async (tx, world) => {
  await tx.asset.deleteMany({
    where: { id: world.pool.assetId, organizationId: world.organizationId },
  });
};

/**
 * Kit quantity change: the kit gains one unit, and every kit slice on a
 * booking that follows the kit (200 bookings) follows it. Converted slices
 * resize their KIT rows first, as the kit service does.
 */
const kitQuantityChange: WriteBody = async (tx, world) => {
  const quantity = LARGE_FIXTURE.kitQuantity + 1;
  await tx.assetKit.update({
    where: { id: world.assetKitId },
    data: { quantity },
  });
  const slices = await tx.bookingAsset.findMany({
    where: {
      assetKitId: world.assetKitId,
      booking: {
        organizationId: world.organizationId,
        status: { in: KIT_PROPAGATION_STATUSES },
      },
    },
    select: { id: true, assetId: true, sourceAllocation: true },
  });
  const { refused } = await resizeKitSourceRows(tx, {
    organizationId: world.organizationId,
    slices: slices
      .filter((s) => isConvertedSlice(s))
      .map((s) => ({ sliceId: s.id, assetId: s.assetId, quantity })),
    belowOut: "refuse",
  });
  if (refused.length > 0) {
    throw new Error(`benchmark: kit resize refused ${refused.length} slices`);
  }
  await tx.bookingAsset.updateMany({
    where: { id: { in: slices.map((s) => s.id) } },
    data: { quantity },
  });
};

/**
 * A check-in's opening and commit with nothing settled: with adoption on it
 * converts every LEGACY group of the given assets, with adoption off it is
 * the one probe.
 *
 * @param bookingOf - Picks the booking to convert.
 */
function conversion(
  bookingOf: (world: LargeWorld) => LargeWorld["bigOngoing"]
): WriteBody {
  return async (tx, world, adoptionEnabled) => {
    const booking = bookingOf(world);
    await lockBooking(tx, booking.bookingId);
    const settlement = await openSettlement(tx, {
      organizationId: world.organizationId,
      bookingId: booking.bookingId,
      assetIds: assetIdsOf(booking),
      adoptionEnabled,
    });
    await commitSettlement(tx, settlement);
  };
}

/**
 * The deferred contract checks, run by hand on every slice and group of the
 * big ongoing booking: their cost on LEGACY versus converted rows.
 */
const deferredChecks: WriteBody = async (tx, world) => {
  const bookingId = world.bigOngoing.bookingId;
  await tx.$queryRaw<Array<{ checked: number }>>`
    SELECT count(*)::int AS "checked" FROM (
      SELECT check_booking_source_slice(ba.id)::text
      FROM "BookingAsset" ba WHERE ba."bookingId" = ${bookingId}
    ) s
  `;
  await tx.$queryRaw<Array<{ checked: number }>>`
    SELECT count(*)::int AS "checked" FROM (
      SELECT check_booking_source_group(g."bookingId", g."assetId")::text
      FROM (
        SELECT DISTINCT "bookingId", "assetId" FROM "BookingAsset"
        WHERE "bookingId" = ${bookingId}
      ) g
    ) s
  `;
};

// -- Statement capture for EXPLAIN -------------------------------------------

/** A statement Prisma sent, with its parameters as Prisma logs them. */
type CapturedStatement = { sql: string; params: string };

/** A distinct statement and every capture label it appeared under. */
type DistinctStatement = CapturedStatement & { labels: Set<string> };

/**
 * A plain Prisma client that logs every statement it sends, so the services
 * can be run through it and their SQL EXPLAINed.
 *
 * @returns The client, the captured statements, and a recording switch.
 */
function createCapturingClient() {
  const captured: CapturedStatement[] = [];
  let recording = false;
  const client = new PrismaClient({
    datasourceUrl: readTestDatabaseUrl(),
    log: [{ emit: "event", level: "query" }],
  });
  client.$on("query", (event) => {
    if (recording) captured.push({ sql: event.query, params: event.params });
  });
  return {
    client,
    /**
     * Runs `fn` in a rolled-back transaction of the capturing client and
     * returns the data statements it sent.
     *
     * @param fn - The service calls to capture.
     */
    async capture(
      fn: (tx: TxClient) => Promise<void>
    ): Promise<CapturedStatement[]> {
      captured.length = 0;
      recording = true;
      try {
        await client.$transaction(
          async (tx) => {
            // why: the services are typed against the app's extended client;
            // a plain client's transaction has the same models and raw
            // methods, minus the extension helpers no service here calls.
            await fn(tx as unknown as TxClient);
            throw new RollbackSignal();
          },
          { timeout: SAMPLE_TX_TIMEOUT_MS, maxWait: 10_000 }
        );
      } catch (error) {
        if (!(error instanceof RollbackSignal)) throw error;
      } finally {
        // Query events are emitted after each statement completes; give the
        // last ones a moment to arrive before the recording stops.
        await new Promise((resolve) => setTimeout(resolve, 50));
        recording = false;
      }
      return captured.filter((s) =>
        /^\s*(SELECT|WITH|UPDATE|INSERT|DELETE)\b/i.test(s.sql)
      );
    },
  };
}

/**
 * Key that treats statements differing only in parameter count (IN lists,
 * multi-row VALUES) as one.
 *
 * @param sql - Statement text with `$n` placeholders.
 * @returns The normalised text.
 */
function statementKey(sql: string): string {
  return sql
    .replace(/\$\d+/g, "$?")
    .replace(/\$\?(?:::[\w"[\]]+)?(?:\s*,\s*\$\?(?:::[\w"[\]]+)?)+/g, "$?")
    .replace(/(\([^()]*\))(?:\s*,\s*\([^()]*\))+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quotes a value as a SQL literal. Untyped literals take the type of the
 * placeholder they replace, as a bound parameter would.
 *
 * @param value - A parameter as Prisma logs it.
 * @returns The literal.
 */
function toSqlLiteral(value: unknown): string {
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) {
    const elements = value.map((v) =>
      v === null
        ? "NULL"
        : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    );
    return quote(`{${elements.join(",")}}`);
  }
  return quote(JSON.stringify(value));
}

/**
 * Replaces each `$n` placeholder with its parameter as a literal.
 *
 * @param statement - A captured statement.
 * @returns Runnable SQL, or null when the parameters cannot be read.
 */
function inlineParams(statement: CapturedStatement): string | null {
  let params: unknown;
  try {
    params = JSON.parse(statement.params);
  } catch {
    return null;
  }
  if (!Array.isArray(params)) return null;
  const values: unknown[] = params;
  let missing = false;
  const sql = statement.sql.replace(/\$(\d+)/g, (_, digits: string) => {
    const index = Number(digits) - 1;
    if (index < 0 || index >= values.length) {
      missing = true;
      return "NULL";
    }
    return toSqlLiteral(values[index]);
  });
  return missing ? null : sql;
}

/**
 * Runs `EXPLAIN (ANALYZE, BUFFERS)` on raw SQL inside a savepoint that is
 * rolled back, so a write statement leaves nothing behind and an error
 * leaves the transaction usable.
 *
 * @param tx - A rolled-back transaction.
 * @param sql - The statement.
 * @param params - Bound parameters, if any.
 * @returns The plan text, or why there is none.
 */
async function explainSql(
  tx: TxClient,
  sql: string,
  params: unknown[] = []
): Promise<string> {
  await tx.$executeRawUnsafe("SAVEPOINT bench_explain");
  try {
    const rows = await tx.$queryRawUnsafe<PlanRow[]>(
      `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
      ...params
    );
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
  } catch (error) {
    return `plan unavailable: ${messageOf(error)}`;
  } finally {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bench_explain");
  }
}

/**
 * Runs `fn` in a transaction of the test client that is always rolled back.
 *
 * @param fn - The work.
 */
async function inRollback(fn: (tx: TxClient) => Promise<void>): Promise<void> {
  try {
    await getTestDb().$transaction(
      async (tx) => {
        await fn(tx);
        throw new RollbackSignal();
      },
      { timeout: 600_000, maxWait: 10_000 }
    );
  } catch (error) {
    if (!(error instanceof RollbackSignal)) throw error;
  }
}

/**
 * The reads `getSliceSourceSummaries` sends, through a given client. The
 * function itself reads through the app's own client, which the capture
 * cannot see: the three inline reads are copies of its Prisma calls, the
 * capacity and holds reads are the exported functions it calls.
 *
 * @param tx - The capturing transaction.
 * @param world - The world to read.
 */
async function summaryReads(tx: TxClient, world: LargeWorld): Promise<void> {
  const { organizationId } = world;
  const { bookingId, window } = world.bigReserved;
  await tx.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { id: true, from: true, to: true, status: true, createdAt: true },
  });
  const slices = await tx.bookingAsset.findMany({
    where: { bookingId, booking: { organizationId } },
    select: { id: true, assetId: true, sourceAllocation: true },
  });
  const loose = slices.filter(
    (s) => s.sourceAllocation === "AUTO" || s.sourceAllocation === "MANUAL"
  );
  const rows = await tx.bookingAssetSource.findMany({
    where: { organizationId, bookingAssetId: { in: loose.map((s) => s.id) } },
    select: {
      bookingAssetId: true,
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });
  const assetIds = [...new Set(loose.map((s) => s.assetId))];
  const locationIds = [
    ...new Set(rows.flatMap((r) => (r.locationId ? [r.locationId] : []))),
  ];
  await loadSourceCapacity(tx, { organizationId, assetIds });
  await loadCompetingHoldsByPool(tx, {
    organizationId,
    assetIds,
    window,
    excludeBookingId: bookingId,
  });
  await tx.location.findMany({
    where: { id: { in: locationIds }, organizationId },
    select: { id: true, name: true },
  });
}

/** Foreign keys of the new tables, as the referential triggers look them up. */
const FOREIGN_KEYS: Array<{
  table: "BookingAssetSource" | "BookingDispositionShare";
  column: string;
  onDelete: string;
}> = [
  {
    table: "BookingAssetSource",
    column: "bookingAssetId",
    onDelete: "CASCADE",
  },
  { table: "BookingAssetSource", column: "locationId", onDelete: "NO ACTION" },
  {
    table: "BookingAssetSource",
    column: "organizationId",
    onDelete: "CASCADE",
  },
  {
    table: "BookingDispositionShare",
    column: "consumptionLogId",
    onDelete: "CASCADE",
  },
  {
    table: "BookingDispositionShare",
    column: "bookingId",
    onDelete: "CASCADE",
  },
  { table: "BookingDispositionShare", column: "assetId", onDelete: "CASCADE" },
  {
    table: "BookingDispositionShare",
    column: "bookingAssetId",
    onDelete: "SET NULL",
  },
  {
    table: "BookingDispositionShare",
    column: "bookingAssetSourceId",
    onDelete: "SET NULL",
  },
  {
    table: "BookingDispositionShare",
    column: "organizationId",
    onDelete: "CASCADE",
  },
];

/**
 * Prints one plan block.
 *
 * @param title - What the plan is of.
 * @param body - SQL and plan text.
 */
function printPlan(title: string, body: string): void {
  console.info(`${TAG} ${title}\n${body}\n${TAG} end of plan`);
}

describe.skipIf(!RUN_BENCHMARKS)("booking sources benchmark", () => {
  let legacyWorld: LargeWorld | undefined;
  let sourcesWorld: LargeWorld | undefined;

  /** The LEGACY world, built in `beforeAll`. */
  const legacy = (): LargeWorld => {
    if (!legacyWorld) throw new Error("benchmark: legacy world not built");
    return legacyWorld;
  };
  /** The converted world, built in `beforeAll`. */
  const sources = (): LargeWorld => {
    if (!sourcesWorld) throw new Error("benchmark: sources world not built");
    return sourcesWorld;
  };

  /** Today's arm: LEGACY data, adoption off. */
  const legacyArm: ArmRun = { world: legacy, adoptionEnabled: false };
  /** The new arm: converted data, adoption on. */
  const sourcesArm: ArmRun = { world: sources, adoptionEnabled: true };
  /** Conversion arm: LEGACY data, adoption on. */
  const convertingArm: ArmRun = { world: legacy, adoptionEnabled: true };

  /** Every benchmarked operation, in print order. */
  const operations: Operation[] = [
    {
      name: "booking details (500 slices)",
      budget: "ten-percent",
      kind: "read",
      read: bookingDetails,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: "reserve (500-slice draft)",
      budget: "ten-percent",
      kind: "write",
      body: reserve,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: "scan-add (1 slice to a 500-slice booking)",
      budget: "ten-percent",
      kind: "write",
      body: scanAdd,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: `partial check-out (${PARTIAL_CHECKOUT_SLICES} slices)`,
      budget: "ten-percent-and-timeout",
      kind: "write",
      body: partialCheckout,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: `check-in (${CHECKIN_SLICES} slices)`,
      budget: "ten-percent",
      kind: "write",
      body: checkIn,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: `bulk location delete (${DELETED_LOCATIONS} locations)`,
      budget: "ten-percent",
      kind: "write",
      body: bulkLocationDelete,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: `bulk booking delete (${LARGE_FIXTURE.historyBookings} history)`,
      budget: "ten-percent",
      kind: "write",
      body: bulkBookingDelete,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: "asset delete (busiest pool asset)",
      budget: "ten-percent",
      kind: "write",
      body: assetDelete,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: `kit quantity change (${LARGE_FIXTURE.kitBookings} bookings)`,
      budget: "ten-percent",
      kind: "write",
      body: kitQuantityChange,
      legacy: legacyArm,
      sources: sourcesArm,
    },
    {
      name: "conversion: 1 history booking (10 groups)",
      budget: "timeout",
      kind: "write",
      body: conversion((world) => {
        const first = world.historyBookings[0];
        if (!first) throw new Error("benchmark: no history booking");
        return first;
      }),
      legacy: legacyArm,
      sources: convertingArm,
    },
    {
      name: "conversion: 500-slice ongoing booking",
      budget: "timeout",
      kind: "write",
      body: conversion((world) => world.bigOngoing),
      legacy: legacyArm,
      sources: convertingArm,
    },
    {
      name: "deferred checks by hand (500 slices+groups)",
      budget: "info",
      kind: "write",
      body: deferredChecks,
      legacy: legacyArm,
      sources: sourcesArm,
    },
  ];

  beforeAll(async () => {
    const now = new Date();
    const buildStarted = performance.now();
    legacyWorld = await buildLargeWorld("Bench legacy", now);
    sourcesWorld = await buildLargeWorld("Bench sources", now);
    const builtMs = performance.now() - buildStarted;
    const stats: ConversionStats = await convertLargeWorld(sourcesWorld);
    console.info(
      `${TAG} fixture: two worlds built in ${builtMs.toFixed(0)} ms, each ` +
        `${JSON.stringify(legacyWorld.counts)}`
    );
    console.info(
      `${TAG} conversion of the sources world: ${stats.bookings} bookings in ` +
        `${stats.elapsedMs.toFixed(0)} ms (slowest booking ` +
        `${stats.slowestMs.toFixed(0)} ms), ${stats.sourceRows} source rows, ` +
        `${stats.shares} shares, ${stats.legacySlicesLeft} slices left LEGACY`
    );
    // Fresh statistics, as autovacuum would have them on a live database.
    await getTestDb().$executeRawUnsafe(
      'ANALYZE "Asset", "AssetLocation", "Booking", "BookingAsset", ' +
        '"BookingAssetSource", "BookingDispositionShare", "ConsumptionLog", ' +
        '"Location", "AssetKit"'
    );
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    const pools = [legacyWorld, sourcesWorld].flatMap((w) =>
      w ? [w.pool] : []
    );
    await cleanupPools(pools);
    await disconnectTestDb();
    // `getSliceSourceSummaries` and the booking details read use the app client.
    await appDb.$disconnect();
  }, CLEANUP_TIMEOUT_MS);

  it(
    "times each operation on LEGACY data with adoption off and on converted data with adoption on",
    async () => {
      const results: Result[] = [];
      for (const op of operations) {
        results.push(await measure(op));
      }
      console.info(
        `${TAG} ${SAMPLES} samples per arm after one warm-up; times in ms, ` +
          `deferred triggers included\n${formatTable(results)}`
      );
      const failures = results.flatMap((r) => (r.failure ? [r.failure] : []));
      expect(failures).toEqual([]);
    },
    TIMINGS_TIMEOUT_MS
  );

  it(
    "prints EXPLAIN (ANALYZE, BUFFERS) for every statement the operations send, the foreign key lookups and the deletes",
    async () => {
      const capturing = createCapturingClient();
      const distinct = new Map<string, DistinctStatement>();
      const queryCounts: string[] = [];

      /** Captures one labelled run and folds its statements into `distinct`. */
      const record = async (
        label: string,
        fn: (tx: TxClient) => Promise<void>
      ) => {
        const statements = await capturing.capture(fn);
        queryCounts.push(`${label}: ${statements.length} statements`);
        for (const statement of statements) {
          const key = statementKey(statement.sql);
          const found = distinct.get(key);
          if (found) found.labels.add(label);
          else distinct.set(key, { ...statement, labels: new Set([label]) });
        }
      };

      try {
        for (const op of operations) {
          if (op.kind !== "write") continue;
          for (const [armName, arm] of [
            ["legacy", op.legacy],
            ["sources", op.sources],
          ] as const) {
            const world = arm.world();
            await record(`${op.name} [${armName}]`, (tx) =>
              op.body(tx, world, arm.adoptionEnabled)
            );
          }
        }

        const world = sources();
        const { organizationId } = world;
        const ongoing = world.bigOngoing;
        const assetIds = assetIdsOf(ongoing);
        await record("booking details: summary reads [sources]", (tx) =>
          summaryReads(tx, world)
        );
        await record(
          "facade read: loadGroupStates (500 groups)",
          async (tx) => {
            await loadGroupStates(tx, {
              organizationId,
              groups: assetIds.map((assetId) => ({
                bookingId: ongoing.bookingId,
                assetId,
              })),
            });
          }
        );
        await record(
          "facade read: computeFreeBySourceForPools (500 pools)",
          async (tx) => {
            await computeFreeBySourceForPools(tx, {
              organizationId,
              assetIds,
              window: ongoing.window,
              excludeBookingId: ongoing.bookingId,
            });
          }
        );
        await record("facade read: loadPhysicalNow (500 pools)", async (tx) => {
          await loadPhysicalNow(tx, { organizationId, assetIds });
        });
        await record("kit detach probe (adoption off)", async (tx) => {
          await lockKitDetachPools(tx, {
            organizationId,
            assetKitIds: [world.assetKitId],
            adoptionEnabled: false,
          });
        });

        console.info(
          `${TAG} statements per run:\n${queryCounts.join("\n")}\n` +
            `${TAG} ${distinct.size} distinct statements`
        );

        const seqScans: string[] = [];
        await inRollback(async (tx) => {
          let n = 0;
          for (const statement of distinct.values()) {
            n += 1;
            if (n > MAX_EXPLAINED) {
              console.info(
                `${TAG} stopped after ${MAX_EXPLAINED} statements; ` +
                  `${distinct.size - MAX_EXPLAINED} not explained`
              );
              break;
            }
            const sql = inlineParams(statement);
            const plan = sql
              ? await explainSql(tx, sql)
              : `plan unavailable: parameters not readable (${statement.params.slice(
                  0,
                  200
                )})`;
            if (
              /Seq Scan on "?(BookingAssetSource|BookingDispositionShare|BookingAsset)"?\b/.test(
                plan
              )
            ) {
              seqScans.push(`#${n}`);
            }
            printPlan(
              `statement #${n} (from: ${[...statement.labels].join(" | ")})`,
              `${statement.sql}\nparams: ${statement.params.slice(
                0,
                500
              )}\n${plan}`
            );
          }

          for (const fk of FOREIGN_KEYS) {
            const hot = await tx.$queryRawUnsafe<Array<{ value: string }>>(
              `SELECT "${fk.column}" AS "value" FROM "${fk.table}"
             WHERE "organizationId" = $1 AND "${fk.column}" IS NOT NULL
             GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`,
              organizationId
            );
            const value = hot[0]?.value;
            if (!value) {
              printPlan(`FK ${fk.table}.${fk.column}`, "no rows to look up");
              continue;
            }
            const lookup =
              `SELECT 1 FROM ONLY "public"."${fk.table}" x ` +
              `WHERE $1::text OPERATOR(pg_catalog.=) x."${fk.column}" FOR KEY SHARE OF x`;
            printPlan(
              `FK lookup ${fk.table}.${fk.column} (ON DELETE ${fk.onDelete}), busiest value`,
              `${lookup}\n${await explainSql(tx, lookup, [value])}`
            );
          }

          const historyIds = world.historyBookings.map((b) => b.bookingId);
          printPlan(
            `bulk booking delete (${historyIds.length} history bookings), cascades included`,
            await explainSql(
              tx,
              `DELETE FROM "Booking" WHERE "id" = ANY($1::text[]) AND "organizationId" = $2`,
              [historyIds, organizationId]
            )
          );
          printPlan(
            "asset delete (busiest pool asset), cascades included",
            await explainSql(
              tx,
              `DELETE FROM "Asset" WHERE "id" = $1 AND "organizationId" = $2`,
              [world.pool.assetId, organizationId]
            )
          );
          const deleted = world.locationIds.slice(0, DELETED_LOCATIONS);
          await tx.$executeRawUnsafe("SAVEPOINT bench_evacuate");
          try {
            await evacuateLocationsForDelete(tx, {
              organizationId,
              locationIds: deleted,
            });
            printPlan(
              `location delete (${deleted.length} locations, after evacuation), cascades included`,
              await explainSql(
                tx,
                `DELETE FROM "Location" WHERE "id" = ANY($1::text[]) AND "organizationId" = $2`,
                [deleted, organizationId]
              )
            );
          } finally {
            await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT bench_evacuate");
          }
        });

        console.info(
          `${TAG} plans with a Seq Scan on BookingAsset, BookingAssetSource or ` +
            `BookingDispositionShare: ${
              seqScans.length > 0 ? seqScans.join(", ") : "none"
            }`
        );
        expect(distinct.size).toBeGreaterThan(0);
      } finally {
        await capturing.client.$disconnect();
      }
    },
    PLANS_TIMEOUT_MS
  );
});
