/**
 * Booking sources: per-source capacity, competing holds, free units over a
 * window, and physical units on hand now.
 *
 * A pool's loose sources are its manual placements (`AssetLocation` rows with
 * `assetKitId` NULL, one per location) and its unplaced units
 * (`Asset.quantity` minus every manual placement). Kit-driven placements and
 * KIT source rows never appear here: kit units stay on the kit and pool axes.
 *
 * - Capacity of a source = units placed there minus operator custody taken
 *   from there. Custody with no recorded source (`sourceUnknown`) and
 *   kit-inherited custody count against no source.
 * - A competing hold is the remaining reservation (`quantity -
 *   releasedQuantity` = pending + out) of a LOCATION or UNPLACED row on an
 *   active booking (RESERVED, ONGOING, OVERDUE). Drafts hold nothing, LEGACY
 *   slices hold nothing at a source (the pool check bounds them), and the
 *   booking being admitted is excluded.
 * - Free at a source over a window = capacity minus the peak, over the
 *   half-open window, of competing holds there, floored at 0.
 * - Physical now at a source = capacity minus units out right now: the
 *   `outQuantity` of LOCATION / UNPLACED rows on ONGOING or OVERDUE bookings,
 *   plus LEGACY units out from that location (`loadBookedOutBySource`).
 *   Terminal bookings never count.
 *
 * Every read is scoped by the caller's trusted `organizationId` and runs in
 * the caller's transaction; the caller holds the asset locks.
 *
 * @see {@link file://./repository.server.ts} the writer of source rows
 * @see {@link file://../units-out-by-source.server.ts} LEGACY units out
 * @see {@link file://../../../../../../packages/quantity-control/src/source-allocation.ts} the allocation rule
 */

import { BookingStatus } from "@prisma/client";
import {
  ACTIVE_BOOKING_STATUSES,
  peakConcurrent,
  resolveIntervalTo,
  sourceKey,
} from "@shelf/quantity-control";
import type {
  AvailabilityInterval,
  SourceFree,
  SourceHold,
} from "@shelf/quantity-control";

import type { ExtendedPrismaClient } from "~/database/db.server";
import { buildActiveBookingWhere } from "~/modules/asset/availability-primitives.server";

import {
  bookedOutFromLegacySourcedSlices,
  LEGACY_SOURCED_SLICE_WHERE,
  loadBookedOutBySource,
} from "../units-out-by-source.server";

/** The transaction client these readers need. */
export type CapacityTx = Pick<
  ExtendedPrismaClient,
  | "asset"
  | "assetLocation"
  | "custody"
  | "bookingAsset"
  | "bookingAssetSource"
  | "consumptionLog"
>;

/** A booking window, half-open `[from, to)`. */
export type CapacityWindow = { from: Date; to: Date };

/** Source key of a pool's unplaced units. */
const UNPLACED_KEY = sourceKey({ kind: "UNPLACED", locationId: null });

/** Statuses whose units are physically out. */
const PHYSICAL_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
]);

/** Statuses whose source rows hold units (drafts hold nothing). */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set<string>(
  ACTIVE_BOOKING_STATUSES
);

/** One pool's loose sources: capacity per key and placement creation order. */
type PoolSources = {
  /** sourceKey -> placed minus custody taken from it. */
  capacity: Map<string, number>;
  /** Location ids of manual placements, oldest first. */
  locationOrder: string[];
};

/**
 * Reads capacity and placement order for several pools in three queries.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - Pools to read
 * @returns Per asset id; an asset outside the workspace is absent
 */
