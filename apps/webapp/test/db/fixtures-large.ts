/**
 * Large real-database fixture for the booking sources benchmark
 *
 * Builds one workspace shaped like a busy production tenant, sized by
 * {@link LARGE_FIXTURE}:
 *
 * - 20 locations, and 500 quantity-tracked pool assets placed at every one
 *   of them (fully placed, so allocation lands on LOCATION rows);
 * - a 500-slice RESERVED booking (details, scan-add, partial check-out), a
 *   500-slice ONGOING booking with returns already logged (check-in,
 *   conversion) and a 500-slice DRAFT booking (reserve);
 * - 1000 competing bookings overlapping them, one in five ONGOING with units
 *   out, the first 200 also carrying a kit slice of one kit (kit quantity
 *   change across many bookings);
 * - 50 long-lived ONGOING bookings with heavy disposition history: each slice
 *   dispatched 100 units over time and logged 19 returns.
 *
 * Every row is written with `createMany` in chunks, never row by row, so the
 * fixture builds in CI time. Everything starts LEGACY, exactly as data
 * written before booking sources existed. {@link convertLargeWorld} converts
 * a world through the real check-in entry points (`openSettlement` and
 * `commitSettlement` with adoption on), one committed transaction per
 * booking, so a converted world holds the rows and shares conversion itself
 * writes.
 *
 * Runs only under `vitest.db.config.ts`; ids are random UUIDs, so two worlds
 * built in one database never collide.
 *
 * @see {@link file://./booking-sources-benchmark.db.test.ts} the benchmark using it
 * @see {@link file://./fixtures.ts} the small fixtures it builds on
 */

import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { BookingStatus, Prisma } from "@prisma/client";

import {
  commitSettlement,
  openSettlement,
} from "~/modules/booking/sources/booking-sources.server";

import type { TestWindow } from "./booking-sources-helpers";
import { lockBooking, nth, seedKit } from "./booking-sources-helpers";
import type { TxClient } from "./client";
import { getTestDb } from "./client";
import type { SeededOrgWithPool } from "./fixtures";
import { seedOrgWithPool } from "./fixtures";

/** The shape of the large fixture. Change a number here, not in the builder. */
export const LARGE_FIXTURE = {
  /** Locations in the workspace; every pool asset is placed at each. */
  locations: 20,
  /** Units of each pool asset placed at each location. */
  unitsPerPlacement: 40,
  /** Pool assets; each big booking has one slice per pool asset. */
  poolAssets: 500,
  /** Competing bookings overlapping the big ones. */
  competingBookings: 1000,
  /** Standalone slices per competing booking. */
  slicesPerCompetingBooking: 5,
  /** Units per competing slice. */
  competingSliceQuantity: 2,
  /** Every n-th competing booking is ONGOING with its units out. */
  ongoingEvery: 5,
  /** Competing bookings that also carry a kit slice of the one kit. */
  kitBookings: 200,
  /** Units of the kit asset in the kit (`AssetKit.quantity`). */
  kitQuantity: 5,
  /** Long-lived bookings with heavy disposition history. */
  historyBookings: 50,
  /** Slices per history booking. */
  slicesPerHistoryBooking: 10,
  /** Booked units per history slice. */
  historySliceQuantity: 10,
  /** Return logs per history slice, of {@link LARGE_FIXTURE.returnUnits} each. */
  historyReturnsPerSlice: 19,
  /** Booked units per slice of the ONGOING big booking. */
  ongoingSliceQuantity: 10,
  /** Return logs per slice of the ONGOING big booking. */
  ongoingReturnsPerSlice: 4,
  /** Units per return log. */
  returnUnits: 5,
  /** Booked units per slice of the RESERVED big booking. */
  reservedSliceQuantity: 4,
  /** Booked units per slice of the DRAFT big booking. */
  draftSliceQuantity: 3,
} as const;

/** Rows per `createMany` statement. */
const CHUNK = 1000;

/** Milliseconds in an hour. */
const HOUR = 60 * 60 * 1000;

/** Transaction timeout for fixture writes and conversions. */
const FIXTURE_TX_TIMEOUT_MS = 300_000;

/** One slice of a fixture booking. */
export type LargeBookingSlice = {
  id: string;
  assetId: string;
  /** Set for kit slices. */
  assetKitId: string | null;
  /** The recorded source of a slice with units out. */
  sourceLocationId: string | null;
};

/** One fixture booking with its window and slices. */
export type LargeBooking = {
  bookingId: string;
  status: BookingStatus;
  window: TestWindow;
  slices: LargeBookingSlice[];
};

