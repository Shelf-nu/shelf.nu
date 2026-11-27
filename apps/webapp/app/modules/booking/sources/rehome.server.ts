/**
 * Booking sources: database side of a placement change.
 *
 * When a pool's manual placements change, booking units out on converted
 * slices follow the moved stock exactly like operator custody does. This
 * module reads those units per source row ({@link loadBookingOutRows}) and
 * persists the partial moves the pure planner `planSourceRehome` decides
 * ({@link applySourceMoves}) through the one repository writer.
 *
 * Rules:
 * - Only LOCATION and UNPLACED rows of AUTO / MANUAL slices on ONGOING or
 *   OVERDUE bookings occupy a loose source. KIT and UNKNOWN rows, pending
 *   units, LEGACY slices and terminal bookings never move here: pending holds
 *   at a shrunk placement stay put and become short.
 * - The caller holds the asset lock of every pool it passes; this module
 *   takes no lock and writes source rows only, never booking rows.
 * - With no converted slice out on a pool, the only cost is one indexed
 *   probe on `BookingAsset`.
 *
 * @see {@link file://./rehome.ts} the pure planner
 * @see {@link file://./repository.server.ts} the writer
 * @see {@link file://../../asset/custody-source.server.ts} the placement-change caller
 */

import { BookingStatus } from "@prisma/client";
import { sourceKey } from "@shelf/quantity-control";
import type { SourceKind } from "@shelf/quantity-control";

import { ShelfError } from "~/utils/error";

import type { BookingOutRow, SourceMove } from "./rehome";
import { writeSourcePlan } from "./repository.server";
import type { SourceRowWrite, SourcesTx } from "./repository.server";

/** Statuses whose units are physically out. */
const PHYSICAL_STATUSES: ReadonlySet<string> = new Set<string>([
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
]);

/** Every kind a `sourceKey` can start with. */
const KINDS: readonly SourceKind[] = [
  "LOCATION",
  "UNPLACED",
  "UNKNOWN",
  "UNASSIGNED",
  "KIT",
];

/**
 * Reads a `sourceKey` back into its kind and location.
 *
 * @param key - A key built by `sourceKey`
 * @returns The row identity the key stands for
 * @throws {ShelfError} 500 for a key no writer builds (a bug in the caller)
 */
export function parseSourceKey(key: string): {
  kind: SourceKind;
  locationId: string | null;
} {
  const separator = key.indexOf(":");
  const kind = KINDS.find((k) => k === key.slice(0, separator));
  const locationId = separator < 0 ? "" : key.slice(separator + 1);
  if (
    separator < 0 ||
    !kind ||
    (kind === "LOCATION") !== locationId.length > 0
  ) {
    throw new ShelfError({
      cause: null,
      title: "Booking sources",
      message: "A planned source row has an unreadable key.",
      additionalData: { key },
      label: "Booking",
      status: 500,
    });
  }
  return { kind, locationId: kind === "LOCATION" ? locationId : null };
}

/**
 * Wraps an error thrown by a pure planner (a plain `Error`, which means a
 * bug, never a user mistake) in a captured 500 `ShelfError`. A `ShelfError`
 * passes through unchanged.
 *
 * @param cause - What the planner threw
 * @param additionalData - Context for support
 * @returns The error to throw
 */
export function plannerFailure(
  cause: unknown,
  additionalData: Record<string, string | string[] | number>
): ShelfError {
  if (cause instanceof ShelfError) return cause;
  return new ShelfError({
    cause,
    title: "Booking sources",
    message: "Could not move the booking units at this location.",
    additionalData,
    label: "Booking",
    status: 500,
    shouldBeCaptured: true,
  });
}

/**
 * Reads the source rows with units out on converted slices of several pools.
 *
 * One indexed probe on `BookingAsset` (AUTO / MANUAL slices of the pools on
 * ONGOING or OVERDUE bookings); only when it finds some, one read of their
 * LOCATION and UNPLACED rows with `outQuantity > 0`. Both reads are scoped
 * by the caller's trusted workspace id, so a pool id from another workspace
 * reads nothing.
 *
 * @param tx - The caller's transaction, holding the pools' asset locks
 * @param args.organizationId - The trusted workspace id
 * @param args.assetIds - Pools to read
 * @returns assetId -> its rows with units out; a pool with none is absent
 */