async function loadPoolSources(
  tx: CapacityTx,
  { organizationId, assetIds }: { organizationId: string; assetIds: string[] }
): Promise<Map<string, PoolSources>> {
  const result = new Map<string, PoolSources>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return result;

  const [assets, placements, custody] = await Promise.all([
    tx.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: a booking already holding an archived pool still needs its source numbers
      where: { id: { in: ids }, organizationId },
      select: { id: true, quantity: true },
    }),
    tx.assetLocation.findMany({
      where: { assetId: { in: ids }, organizationId, assetKitId: null },
      select: { assetId: true, locationId: true, quantity: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.custody.groupBy({
      by: ["assetId", "locationId"],
      where: {
        assetId: { in: ids },
        asset: { organizationId },
        // Operator custody with a recorded source only: kit-inherited rows
        // are kit units, and an unrecorded source counts against no place.
        kitCustodyId: null,
        sourceUnknown: false,
      },
      _sum: { quantity: true },
    }),
  ]);

  for (const asset of assets) {
    result.set(asset.id, {
      capacity: new Map([[UNPLACED_KEY, asset.quantity ?? 0]]),
      locationOrder: [],
    });
  }
  for (const p of placements) {
    const pool = result.get(p.assetId);
    if (!pool) continue;
    const key = sourceKey({ kind: "LOCATION", locationId: p.locationId });
    pool.capacity.set(key, (pool.capacity.get(key) ?? 0) + p.quantity);
    pool.capacity.set(
      UNPLACED_KEY,
      (pool.capacity.get(UNPLACED_KEY) ?? 0) - p.quantity
    );
    if (!pool.locationOrder.includes(p.locationId)) {
      pool.locationOrder.push(p.locationId);
    }
  }
  for (const c of custody) {
    const pool = result.get(c.assetId);
    if (!pool) continue;
    const key =
      c.locationId === null
        ? UNPLACED_KEY
        : sourceKey({ kind: "LOCATION", locationId: c.locationId });
    pool.capacity.set(
      key,
      (pool.capacity.get(key) ?? 0) - (c._sum.quantity ?? 0)
    );
  }
  return result;
}

/**
 * Capacity of every loose source of each pool: units placed there minus
 * operator custody taken from there. The unplaced units are always present;
 * a location appears when it has a manual placement or custody taken from it.
 * Values may be negative when custody exceeds what is placed.
 *
 * Three queries, in parallel.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - Pools to read
 * @returns assetId -> sourceKey -> placed minus custody
 */
export async function loadSourceCapacity(
  tx: CapacityTx,
  args: { organizationId: string; assetIds: string[] }
): Promise<Map<string, Map<string, number>>> {
  const pools = await loadPoolSources(tx, args);
  return new Map([...pools].map(([id, pool]) => [id, pool.capacity]));
}

/**
 * Holds of active bookings on the pools' loose sources that compete with a
 * window: one per LOCATION or UNPLACED row of an AUTO or MANUAL slice on a
 * RESERVED, ONGOING or OVERDUE booking overlapping the window (OVERDUE always
 * overlaps). Drafts, LEGACY and KIT slices, rows with nothing left to hold,
 * and the excluded booking are left out.
 *
 * Each hold's interval is its booking's full `[from, to)`, unclipped to the
 * window (the window only selects which bookings are read); an OVERDUE
 * booking's runs to the far-future sentinel because its units have no known
 * return. {@link computeFreeBySource} clips each interval to the window before
 * taking the peak.
 *
 * Two queries, in sequence.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - Pools to read
 * @param args.window - The half-open window competing with
 * @param args.excludeBookingId - The booking being admitted
 * @returns One hold per row with remaining reservation
 */
export async function loadCompetingHolds(
  tx: CapacityTx,
  args: {
    organizationId: string;
    assetIds: string[];
    window: CapacityWindow;
    excludeBookingId?: string;
  }
): Promise<SourceHold[]> {
  const holds = await loadHoldsWithAsset(tx, args);
  return holds.map(({ assetId: _assetId, ...hold }) => hold);
}

/** A {@link SourceHold} that remembers its pool. */
type PoolHold = SourceHold & { assetId: string };

/** {@link loadCompetingHolds}, keeping each hold's asset id. */
async function loadHoldsWithAsset(
  tx: CapacityTx,
  {
    organizationId,
    assetIds,
    window,
    excludeBookingId,
  }: {
    organizationId: string;
    assetIds: string[];
    window: CapacityWindow;
    excludeBookingId?: string;
  }
): Promise<PoolHold[]> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return [];

  const slices = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      sourceAllocation: { in: ["AUTO", "MANUAL"] },
      booking: {
        ...buildActiveBookingWhere(organizationId, window),
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
    },
    select: {
      id: true,
      assetId: true,
      bookingId: true,
      booking: {
        select: { from: true, to: true, status: true, createdAt: true },
      },
    },
  });
  // The query already filters these; re-checking keeps the rule in one
  // readable place: drafts and terminal bookings never hold, nor does the
  // booking being admitted.
  const holding = slices.filter(
    (s) =>
      s.booking !== null &&
      ACTIVE_STATUSES.has(s.booking.status) &&
      s.bookingId !== excludeBookingId
  );
  if (holding.length === 0) return [];

  const sliceById = new Map(holding.map((s) => [s.id, s]));
  const rows = await tx.bookingAssetSource.findMany({
    where: {
      organizationId,
      bookingAssetId: { in: [...sliceById.keys()] },
      kind: { in: ["LOCATION", "UNPLACED"] },
    },
    select: {
      bookingAssetId: true,
      kind: true,
      locationId: true,
      quantity: true,
      outQuantity: true,
      releasedQuantity: true,
    },
  });

  const holds: PoolHold[] = [];
  for (const row of rows) {
    if (row.kind !== "LOCATION" && row.kind !== "UNPLACED") continue;
    const slice = sliceById.get(row.bookingAssetId);
    if (!slice?.booking) continue;
    const out = row.outQuantity;
    const pending = Math.max(0, row.quantity - row.releasedQuantity - out);
    if (out + pending === 0) continue;
    holds.push({
      assetId: slice.assetId,
      sliceId: slice.id,
      sourceKey: sourceKey(row),
      bookingFrom: slice.booking.from,
      bookingCreatedAt: slice.booking.createdAt,
      bookingId: slice.bookingId,
      from: slice.booking.from,
      to: resolveIntervalTo(
        slice.booking.status,
        slice.booking.to,
        slice.booking.to
      ),
      out,
      pending,
    });
  }
  return holds;
}