/** Ids and shape of one built world. */
export type LargeWorld = {
  /** The workspace, its owner, the first pool asset and the locations. */
  pool: SeededOrgWithPool;
  organizationId: string;
  userId: string;
  locationIds: string[];
  /** The pool assets, in index order; index 0 is `pool.assetId`. */
  poolAssetIds: string[];
  /** A placed pool asset on no booking, for the scan-add. */
  spareAssetId: string;
  /** The kit's asset and its `AssetKit` membership. */
  kitAssetId: string;
  assetKitId: string;
  /** The 500-slice RESERVED booking. */
  bigReserved: LargeBooking;
  /** The 500-slice ONGOING booking with returns logged. */
  bigOngoing: LargeBooking;
  /** The 500-slice DRAFT booking. */
  bigDraft: LargeBooking;
  /** The long-lived bookings with heavy disposition history. */
  historyBookings: LargeBooking[];
  /** The competing bookings, kit slices included. */
  competingBookings: LargeBooking[];
  /** Row counts written, for the CI log. */
  counts: Record<string, number>;
};

/**
 * Splits rows into chunks of {@link CHUNK}.
 *
 * @param rows - Rows to split.
 * @returns The chunks, in order.
 */
function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push(rows.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * Runs `fn` in one committed transaction with the fixture timeout.
 *
 * @param fn - Writes to commit.
 * @returns Whatever `fn` returned.
 */
function commitLong<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return getTestDb().$transaction(fn, {
    timeout: FIXTURE_TX_TIMEOUT_MS,
    maxWait: 30_000,
  });
}

/**
 * Builds one LEGACY world (see the file header) and commits it.
 *
 * @param label - Prefix for names, to tell worlds apart in the database.
 * @param now - The instant every window is placed around.
 * @returns The ids of the world.
 */