export async function loadBookingOutRows(
  tx: Pick<SourcesTx, "bookingAsset" | "bookingAssetSource">,
  { organizationId, assetIds }: { organizationId: string; assetIds: string[] }
): Promise<Map<string, BookingOutRow[]>> {
  const result = new Map<string, BookingOutRow[]>();
  const ids = [...new Set(assetIds)];
  if (ids.length === 0) return result;

  const found = await tx.bookingAsset.findMany({
    where: {
      assetId: { in: ids },
      sourceAllocation: { in: ["AUTO", "MANUAL"] },
      booking: {
        organizationId,
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
      },
    },
    select: {
      id: true,
      assetId: true,
      checkedOutAt: true,
      sourceAllocation: true,
      booking: { select: { status: true } },
    },
  });
  // The query already filters these; re-checking keeps the rule readable in
  // one place: only converted standalone slices out right now occupy a source.
  const slices = found.filter(
    (s) =>
      (s.sourceAllocation === "AUTO" || s.sourceAllocation === "MANUAL") &&
      s.booking !== null &&
      PHYSICAL_STATUSES.has(s.booking.status)
  );
  if (slices.length === 0) return result;

  const sliceById = new Map(slices.map((s) => [s.id, s]));
  const rows = await tx.bookingAssetSource.findMany({
    where: {
      organizationId,
      bookingAssetId: { in: [...sliceById.keys()] },
      kind: { in: ["LOCATION", "UNPLACED"] },
      outQuantity: { gt: 0 },
    },
    select: {
      id: true,
      bookingAssetId: true,
      kind: true,
      locationId: true,
      outQuantity: true,
    },
    orderBy: { id: "asc" },
  });

  for (const row of rows) {
    const slice = sliceById.get(row.bookingAssetId);
    if (!slice || row.outQuantity <= 0) continue;
    if (row.kind !== "LOCATION" && row.kind !== "UNPLACED") continue;
    const pool = result.get(slice.assetId) ?? [];
    pool.push({
      sourceRowId: row.id,
      sliceId: slice.id,
      // A slice with units out always has a check-out time; the epoch keeps
      // a row without one last in the latest-dispatched-first drain.
      sliceCheckedOutAt: slice.checkedOutAt ?? new Date(0),
      key: sourceKey(row),
      out: row.outQuantity,
    });
    result.set(slice.assetId, pool);
  }
  return result;
}

/** Counters of a row being planned. */
type Counters = Omit<SourceRowWrite, "bookingAssetId" | "kind" | "locationId">;

/**
 * Persists booking partial moves: for each move, the origin row loses
 * `units` of `quantity`, `outQuantity` and `dispatchedTotal`, and the slice's
 * row at `toKey` gains the same (created when absent). Shares stay on the
 * origin, so both rows keep `dispatchedTotal - shares = out`.
 *
 * One read of the slices' rows, then one `writeSourcePlan`. No-op for an
 * empty list.
 *
 * @param tx - The caller's transaction, holding the pools' asset locks
 * @param args.organizationId - The trusted workspace id
 * @param args.moves - Moves from `planSourceRehome`
 * @throws {ShelfError} 500 when a move names a row that is gone or would go
 *   below zero (the plan was made on other numbers); nothing is written
 */
export async function applySourceMoves(
  tx: SourcesTx,
  { organizationId, moves }: { organizationId: string; moves: SourceMove[] }
): Promise<void> {
  const effective = moves.filter((m) => m.units > 0);
  if (effective.length === 0) return;

  const sliceIds = [...new Set(effective.map((m) => m.sliceId))];
  const existing = await tx.bookingAssetSource.findMany({
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
  });

  /** slice id | source key -> the row as it will end. */
  const planned = new Map<string, SourceRowWrite>();
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const r of existing) {
    planned.set(`${r.bookingAssetId}|${sourceKey(r)}`, { ...r });
  }

  const bump = (row: Counters, units: number) => {
    row.quantity += units;
    row.outQuantity += units;
    row.dispatchedTotal += units;
  };
  const touched = new Set<string>();

  for (const move of effective) {
    const origin = byId.get(move.sourceRowId);
    const originKey = origin
      ? `${origin.bookingAssetId}|${sourceKey(origin)}`
      : "";
    const from = planned.get(originKey);
    if (
      !origin ||
      origin.bookingAssetId !== move.sliceId ||
      !from ||
      from.outQuantity < move.units
    ) {
      throw new ShelfError({
        cause: null,
        title: "Booking sources",
        message: "Could not move the booking units at this location.",
        additionalData: {
          organizationId,
          sourceRowId: move.sourceRowId,
          sliceId: move.sliceId,
          units: move.units,
        },
        label: "Booking",
        status: 500,
      });
    }
    bump(from, -move.units);
    touched.add(originKey);

    const toKey = `${move.sliceId}|${move.toKey}`;
    let to = planned.get(toKey);
    if (!to) {
      const { kind, locationId } = parseSourceKey(move.toKey);
      to = {
        bookingAssetId: move.sliceId,
        kind,
        locationId,
        quantity: 0,
        outQuantity: 0,
        releasedQuantity: 0,
        dispatchedTotal: 0,
      };
      planned.set(toKey, to);
    }
    bump(to, move.units);
    touched.add(toKey);
  }

  await writeSourcePlan(tx, {
    organizationId,
    plan: {
      upsertRows: [...touched].flatMap((k) => {
        const row = planned.get(k);
        return row ? [row] : [];
      }),
      deleteRowIds: [],
      insertShares: [],
      repointShares: [],
      setModes: [],
    },
  });
}