/**
 * Peak of the holds' remaining reservation over a half-open window. Each
 * interval is clipped to the window first, so a hold ending exactly when the
 * window starts (or starting when it ends) contributes nothing.
 */
function peakOverWindow(holds: SourceHold[], window: CapacityWindow): number {
  const intervals: AvailabilityInterval[] = [];
  for (const h of holds) {
    const from = Math.max(h.from.getTime(), window.from.getTime());
    const to = Math.min(h.to.getTime(), window.to.getTime());
    if (from >= to) continue;
    intervals.push({
      from: new Date(from),
      to: new Date(to),
      qty: h.out + h.pending,
    });
  }
  return peakConcurrent(intervals);
}

/**
 * Free units at each loose source of several pools over a window: capacity
 * minus the peak of competing holds there, floored at 0. Each pool's list
 * has the unplaced units first (`createdOrder` -1), then every manual
 * placement in creation order (`createdOrder` 0, 1, ...), ready for the
 * allocation rule.
 *
 * Five queries in two parallel rounds (capacity: three; holds: two),
 * whatever the number of pools.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - The pools
 * @param args.window - The half-open window to admit over
 * @param args.excludeBookingId - The booking being admitted
 * @returns assetId -> free units per source; a pool outside the workspace is absent
 */
export async function computeFreeBySourceForPools(
  tx: CapacityTx,
  args: {
    organizationId: string;
    assetIds: string[];
    window: CapacityWindow;
    excludeBookingId?: string;
  }
): Promise<Map<string, SourceFree[]>> {
  const { organizationId, window, excludeBookingId } = args;
  const assetIds = [...new Set(args.assetIds)];
  const result = new Map<string, SourceFree[]>();
  if (assetIds.length === 0) return result;

  const [pools, holds] = await Promise.all([
    loadPoolSources(tx, { organizationId, assetIds }),
    loadHoldsWithAsset(tx, {
      organizationId,
      assetIds,
      window,
      excludeBookingId,
    }),
  ]);

  for (const [assetId, pool] of pools) {
    const poolHolds = holds.filter((h) => h.assetId === assetId);
    const freeAt = (key: string) =>
      Math.max(
        0,
        (pool.capacity.get(key) ?? 0) -
          peakOverWindow(
            poolHolds.filter((h) => h.sourceKey === key),
            window
          )
      );
    result.set(assetId, [
      {
        kind: "UNPLACED",
        locationId: null,
        free: freeAt(UNPLACED_KEY),
        createdOrder: -1,
      },
      ...pool.locationOrder.map(
        (locationId, index): SourceFree => ({
          kind: "LOCATION",
          locationId,
          free: freeAt(sourceKey({ kind: "LOCATION", locationId })),
          createdOrder: index,
        })
      ),
    ]);
  }
  return result;
}

/**
 * Free units at each loose source of one pool over a window: the one-pool
 * form of {@link computeFreeBySourceForPools}. Five queries.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetId - The pool
 * @param args.window - The half-open window to admit over
 * @param args.excludeBookingId - The booking being admitted
 * @returns Free units per source; empty when the pool is not in the workspace
 */
export async function computeFreeBySource(
  tx: CapacityTx,
  args: {
    organizationId: string;
    assetId: string;
    window: CapacityWindow;
    excludeBookingId?: string;
  }
): Promise<SourceFree[]> {
  const { assetId, ...rest } = args;
  const byPool = await computeFreeBySourceForPools(tx, {
    ...rest,
    assetIds: [assetId],
  });
  return byPool.get(assetId) ?? [];
}