export async function buildLargeWorld(
  label: string,
  now: Date = new Date()
): Promise<LargeWorld> {
  const F = LARGE_FIXTURE;
  const t0 = now.getTime();
  const at = (hours: number): Date => new Date(t0 + hours * HOUR);
  const totalPerAsset = F.locations * F.unitsPerPlacement;

  // Workspace, owner, first pool asset, locations, and the other assets with
  // their placements: one transaction.
  const base = await commitLong(async (tx) => {
    const pool = await seedOrgWithPool(tx, {
      total: totalPerAsset,
      placements: Array.from({ length: F.locations }, (_, i) => ({
        name: `${label} L${String(i + 1).padStart(2, "0")}`,
        quantity: F.unitsPerPlacement,
      })),
    });
    const { organizationId, userId, locationIds } = pool;

    // The other pool assets, then the spare asset, then the kit asset.
    const extraAssetIds = Array.from({ length: F.poolAssets + 1 }, () =>
      randomUUID()
    );
    const assetRows: Prisma.AssetCreateManyInput[] = extraAssetIds.map(
      (id, i) => ({
        id,
        title: `${label} pool ${i + 1}`,
        type: "QUANTITY_TRACKED",
        quantity: totalPerAsset,
        consumptionType: "TWO_WAY",
        userId,
        organizationId,
      })
    );
    for (const chunk of chunks(assetRows)) {
      await tx.asset.createMany({ data: chunk });
    }

    const poolAssetIds = [
      pool.assetId,
      ...extraAssetIds.slice(0, F.poolAssets - 1),
    ];
    const spareAssetId = nth(extraAssetIds, F.poolAssets - 1);
    const kitAssetId = nth(extraAssetIds, F.poolAssets);

    // Every asset but the first (seeded with its placements) is placed at
    // every location.
    const placementRows: Prisma.AssetLocationCreateManyInput[] =
      extraAssetIds.flatMap((assetId) =>
        locationIds.map((locationId) => ({
          id: randomUUID(),
          assetId,
          locationId,
          organizationId,
          quantity: F.unitsPerPlacement,
        }))
      );
    for (const chunk of chunks(placementRows)) {
      await tx.assetLocation.createMany({ data: chunk });
    }

    const { assetKitId } = await seedKit(
      tx,
      { ...pool, assetId: kitAssetId },
      F.kitQuantity
    );

    return {
      pool,
      poolAssetIds,
      spareAssetId,
      kitAssetId,
      assetKitId,
      assets: assetRows.length + 1,
      placements: placementRows.length + F.locations,
    };
  });

  const { pool, poolAssetIds, kitAssetId, assetKitId } = base;
  const { organizationId, userId, locationIds } = pool;
  const locationAt = (index: number): string =>
    nth(locationIds, index % locationIds.length);

  const bookingRows: Prisma.BookingCreateManyInput[] = [];
  const sliceRows: Prisma.BookingAssetCreateManyInput[] = [];
  const logRows: Prisma.ConsumptionLogCreateManyInput[] = [];

  /** Adds a booking row and returns its in-memory record. */
  const addBooking = (
    name: string,
    status: BookingStatus,
    window: TestWindow
  ): LargeBooking => {
    const bookingId = randomUUID();
    bookingRows.push({
      id: bookingId,
      name,
      status,
      from: window.from,
      to: window.to,
      creatorId: userId,
      organizationId,
    });
    return { bookingId, status, window, slices: [] };
  };

  /** Adds a slice row to a booking. */
  const addSliceRow = (
    booking: LargeBooking,
    input: {
      assetId: string;
      quantity: number;
      assetKitId?: string | null;
      checkedOutQuantity?: number;
      sourceLocationId?: string | null;
    }
  ): LargeBookingSlice => {
    const slice: LargeBookingSlice = {
      id: randomUUID(),
      assetId: input.assetId,
      assetKitId: input.assetKitId ?? null,
      sourceLocationId: input.sourceLocationId ?? null,
    };
    const out = input.checkedOutQuantity ?? 0;
    sliceRows.push({
      id: slice.id,
      bookingId: booking.bookingId,
      assetId: slice.assetId,
      quantity: input.quantity,
      assetKitId: slice.assetKitId,
      checkedOutQuantity: out,
      checkedOutAt: out > 0 ? booking.window.from : null,
      sourceLocationId: slice.sourceLocationId,
    });
    booking.slices.push(slice);
    return slice;
  };

  /** Adds `count` tagged RETURN logs for a slice, spaced `stepHours` apart. */
  const addReturns = (
    booking: LargeBooking,
    slice: LargeBookingSlice,
    count: number,
    stepHours: number
  ): void => {
    for (let r = 0; r < count; r += 1) {
      logRows.push({
        id: randomUUID(),
        assetId: slice.assetId,
        category: "RETURN",
        quantity: F.returnUnits,
        userId,
        bookingId: booking.bookingId,
        bookingAssetId: slice.id,
        locationId: slice.sourceLocationId,
        createdAt: new Date(
          booking.window.from.getTime() + (r + 1) * stepHours * HOUR
        ),
      });
    }
  };

  const bigReserved = addBooking(`${label} big reserved`, "RESERVED", {
    from: at(-1),
    to: at(48),
  });
  poolAssetIds.forEach((assetId) =>
    addSliceRow(bigReserved, { assetId, quantity: F.reservedSliceQuantity })
  );

  // Out = dispatched minus returned = ongoingSliceQuantity: the whole slice.
  const bigOngoing = addBooking(`${label} big ongoing`, "ONGOING", {
    from: at(-48),
    to: at(48),
  });
  poolAssetIds.forEach((assetId, i) => {
    const slice = addSliceRow(bigOngoing, {
      assetId,
      quantity: F.ongoingSliceQuantity,
      checkedOutQuantity:
        F.ongoingSliceQuantity + F.ongoingReturnsPerSlice * F.returnUnits,
      sourceLocationId: locationAt(i),
    });
    addReturns(bigOngoing, slice, F.ongoingReturnsPerSlice, 8);
  });

  const bigDraft = addBooking(`${label} big draft`, "DRAFT", {
    from: at(24),
    to: at(72),
  });
  poolAssetIds.forEach((assetId) =>
    addSliceRow(bigDraft, { assetId, quantity: F.draftSliceQuantity })
  );

  // Dispatched 100 over sixty days, 95 returned in 19 logs: 5 still out.
  const historyBookings: LargeBooking[] = [];
  for (let h = 0; h < F.historyBookings; h += 1) {
    const booking = addBooking(`${label} history ${h + 1}`, "ONGOING", {
      from: at(-60 * 24),
      to: at(30 * 24),
    });
    for (let j = 0; j < F.slicesPerHistoryBooking; j += 1) {
      const index = (h * F.slicesPerHistoryBooking + j) % poolAssetIds.length;
      const returned = F.historyReturnsPerSlice * F.returnUnits;
      const slice = addSliceRow(booking, {
        assetId: nth(poolAssetIds, index),
        quantity: F.historySliceQuantity,
        checkedOutQuantity: returned + F.returnUnits,
        sourceLocationId: locationAt(index),
      });
      addReturns(booking, slice, F.historyReturnsPerSlice, 72);
    }
    historyBookings.push(booking);
  }

  const competingBookings: LargeBooking[] = [];
  for (let k = 0; k < F.competingBookings; k += 1) {
    const ongoing = k % F.ongoingEvery === 0;
    const booking = addBooking(
      `${label} competing ${k + 1}`,
      ongoing ? "ONGOING" : "RESERVED",
      { from: at(-(k % 48) - 1), to: at(24 + (k % 72)) }
    );
    for (let j = 0; j < F.slicesPerCompetingBooking; j += 1) {
      const index = (k * F.slicesPerCompetingBooking + j) % poolAssetIds.length;
      addSliceRow(booking, {
        assetId: nth(poolAssetIds, index),
        quantity: F.competingSliceQuantity,
        checkedOutQuantity: ongoing ? F.competingSliceQuantity : 0,
        sourceLocationId: ongoing ? locationAt(k + j) : null,
      });
    }
    if (k < F.kitBookings) {
      addSliceRow(booking, {
        assetId: kitAssetId,
        assetKitId,
        quantity: F.kitQuantity,
      });
    }
    competingBookings.push(booking);
  }

  await commitLong(async (tx) => {
    for (const chunk of chunks(bookingRows)) {
      await tx.booking.createMany({ data: chunk });
    }
    for (const chunk of chunks(sliceRows)) {
      await tx.bookingAsset.createMany({ data: chunk });
    }
  });
  await commitLong(async (tx) => {
    for (const chunk of chunks(logRows)) {
      await tx.consumptionLog.createMany({ data: chunk });
    }
  });

  return {
    pool,
    organizationId,
    userId,
    locationIds,
    poolAssetIds,
    spareAssetId: base.spareAssetId,
    kitAssetId,
    assetKitId,
    bigReserved,
    bigOngoing,
    bigDraft,
    historyBookings,
    competingBookings,
    counts: {
      assets: base.assets,
      placements: base.placements,
      bookings: bookingRows.length,
      slices: sliceRows.length,
      dispositionLogs: logRows.length,
    },
  };
}

