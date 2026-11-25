/**
 * Booking sources: evacuation before a location is deleted.
 *
 * `BookingAssetSource.locationId` has no cascade: a location with source rows
 * cannot be deleted. Before deleting locations (single or bulk), the location
 * service calls {@link evacuateLocationsForDelete} inside its transaction. It
 * splits every row at the deleted locations into its parts and moves each to
 * its own target, never merging a row whole:
 * - out units: the unplaced units while they physically cover them, else the
 *   slice's UNKNOWN row (partial move of `quantity`, `out`, `dispatchedTotal`);
 * - history (`dispatchedTotal - out`, with its shares): the slice's UNKNOWN row;
 * - pending units: AUTO slices re-allocate them by the allocation rule over
 *   the remaining sources, involuntary (what fits nowhere goes to
 *   UNASSIGNED); MANUAL slices put them on UNASSIGNED;
 * - released units: UNASSIGNED.
 * Every part of every row at every deleted location is planned first and
 * summed per target row, so each target is written once and two deleted
 * locations never claim the same free units. Slices on RESERVED, ONGOING and
 * OVERDUE bookings are planned first; drafts and finished bookings hold
 * nothing, so their parts go wherever free units remain and claim none. The emptied rows are deleted,
 * and the function refuses (500, nothing deleted) when a row is still at a
 * deleted location afterwards, before the foreign key would.
 *
 * Locking: asset locks only, one sorted statement, before every read that
 * decides; source rows and shares are the only writes. Workspaces without
 * source rows at the locations pay one indexed probe and nothing else.
 *
 * @see {@link file://./rehome.ts} the pure planner
 * @see {@link file://./repository.server.ts} the writer
 * @see {@link file://../../location/service.server.ts} the delete paths
 */

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
import { lockAssetsForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { ShelfError } from "~/utils/error";

import {
  loadCompetingHoldsByPool,
  loadPhysicalNow,
  loadPoolSources,
} from "./capacity.server";
import type { CapacityTx, PoolSources } from "./capacity.server";
import {
  aggregateEvacuationTargets,
  planLocationDeleteEvacuation,
} from "./rehome";
import type { EvacuationRow, EvacuationWrite } from "./rehome";
import { parseSourceKey, plannerFailure } from "./rehome.server";
import { writeSourcePlan } from "./repository.server";
import type {
  SourcePlanWrite,
  SourceRowWrite,
  SourcesTx,
} from "./repository.server";

/** The transaction client evacuation needs: repository, capacity and the lock. */
export type LocationDeleteTx = SourcesTx &
  CapacityTx &
  Pick<ExtendedPrismaClient, "$queryRaw">;

/** `sourceKey` of the unplaced units. */
const UNPLACED_KEY = sourceKey({ kind: "UNPLACED", locationId: null });

/** Statuses whose source rows hold units against other bookings. */
const ACTIVE: ReadonlySet<string> = new Set<string>(ACTIVE_BOOKING_STATUSES);
/** Statuses whose units are physically out now. */
const PHYSICAL: ReadonlySet<string> = new Set<string>(["ONGOING", "OVERDUE"]);
/** Statuses whose rows are still planned: drafts and active bookings. */
const PLANNED: ReadonlySet<string> = new Set<string>(["DRAFT", ...ACTIVE]);

/** A persisted source row with its identity. */
export type PersistedRow = Omit<SourceRowWrite, "bookingAssetId"> & {
  id: string;
  bookingAssetId: string;
};

/** A window, half-open `[from, to)`. */
type SliceWindow = { from: Date; to: Date };

/**
 * The window a slice's pending units are re-allocated over: what is left of
 * its booking from now on (an OVERDUE booking's runs to the far-future
 * sentinel, its units have no known return), at least one millisecond long.
 * `null` for terminal bookings: they hold nothing, so no hold competes.
 *
 * @param booking - The slice's booking
 * @param now - The current instant
 * @returns The window, or null when nothing competes
 */
export function sliceEvacuationWindow(
  booking: { status: string; from: Date; to: Date },
  now: Date
): SliceWindow | null {
  if (!PLANNED.has(booking.status)) return null;
  const from = new Date(Math.max(booking.from.getTime(), now.getTime()));
  const end = resolveIntervalTo(
    booking.status === "OVERDUE" ? "OVERDUE" : undefined,
    booking.to,
    booking.to
  );
  const to =
    end.getTime() > from.getTime() ? end : new Date(from.getTime() + 1);
  return { from, to };
}

/**
 * Free units at each remaining loose source of one pool for one slice: the
 * source's capacity after the delete (a deleted location's capacity joins
 * the unplaced units, since its placements and custody become unplaced)
 * minus the peak over the slice's window of every active booking's holds
 * there, this booking's included (the units being re-allocated are new
 * demand at those sources). Deleted locations are left out.
 *
 * @param args.pool - The pool's capacity per source (placed minus custody,
 *   before the delete) and its placements oldest first, as `loadPoolSources`
 *   returns them; the location order comes from `locationOrder` only
 * @param args.holds - Active holds on the pool
 * @param args.deletedLocationIds - Locations being deleted
 * @param args.window - The slice's window, or null when nothing competes
 * @returns Sources in allocation order (unplaced first, then placements)
 */
export function freeAfterDelete({
  pool,
  holds,
  deletedLocationIds,
  window,
}: {
  pool: PoolSources;
  holds: SourceHold[];
  deletedLocationIds: ReadonlySet<string>;
  window: SliceWindow | null;
}): SourceFree[] {
  const peakAt = (key: string): number => {
    if (!window) return 0;
    const intervals: AvailabilityInterval[] = [];
    for (const h of holds) {
      if (h.sourceKey !== key) continue;
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
  };

  const { capacity, locationOrder } = pool;
  // Every deleted location's capacity joins the unplaced units, also one with
  // custody but no placement (its custody becomes unplaced too).
  let unplaced = capacity.get(UNPLACED_KEY) ?? 0;
  for (const locationId of deletedLocationIds) {
    unplaced += capacity.get(sourceKey({ kind: "LOCATION", locationId })) ?? 0;
  }
  const locations: SourceFree[] = [];
  locationOrder.forEach((locationId, index) => {
    if (deletedLocationIds.has(locationId)) return;
    const key = sourceKey({ kind: "LOCATION", locationId });
    locations.push({
      kind: "LOCATION",
      locationId,
      free: Math.max(0, (capacity.get(key) ?? 0) - peakAt(key)),
      createdOrder: index,
    });
  });
  return [
    {
      kind: "UNPLACED",
      locationId: null,
      free: Math.max(0, unplaced - peakAt(UNPLACED_KEY)),
      createdOrder: -1,
    },
    ...locations,
  ];
}

/**
 * Turns planned evacuation writes into one repository plan:
 * - every origin row ends with all counters 0 and is listed for deletion;
 * - every target row ends with its current counters plus what it receives,
 *   created when the slice has none;
 * - each history move repoints the origin's shares to the slice's target row;
 * - a slice that would keep no row (an all-zero carrier at a deleted
 *   location) gets an all-zero UNASSIGNED row, since a converted slice needs
 *   at least one row.
 *
 * @param args.rows - Every persisted row of the affected slices
 * @param args.origins - The rows at the deleted locations, as planned
 * @param args.writes - The writes `planLocationDeleteEvacuation` returned
 * @returns The plan for `writeSourcePlan`
 * @throws {Error} When a write names a row that is not an origin (a bug)
 */
export function buildEvacuationPlan({
  rows,
  origins,
  writes,
}: {
  rows: PersistedRow[];
  origins: EvacuationRow[];
  writes: EvacuationWrite[];
}): SourcePlanWrite {
  const targets = aggregateEvacuationTargets(writes, origins);
  const originIds = new Set(origins.map((o) => o.id));
  const existing = new Map(
    rows.map((r) => [`${r.bookingAssetId}|${sourceKey(r)}`, r])
  );

  const upsertRows: SourceRowWrite[] = origins.map((o) => ({
    bookingAssetId: o.sliceId,
    kind: o.kind,
    locationId: o.locationId,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
  }));

  const slicesWithTarget = new Set<string>();
  for (const t of targets) {
    const current = existing.get(`${t.sliceId}|${t.toKey}`);
    if (current && originIds.has(current.id)) {
      throw new Error(`Evacuation target ${current.id} is also an origin`);
    }
    const { kind, locationId } = parseSourceKey(t.toKey);
    upsertRows.push({
      bookingAssetId: t.sliceId,
      kind,
      locationId,
      quantity: (current?.quantity ?? 0) + t.quantity,
      outQuantity: (current?.outQuantity ?? 0) + t.outQuantity,
      releasedQuantity: (current?.releasedQuantity ?? 0) + t.releasedQuantity,
      dispatchedTotal: (current?.dispatchedTotal ?? 0) + t.dispatchedTotal,
    });
    slicesWithTarget.add(t.sliceId);
  }

  // A slice whose every row is an origin and that receives nothing keeps an
  // empty UNASSIGNED carrier.
  for (const sliceId of new Set(origins.map((o) => o.sliceId))) {
    if (slicesWithTarget.has(sliceId)) continue;
    const keepsAnother = rows.some(
      (r) => r.bookingAssetId === sliceId && !originIds.has(r.id)
    );
    if (keepsAnother) continue;
    upsertRows.push({
      bookingAssetId: sliceId,
      kind: "UNASSIGNED",
      locationId: null,
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
    });
  }

  const repointShares: SourcePlanWrite["repointShares"] = [];
  const deleteRowIds: string[] = [];
  for (const w of writes) {
    if (w.type === "moveHistory") {
      repointShares.push({
        fromRowId: w.fromRowId,
        toBookingAssetId: w.sliceId,
        toKey: w.toKey,
      });
    } else if (w.type === "deleteRow") {
      deleteRowIds.push(w.sourceRowId);
    }
  }

  return {
    upsertRows,
    deleteRowIds,
    insertShares: [],
    repointShares,
    setModes: [],
  };
}

/** Refuses the delete: something at the locations changed or was missed. */
function refuseDelete(
  message: string,
  status: 409 | 500,
  additionalData: Record<string, string | string[]>
): ShelfError {
  return new ShelfError({
    cause: null,
    title: "Location not deleted",
    message,
    additionalData,
    label: "Location",
    status,
    shouldBeCaptured: status === 500,
  });
}

/**
 * Moves every booking source row away from locations about to be deleted.
 * Call it inside the delete's transaction, right before the delete.
 *
 * Queries: one indexed probe of source rows at the locations; when it finds
 * any, the slices' pools, one sorted asset lock, the rows and slices again
 * under the lock, capacity, holds and physical units of the pools, one
 * repository write and one final check.
 *
 * @param tx - The delete's transaction
 * @param args.organizationId - The trusted workspace id
 * @param args.locationIds - Locations about to be deleted, already proven to
 *   belong to the workspace
 * @param args.now - The current instant (tests pass a fixed one)
 * @throws {ShelfError} 409 when the rows at the locations changed between
 *   the probe and the lock (retry), 500 when a row is still at a deleted
 *   location after the evacuation; nothing has been deleted either way
 */
export async function evacuateLocationsForDelete(
  tx: LocationDeleteTx,
  {
    organizationId,
    locationIds,
    now = new Date(),
  }: { organizationId: string; locationIds: string[]; now?: Date }
): Promise<void> {
  const deleted = new Set(locationIds);
  if (deleted.size === 0) return;
  const ids = [...deleted];

  const probe = await tx.bookingAssetSource.findMany({
    where: { organizationId, locationId: { in: ids } },
    select: { bookingAssetId: true },
  });
  if (probe.length === 0) return;

  const probeSlices = await tx.bookingAsset.findMany({
    where: {
      id: { in: [...new Set(probe.map((r) => r.bookingAssetId))] },
      booking: { organizationId },
    },
    select: { assetId: true },
  });
  const locked = await lockAssetsForQuantityUpdate(
    tx,
    probeSlices.map((s) => s.assetId),
    organizationId
  );
  const lockedIds = new Set((locked ?? []).map((a) => a.id));

  // Every read that decides runs under the lock.
  const atLocations = await tx.bookingAssetSource.findMany({
    where: { organizationId, locationId: { in: ids } },
    select: { bookingAssetId: true },
  });
  if (atLocations.length === 0) return;
  const sliceIds = [...new Set(atLocations.map((r) => r.bookingAssetId))];

  const [slices, rows] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { id: { in: sliceIds }, booking: { organizationId } },
      select: {
        id: true,
        assetId: true,
        bookingId: true,
        checkedOutAt: true,
        sourceAllocation: true,
        booking: { select: { status: true, from: true, to: true } },
      },
    }),
    tx.bookingAssetSource.findMany({
      where: { organizationId, bookingAssetId: { in: sliceIds } },
      select: {
        id: true,
        bookingAssetId: true,
        kind: true,
        locationId: true,
        quantity: true,
        outQuantity: true,
        releasedQuantity: true,
        dispatchedTotal: true,
      },
      orderBy: { id: "asc" },
    }),
  ]);

  const sliceById = new Map(slices.map((s) => [s.id, s]));
  const unlocked = slices.filter((s) => !lockedIds.has(s.assetId));
  if (unlocked.length > 0) {
    throw refuseDelete(
      "Bookings at this location changed while it was being deleted. Please try again.",
      409,
      { organizationId, locationIds: ids }
    );
  }

  // Origins: LOCATION rows at the deleted locations, on standalone slices.
  const origins: Array<EvacuationRow & { assetId: string }> = [];
  for (const r of rows) {
    if (r.kind !== "LOCATION" || !r.locationId || !deleted.has(r.locationId)) {
      continue;
    }
    const slice = sliceById.get(r.bookingAssetId);
    const mode = slice?.sourceAllocation;
    if (!slice?.booking || (mode !== "AUTO" && mode !== "MANUAL")) {
      throw refuseDelete(
        "A booking at this location could not be moved. Nothing was deleted.",
        500,
        { organizationId, locationIds: ids, sourceRowId: r.id }
      );
    }
    origins.push({
      ...r,
      // The reconciliation invariant: shares on a row = its history.
      sharedQuantity: r.dispatchedTotal - r.outQuantity,
      sliceId: slice.id,
      mode,
      sliceCheckedOutAt: slice.checkedOutAt,
      // Drafts and finished bookings hold nothing: their rows move, but
      // never use up free units a holding slice could take.
      holds: ACTIVE.has(slice.booking.status),
      assetId: slice.assetId,
    });
  }

  const assetIds = [...new Set(origins.map((o) => o.assetId))];
  const windows = new Map(
    origins.map((o) => {
      const slice = sliceById.get(o.sliceId);
      return [
        o.sliceId,
        slice?.booking ? sliceEvacuationWindow(slice.booking, now) : null,
      ];
    })
  );
  const planned = [...windows.values()].filter(
    (w): w is SliceWindow => w !== null
  );
  const unionWindow: SliceWindow =
    planned.length === 0
      ? { from: now, to: new Date(now.getTime() + 1) }
      : {
          from: new Date(Math.min(...planned.map((w) => w.from.getTime()))),
          to: new Date(Math.max(...planned.map((w) => w.to.getTime()))),
        };

  const [pools, holdsByPool, physical] = await Promise.all([
    loadPoolSources(tx, { organizationId, assetIds }),
    loadCompetingHoldsByPool(tx, {
      organizationId,
      assetIds,
      window: unionWindow,
    }),
    loadPhysicalNow(tx, { organizationId, assetIds }),
  ]);

  const writes: EvacuationWrite[] = [];
  for (const assetId of assetIds) {
    const poolOrigins = origins.filter((o) => o.assetId === assetId);
    const poolSources = pools.get(assetId) ?? {
      capacity: new Map<string, number>(),
      locationOrder: [],
    };
    const poolHolds = holdsByPool.get(assetId) ?? [];
    const poolPhysical = physical.get(assetId) ?? new Map<string, number>();

    const freeBySlice = new Map<string, SourceFree[]>();
    for (const sliceId of new Set(poolOrigins.map((o) => o.sliceId))) {
      freeBySlice.set(
        sliceId,
        freeAfterDelete({
          pool: poolSources,
          holds: poolHolds,
          deletedLocationIds: deleted,
          window: windows.get(sliceId) ?? null,
        })
      );
    }

    // Units on hand at the unplaced units once the locations are gone: what
    // is there now, plus each deleted location's units on hand and the
    // converted units out from it that are about to move (LEGACY units out
    // from it stay charged against it, the conservative side).
    let unplacedRoomForOut = poolPhysical.get(UNPLACED_KEY) ?? 0;
    for (const locationId of deleted) {
      unplacedRoomForOut +=
        poolPhysical.get(sourceKey({ kind: "LOCATION", locationId })) ?? 0;
    }
    for (const o of poolOrigins) {
      const status = sliceById.get(o.sliceId)?.booking?.status ?? "";
      if (PHYSICAL.has(status)) unplacedRoomForOut += o.outQuantity;
    }

    try {
      writes.push(
        ...planLocationDeleteEvacuation({
          deletedLocationIds: ids,
          rows: poolOrigins,
          freeBySlice,
          unplacedRoomForOut,
        })
      );
    } catch (cause) {
      throw plannerFailure(cause, { organizationId, assetId });
    }
  }

  let plan: SourcePlanWrite;
  try {
    plan = buildEvacuationPlan({ rows, origins, writes });
  } catch (cause) {
    throw plannerFailure(cause, { organizationId, locationIds: ids });
  }
  await writeSourcePlan(tx, { organizationId, plan });

  const remaining = await tx.bookingAssetSource.findMany({
    where: { organizationId, locationId: { in: ids } },
    select: { id: true },
    take: 10,
  });
  if (remaining.length > 0) {
    throw refuseDelete(
      "A booking at this location could not be moved. Nothing was deleted.",
      500,
      {
        organizationId,
        locationIds: ids,
        remainingRowIds: remaining.map((r) => r.id),
      }
    );
  }
}