/**
 * {@link loadCompetingHolds} for several pools at once, grouped by pool:
 * two queries whatever the number of pools.
 *
 * @param tx - The caller's transaction
 * @param args - As {@link loadCompetingHolds}
 * @returns assetId -> holds; a pool with none is absent
 */
export async function loadCompetingHoldsByPool(
  tx: CapacityTx,
  args: {
    organizationId: string;
    assetIds: string[];
    window: CapacityWindow;
    excludeBookingId?: string;
  }
): Promise<Map<string, SourceHold[]>> {
  const holds = await loadHoldsWithAsset(tx, args);
  const byPool = new Map<string, SourceHold[]>();
  for (const { assetId, ...hold } of holds) {
    const list = byPool.get(assetId) ?? [];
    list.push(hold);
    byPool.set(assetId, list);
  }
  return byPool;
}

/**
 * Units physically on hand at each loose source of each pool right now:
 * capacity minus units out now. Units out now are the `outQuantity` of
 * LOCATION / UNPLACED rows of AUTO or MANUAL slices on ONGOING or OVERDUE
 * bookings, plus LEGACY units out from each location
 * (`loadBookedOutBySource`). KIT rows and kit slices never count, so a kit
 * departure never lowers loose units. Not windowed. Values may be negative.
 *
 * Queries: capacity (three), converted slices then their rows (two), and
 * `loadBookedOutBySource` (one to three), in three parallel lanes.
 *
 * @param tx - The caller's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - Pools to read
 * @returns assetId -> sourceKey -> units on hand now
 */
export async function loadPhysicalNow(
  tx: CapacityTx,
  { organizationId, assetIds }: { organizationId: string; assetIds: string[] }
): Promise<Map<string, Map<string, number>>> {
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return new Map();

  const [pools, convertedOut, legacyOut] = await Promise.all([
    loadPoolSources(tx, { organizationId, assetIds: ids }),
    loadConvertedOutNow(tx, organizationId, ids),
    loadBookedOutBySource(tx, { assetIds: ids, organizationId }),
  ]);

  const result = new Map<string, Map<string, number>>();
  for (const [assetId, pool] of pools) {
    result.set(assetId, new Map(pool.capacity));
  }
  const subtract = (assetId: string, key: string, quantity: number) => {
    const perSource = result.get(assetId);
    if (!perSource) return;
    perSource.set(key, (perSource.get(key) ?? 0) - quantity);
  };
  for (const { assetId, key, quantity } of convertedOut) {
    subtract(assetId, key, quantity);
  }
  for (const [assetId, perLocation] of legacyOut) {
    for (const { locationId, quantity } of perLocation) {
      subtract(assetId, sourceKey({ kind: "LOCATION", locationId }), quantity);
    }
  }
  return result;
}

/** The client {@link loadUnitsOutBySource} reads through. */
type UnitsOutTx = Pick<
  ExtendedPrismaClient,
  "bookingAsset" | "bookingAssetSource" | "consumptionLog"
>;

/**
 * Units out now on converted slices, per pool and loose source: LOCATION and
 * UNPLACED rows of AUTO / MANUAL slices on ONGOING or OVERDUE bookings.
 */
async function loadConvertedOutNow(
  tx: CapacityTx,
  organizationId: string,
  assetIds: string[]
): Promise<Array<{ assetId: string; key: string; quantity: number }>> {
  const slices = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: assetIds },
      sourceAllocation: { in: ["AUTO", "MANUAL"] },
      booking: {
        organizationId,
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
    },
    select: { id: true, assetId: true, booking: { select: { status: true } } },
  });
  // Terminal and reserved bookings have nothing physically out, whatever
  // their rows still say.
  const assetBySlice = new Map(
    slices
      .filter(
        (s) => s.booking !== null && PHYSICAL_STATUSES.has(s.booking.status)
      )
      .map((s) => [s.id, s.assetId])
  );
  if (assetBySlice.size === 0) return [];

  const rows = await tx.bookingAssetSource.findMany({
    where: {
      organizationId,
      bookingAssetId: { in: [...assetBySlice.keys()] },
      kind: { in: ["LOCATION", "UNPLACED"] },
      outQuantity: { gt: 0 },
    },
    select: {
      bookingAssetId: true,
      kind: true,
      locationId: true,
      outQuantity: true,
    },
  });

  const out: Array<{ assetId: string; key: string; quantity: number }> = [];
  for (const row of rows) {
    if (row.kind !== "LOCATION" && row.kind !== "UNPLACED") continue;
    const assetId = assetBySlice.get(row.bookingAssetId);
    if (!assetId || row.outQuantity <= 0) continue;
    out.push({ assetId, key: sourceKey(row), quantity: row.outQuantity });
  }
  return out;
}