/**
 * Every booking of a world, big bookings first.
 *
 * @param world - A built world.
 * @returns The bookings.
 */
export function allBookings(world: LargeWorld): LargeBooking[] {
  return [
    world.bigReserved,
    world.bigOngoing,
    world.bigDraft,
    ...world.historyBookings,
    ...world.competingBookings,
  ];
}

/**
 * The distinct assets of a booking's slices.
 *
 * @param booking - A fixture booking.
 * @returns The asset ids.
 */
export function assetIdsOf(booking: LargeBooking): string[] {
  return [...new Set(booking.slices.map((s) => s.assetId))];
}

/** What {@link convertLargeWorld} did. */
export type ConversionStats = {
  /** Bookings converted, one committed transaction each. */
  bookings: number;
  /** Wall time of the whole conversion. */
  elapsedMs: number;
  /** Slowest single booking conversion. */
  slowestMs: number;
  /** Slices still LEGACY afterwards (held-back groups). */
  legacySlicesLeft: number;
  /** Source rows and shares written. */
  sourceRows: number;
  shares: number;
};

/**
 * Converts every group of a world with the real check-in entry points: per
 * booking, lock it, `openSettlement` over all its assets with adoption on
 * (which converts every LEGACY group), then `commitSettlement` with nothing
 * settled (which writes the rows and shares). One committed transaction per
 * booking, so the deferred contract checks judge each conversion.
 *
 * @param world - A world from {@link buildLargeWorld}, still LEGACY.
 * @returns Timing and the rows written.
 */
export async function convertLargeWorld(
  world: LargeWorld
): Promise<ConversionStats> {
  const started = performance.now();
  let slowestMs = 0;
  const bookings = allBookings(world);
  for (const booking of bookings) {
    const bookingStarted = performance.now();
    await commitLong(async (tx) => {
      await lockBooking(tx, booking.bookingId);
      const settlement = await openSettlement(tx, {
        organizationId: world.organizationId,
        bookingId: booking.bookingId,
        assetIds: assetIdsOf(booking),
        adoptionEnabled: true,
      });
      await commitSettlement(tx, settlement);
    });
    slowestMs = Math.max(slowestMs, performance.now() - bookingStarted);
  }
  const elapsedMs = performance.now() - started;

  const db = getTestDb();
  const [legacySlicesLeft, sourceRows, shares] = await Promise.all([
    db.bookingAsset.count({
      where: {
        booking: { organizationId: world.organizationId },
        sourceAllocation: "LEGACY",
      },
    }),
    db.bookingAssetSource.count({
      where: { organizationId: world.organizationId },
    }),
    db.bookingDispositionShare.count({
      where: { organizationId: world.organizationId },
    }),
  ]);
  return {
    bookings: bookings.length,
    elapsedMs,
    slowestMs,
    legacySlicesLeft,
    sourceRows,
    shares,
  };
}