/** Units of one pool out on bookings from one loose source; NULL is Unplaced. */
export type UnitsOutFromSource = {
  locationId: string | null;
  quantity: number;
};

/**
 * Units of each pool out on ONGOING or OVERDUE bookings right now, per loose
 * source they left from, over every group of every booking: LEGACY groups by
 * their recorded `sourceLocationId` (minus what came back, as
 * `loadBookedOutBySource` counts them), converted groups by the `outQuantity`
 * of their LOCATION and UNPLACED rows. A `locationId` of NULL is the unplaced
 * units; only converted rows know that source, so LEGACY units never appear
 * there. Kit units never appear.
 *
 * The custody "From location" numbers and the check-out source snapshot read
 * this, so a unit out on a converted booking is not offered again by either.
 *
 * Queries: one slice read for both kinds of group, then the LEGACY siblings
 * and logs (two, only with LEGACY sourced slices) and the converted rows
 * (one, only with converted slices), in parallel.
 *
 * @param tx - The caller's transaction, or `db` for a read-only loader
 * @param args.assetIds - Pools the caller has already proven belong to the
 *   workspace (a locked row or an org-scoped list)
 * @param args.organizationId - Extra scope when the caller has it
 * @returns Per asset id, the non-zero units out per source
 */
export async function loadUnitsOutBySource(
  tx: UnitsOutTx,
  { assetIds, organizationId }: { assetIds: string[]; organizationId?: string }
): Promise<Map<string, UnitsOutFromSource[]>> {
  const ids = [...new Set(assetIds)];
  const result = new Map<string, UnitsOutFromSource[]>();
  if (ids.length === 0) return result;

  const slices = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      booking: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
      OR: [
        LEGACY_SOURCED_SLICE_WHERE,
        { sourceAllocation: { in: ["AUTO", "MANUAL"] } },
      ],
    },
    select: {
      id: true,
      bookingId: true,
      assetId: true,
      quantity: true,
      assetKitId: true,
      checkedOutQuantity: true,
      sourceLocationId: true,
      sourceAllocation: true,
      booking: { select: { status: true } },
    },
  });
  const isConverted = (s: (typeof slices)[number]) =>
    s.sourceAllocation === "AUTO" || s.sourceAllocation === "MANUAL";
  // Terminal and reserved bookings have nothing physically out, whatever
  // their rows still say.
  const assetBySlice = new Map(
    slices
      .filter(
        (s) =>
          isConverted(s) &&
          s.booking !== null &&
          s.booking !== undefined &&
          PHYSICAL_STATUSES.has(s.booking.status)
      )
      .map((s) => [s.id, s.assetId])
  );

  const [legacyOut, rows] = await Promise.all([
    bookedOutFromLegacySourcedSlices(
      tx,
      slices.filter((s) => !isConverted(s))
    ),
    assetBySlice.size === 0
      ? Promise.resolve([])
      : tx.bookingAssetSource.findMany({
          where: {
            // The slice ids come from the scoped read above.
            ...(organizationId ? { organizationId } : {}),
            bookingAssetId: { in: [...assetBySlice.keys()] },
            kind: { in: ["LOCATION", "UNPLACED"] },
            outQuantity: { gt: 0 },
          },
          select: {
            bookingAssetId: true,
            kind: true,
            locationId: true,
            outQuantity: true,
          },
        }),
  ]);

  const totals = new Map<string, Map<string | null, number>>();
  const add = (assetId: string, locationId: string | null, units: number) => {
    if (units <= 0) return;
    const perSource = totals.get(assetId) ?? new Map<string | null, number>();
    perSource.set(locationId, (perSource.get(locationId) ?? 0) + units);
    totals.set(assetId, perSource);
  };
  for (const [assetId, perLocation] of legacyOut) {
    for (const row of perLocation) add(assetId, row.locationId, row.quantity);
  }
  for (const row of rows) {
    const assetId = assetBySlice.get(row.bookingAssetId);
    if (!assetId) continue;
    if (row.kind === "UNPLACED") add(assetId, null, row.outQuantity);
    else if (row.kind === "LOCATION") {
      add(assetId, row.locationId, row.outQuantity);
    }
  }
  for (const [assetId, perSource] of totals) {
    result.set(
      assetId,
      [...perSource].map(([locationId, quantity]) => ({ locationId, quantity }))
    );
  }
  return result;
}
