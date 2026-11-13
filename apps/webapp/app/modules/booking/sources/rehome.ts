/**
 * Booking source rehome and location delete planners (pure, no DB access).
 *
 * {@link planSourceRehome} decides where booking out units and operator
 * custody go when a pool's placements change. It moves only the excess the
 * change creates at each loose source (the pool's manual placements and the
 * unplaced units), with occupancy = custody + booking out. Booking out units
 * move first, latest dispatched first, then custody takes what is left of
 * the excess through the unchanged {@link planCustodyRehome}, fed a pool
 * state from which the booking units are subtracted so that custody sees
 * only the room the booking moves left. With no booking units out, the
 * custody moves are exactly what `planCustodyRehome` returns.
 *
 * {@link planLocationDeleteEvacuation} splits every source row at a deleted
 * location into its parts (out, history, pending, released), sends each part
 * to its own target, and deletes the emptied row. The caller applies the
 * writes with the package transitions and writes each target once, using
 * {@link aggregateEvacuationTargets}.
 *
 * @see {@link file://../../asset/custody-source.ts} the custody planner
 * @see superpowers/2026-11-10-booking-source-locations-design.md sections 13, 13.1
 */

import {
  allocateSourcesOrUnassigned,
  historyOf,
  pendingOf,
  sourceKey,
} from "@shelf/quantity-control";
import type { SourceFree, SourceRowState } from "@shelf/quantity-control";

import type {
  CustodyRowForPlan,
  CustodySourceState,
  RehomeMove,
} from "~/modules/asset/custody-source";
import {
  placedAtSource,
  planCustodyRehome,
} from "~/modules/asset/custody-source";

/** `sourceKey` of the UNKNOWN row of a slice. */
const UNKNOWN_KEY = sourceKey({ kind: "UNKNOWN", locationId: null });
/** `sourceKey` of the UNPLACED row of a slice. */
const UNPLACED_KEY = sourceKey({ kind: "UNPLACED", locationId: null });
/** `sourceKey` of the UNASSIGNED row of a slice. */
const UNASSIGNED_KEY = sourceKey({ kind: "UNASSIGNED", locationId: null });
/** Prefix of every LOCATION `sourceKey`. */
const LOCATION_PREFIX = sourceKey({ kind: "LOCATION", locationId: "" });

/** `sourceKey` of a LOCATION source, or of the unplaced units for NULL. */
function looseKey(locationId: string | null): string {
  return locationId === null
    ? UNPLACED_KEY
    : sourceKey({ kind: "LOCATION", locationId });
}

/**
 * The loose source a row key occupies: a location id, NULL for the unplaced
 * units, or `undefined` for UNKNOWN, KIT and UNASSIGNED rows, which occupy no
 * loose source.
 */
function looseSourceOf(key: string): string | null | undefined {
  if (key === UNPLACED_KEY) return null;
  if (key.startsWith(LOCATION_PREFIX) && key.length > LOCATION_PREFIX.length) {
    return key.slice(LOCATION_PREFIX.length);
  }
  return undefined;
}

/**
 * Drain order for booking rows: latest slice check-out first, rows of slices
 * never checked out last, then by row id.
 */
function compareLatestDispatchedFirst(
  a: { checkedOutAt: Date | null; id: string },
  b: { checkedOutAt: Date | null; id: string }
): number {
  if (a.checkedOutAt && b.checkedOutAt) {
    const byTime = b.checkedOutAt.getTime() - a.checkedOutAt.getTime();
    if (byTime !== 0) return byTime;
  } else if (a.checkedOutAt) {
    return -1;
  } else if (b.checkedOutAt) {
    return 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Adds `n` to the counter of `key`. */
function bump<K>(map: Map<K, number>, key: K, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/* -------------------------------------------------------------------------- */
/*                                   Rehome                                   */
/* -------------------------------------------------------------------------- */

/** A booking source row with units out, as the rehome planner reads it. */
export type BookingOutRow = {
  /** Id of the source row. */
  sourceRowId: string;
  /** `BookingAsset.id` of the row's slice. */
  sliceId: string;
  /** `BookingAsset.checkedOutAt` of the slice; orders the drain. */
  sliceCheckedOutAt: Date;
  /** `sourceKey` of the row. UNKNOWN and KIT rows are ignored. */
  key: string;
  /** Units out from the row (`outQuantity`). */
  out: number;
};

/** One booking rehome step: a partial move of `units` out units. */
export type SourceMove = {
  /** The origin source row. */
  sourceRowId: string;
  /** The slice both rows belong to. */
  sliceId: string;
  /** `sourceKey` of the origin row. */
  fromKey: string;
  /** `sourceKey` of the destination row of the same slice. */
  toKey: string;
  /** Units moved (`quantity`, `outQuantity` and `dispatchedTotal` each). */
  units: number;
};

/**
 * Copies a pool state with `held` units per loose source taken out of it, so
 * the custody planner sees them as already occupied: a location's placement
 * and the total both drop (its unplaced units stay the same), the unplaced
 * units drop through the total alone. Entries of 0 change nothing.
 */
function withoutHeldUnits(
  state: CustodySourceState,
  held: Map<string | null, number>
): CustodySourceState {
  let total = state.total;
  const placements = [...state.placements];
  for (const [locationId, units] of held) {
    if (units === 0) continue;
    total -= units;
    if (locationId !== null) {
      placements.push({ locationId, quantity: -units });
    }
  }
  return { ...state, total, placements };
}

/**
 * Plans how booking out units and operator custody follow a placement change,
 * without ever refusing it.
 *
 * Per loose source, the excess the change creates is
 * `max(0, min(occupancy - placedAfter, placedBefore - placedAfter))`, with
 * occupancy = custody + booking out (UNKNOWN and KIT rows excluded), so
 * pre-existing drift stays put. Booking out units take the excess first,
 * drained latest dispatched first; their destination is the change's single
 * destination with room, else the unplaced units when they really have room,
 * else UNKNOWN. Custody then moves under the existing custody rules with what
 * is left of the excess and of the room.
 *
 * Runs on the intended post-operation state: settlements are already applied
 * to `bookingOutRows` and stock changes to `after`.
 *
 * @param args.before - The pool as it was, read under the asset lock
 * @param args.after - The pool after the placement write
 * @param args.bookingOutRows - Source rows of the pool's slices with units out
 * @param args.custodyRows - Operator custody rows (with ids) of the pool
 * @param args.destinationLocationId - The one location the change sends units to
 * @returns Booking partial moves and custody moves, in apply order
 */
export function planSourceRehome({
  before,
  after,
  bookingOutRows,
  custodyRows,
  destinationLocationId,
}: {
  before: CustodySourceState;
  after: CustodySourceState;
  bookingOutRows: BookingOutRow[];
  custodyRows: CustodyRowForPlan[];
  destinationLocationId?: string | null;
}): { bookingMoves: SourceMove[]; custodyMoves: RehomeMove[] } {
  const loose = bookingOutRows.filter(
    (row) => row.out > 0 && looseSourceOf(row.key) !== undefined
  );

  /** Booking units out per loose source before any move. */
  const bookedAt = new Map<string | null, number>();
  for (const row of loose) {
    bump(bookedAt, looseSourceOf(row.key) ?? null, row.out);
  }
  const movedOut = new Map<string | null, number>();
  const movedIn = new Map<string | null, number>();

  /** Custody recorded against a source; unrecorded custody counts nowhere. */
  const custodyAt = (locationId: string | null): number =>
    custodyRows
      .filter((row) => row.locationId === locationId && !row.sourceUnknown)
      .reduce((sum, row) => sum + row.quantity, 0);

  /** Free units at a source after the booking moves planned so far. */
  const roomAt = (locationId: string | null): number =>
    Math.max(
      0,
      placedAtSource(after, locationId) -
        custodyAt(locationId) -
        (bookedAt.get(locationId) ?? 0) +
        (movedOut.get(locationId) ?? 0) -
        (movedIn.get(locationId) ?? 0)
    );

  const excessAt = (locationId: string | null): number => {
    const occupancy = custodyAt(locationId) + (bookedAt.get(locationId) ?? 0);
    const placedAfter = placedAtSource(after, locationId);
    const placedBefore = placedAtSource(before, locationId);
    return Math.max(
      0,
      Math.min(occupancy - placedAfter, placedBefore - placedAfter)
    );
  };

  /** Where `want` units leaving `origin` go next, and how many fit there. */
  const pickTarget = (
    origin: string | null,
    want: number
  ): { to: string | null | undefined; units: number } => {
    if (destinationLocationId && destinationLocationId !== origin) {
      const room = roomAt(destinationLocationId);
      if (room > 0) {
        return { to: destinationLocationId, units: Math.min(want, room) };
      }
    }
    if (origin !== null) {
      const room = roomAt(null);
      if (room > 0) return { to: null, units: Math.min(want, room) };
    }
    return { to: undefined, units: want };
  };

  // Locations in id order, then the unplaced units, as the custody planner.
  const origins: Array<string | null> = [
    ...Array.from(bookedAt.keys())
      .filter((id): id is string => id !== null)
      .sort(),
    ...(bookedAt.has(null) ? [null] : []),
  ];

  const bookingMoves: SourceMove[] = [];
  for (const origin of origins) {
    let left = Math.min(excessAt(origin), bookedAt.get(origin) ?? 0);
    const rows = loose
      .filter((row) => looseSourceOf(row.key) === origin)
      .sort((a, b) =>
        compareLatestDispatchedFirst(
          { checkedOutAt: a.sliceCheckedOutAt, id: a.sourceRowId },
          { checkedOutAt: b.sliceCheckedOutAt, id: b.sourceRowId }
        )
      );
    for (const row of rows) {
      if (left <= 0) break;
      let rowLeft = Math.min(row.out, left);
      while (rowLeft > 0) {
        const target = pickTarget(origin, rowLeft);
        bookingMoves.push({
          sourceRowId: row.sourceRowId,
          sliceId: row.sliceId,
          fromKey: row.key,
          toKey: target.to === undefined ? UNKNOWN_KEY : looseKey(target.to),
          units: target.units,
        });
        bump(movedOut, origin, target.units);
        if (target.to !== undefined) bump(movedIn, target.to, target.units);
        rowLeft -= target.units;
        left -= target.units;
      }
    }
  }

  // Custody sees the booking units as held: before, every unit out; after,
  // the units that stayed plus the units moved in.
  const heldBefore = new Map(bookedAt);
  const heldAfter = new Map<string | null, number>();
  for (const id of new Set([...bookedAt.keys(), ...movedIn.keys()])) {
    heldAfter.set(
      id,
      (bookedAt.get(id) ?? 0) - (movedOut.get(id) ?? 0) + (movedIn.get(id) ?? 0)
    );
  }

  const custodyMoves = planCustodyRehome({
    before: withoutHeldUnits(before, heldBefore),
    after: withoutHeldUnits(after, heldAfter),
    rows: custodyRows,
    destinationLocationId,
  });

  return { bookingMoves, custodyMoves };
}

/* -------------------------------------------------------------------------- */
/*                               Location delete                              */
/* -------------------------------------------------------------------------- */

/** A source row as the location delete planner reads it. */
export type EvacuationRow = SourceRowState & {
  /** Id of the source row. */
  id: string;
  /** `BookingAsset.id` of the row's slice. */
  sliceId: string;
  /** The slice's allocation mode. */
  mode: "AUTO" | "MANUAL";
  /** `BookingAsset.checkedOutAt` of the slice; orders the out drain. */
  sliceCheckedOutAt: Date | null;
};

/**
 * One write of a location delete. The origin row and the target row (by
 * `toKey`, within `sliceId`) change together; the target row is created when
 * the slice has none.
 * - `partialMove`: `units` out units (`quantity`, `out`, `dispatchedTotal`).
 * - `moveHistory`: the origin's whole history with its shares.
 * - `movePending`: `units` pending units (`quantity`).
 * - `moveReleased`: `units` released units (`quantity`, `released`) to the
 *   slice's UNASSIGNED row.
 * - `deleteRow`: the emptied origin row.
 */
export type EvacuationWrite =
  | {
      type: "partialMove";
      sliceId: string;
      fromRowId: string;
      toKey: string;
      units: number;
    }
  | { type: "moveHistory"; sliceId: string; fromRowId: string; toKey: string }
  | {
      type: "movePending";
      sliceId: string;
      fromRowId: string;
      toKey: string;
      units: number;
    }
  | { type: "moveReleased"; sliceId: string; fromRowId: string; units: number }
  | { type: "deleteRow"; sourceRowId: string };

/** Units of one part and the key of the row they go to. */
type Part = { toKey: string; units: number };

/**
 * Plans the evacuation of every source row at the deleted locations of ONE
 * pool. Each part of a row goes to its own target (spec 13.1):
 * - out units: the unplaced units while `unplacedRoomForOut` really covers
 *   them (shared by every deleted row, latest dispatched first), else the
 *   slice's UNKNOWN row;
 * - history: the slice's UNKNOWN row;
 * - pending: AUTO slices re-allocate the pending of all their deleted rows at
 *   once by rule 7 over `freeBySlice`, the part that fits nowhere going to
 *   UNASSIGNED; MANUAL slices put it on UNASSIGNED;
 * - released: UNASSIGNED.
 *
 * Free units claimed by one slice (and out units placed at the unplaced
 * units) are taken off every other slice's free, since the planner cannot
 * tell whether their windows overlap. Rows of other kinds are targets, never
 * origins.
 *
 * @param args.deletedLocationIds - Locations being deleted
 * @param args.rows - Source rows of the pool's slices
 * @param args.freeBySlice - Free units of the remaining sources over each
 *   slice's window, by slice id
 * @param args.unplacedRoomForOut - Unplaced units free to take out units now
 * @returns Writes per origin row (latest dispatched first), each ending in
 *   `deleteRow`
 */
export function planLocationDeleteEvacuation({
  deletedLocationIds,
  rows,
  freeBySlice,
  unplacedRoomForOut,
}: {
  deletedLocationIds: string[];
  rows: EvacuationRow[];
  freeBySlice: Map<string, SourceFree[]>;
  unplacedRoomForOut: number;
}): EvacuationWrite[] {
  const deleted = new Set(deletedLocationIds);
  const origins = rows
    .filter(
      (row) =>
        row.kind === "LOCATION" &&
        row.locationId !== null &&
        deleted.has(row.locationId)
    )
    .sort((a, b) =>
      compareLatestDispatchedFirst(
        { checkedOutAt: a.sliceCheckedOutAt, id: a.id },
        { checkedOutAt: b.sliceCheckedOutAt, id: b.id }
      )
    );

  // Out units: Unplaced while it covers them, else UNKNOWN.
  const outParts = new Map<string, Part[]>();
  let unplacedLeft = Math.max(0, unplacedRoomForOut);
  const claimed = new Map<string, number>();
  for (const row of origins) {
    const parts: Part[] = [];
    const toUnplaced = Math.min(row.outQuantity, unplacedLeft);
    if (toUnplaced > 0) {
      parts.push({ toKey: UNPLACED_KEY, units: toUnplaced });
      unplacedLeft -= toUnplaced;
      bump(claimed, UNPLACED_KEY, toUnplaced);
    }
    const toUnknown = row.outQuantity - toUnplaced;
    if (toUnknown > 0) parts.push({ toKey: UNKNOWN_KEY, units: toUnknown });
    outParts.set(row.id, parts);
  }

  // Pending units: one allocation per AUTO slice over its deleted rows.
  const pendingParts = new Map<string, Part[]>();
  const sliceIds = Array.from(new Set(origins.map((row) => row.sliceId)));
  for (const sliceId of sliceIds) {
    const sliceRows = origins.filter(
      (row) => row.sliceId === sliceId && pendingOf(row) > 0
    );
    for (const row of sliceRows.filter((r) => r.mode === "MANUAL")) {
      pendingParts.set(row.id, [
        { toKey: UNASSIGNED_KEY, units: pendingOf(row) },
      ]);
    }
    const autoRows = sliceRows.filter((row) => row.mode === "AUTO");
    const demand = autoRows.reduce((sum, row) => sum + pendingOf(row), 0);
    if (demand === 0) continue;

    const sources = (freeBySlice.get(sliceId) ?? [])
      .filter(
        (s) =>
          !(s.kind === "LOCATION" && s.locationId && deleted.has(s.locationId))
      )
      .map((s) => ({ ...s, free: s.free - (claimed.get(sourceKey(s)) ?? 0) }));
    const { parts, unassigned } = allocateSourcesOrUnassigned({
      quantity: demand,
      sources,
    });
    const queue: Part[] = parts.map((p) => {
      bump(claimed, sourceKey(p), p.quantity);
      return { toKey: sourceKey(p), units: p.quantity };
    });
    if (unassigned > 0)
      queue.push({ toKey: UNASSIGNED_KEY, units: unassigned });

    // Hand the allocated parts to the rows in drain order.
    for (const row of autoRows) {
      const mine: Part[] = [];
      let need = pendingOf(row);
      while (need > 0 && queue.length > 0) {
        const head = queue[0];
        const take = Math.min(need, head.units);
        mine.push({ toKey: head.toKey, units: take });
        head.units -= take;
        need -= take;
        if (head.units === 0) queue.shift();
      }
      pendingParts.set(row.id, mine);
    }
  }

  const writes: EvacuationWrite[] = [];
  for (const row of origins) {
    const base = { sliceId: row.sliceId, fromRowId: row.id };
    for (const part of outParts.get(row.id) ?? []) {
      writes.push({ type: "partialMove", ...base, ...part });
    }
    if (historyOf(row) > 0) {
      writes.push({ type: "moveHistory", ...base, toKey: UNKNOWN_KEY });
    }
    for (const part of pendingParts.get(row.id) ?? []) {
      writes.push({ type: "movePending", ...base, ...part });
    }
    if (row.releasedQuantity > 0) {
      writes.push({
        type: "moveReleased",
        ...base,
        units: row.releasedQuantity,
      });
    }
    writes.push({ type: "deleteRow", sourceRowId: row.id });
  }
  return writes;
}

/** What one target row of a slice receives from a location delete. */
export type EvacuationTarget = {
  /** The slice of the target row. */
  sliceId: string;
  /** `sourceKey` of the target row. */
  toKey: string;
  /** Added to `quantity`. */
  quantity: number;
  /** Added to `outQuantity`. */
  outQuantity: number;
  /** Added to `releasedQuantity`. */
  releasedQuantity: number;
  /** Added to `dispatchedTotal`. */
  dispatchedTotal: number;
  /** Share units repointed to the target. */
  sharedQuantity: number;
};

/**
 * Sums the writes of {@link planLocationDeleteEvacuation} per target
 * `(sliceId, toKey)`, so each target row is inserted or updated once even
 * when several deleted locations feed it.
 *
 * @param writes - The planned writes
 * @param rows - The rows the writes were planned from (for history sizes)
 * @returns One entry per target, in order of first appearance
 * @throws {Error} When a `moveHistory` names a row not in `rows`
 */
export function aggregateEvacuationTargets(
  writes: EvacuationWrite[],
  rows: EvacuationRow[]
): EvacuationTarget[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const targets = new Map<string, EvacuationTarget>();
  const target = (sliceId: string, toKey: string): EvacuationTarget => {
    const id = `${sliceId}|${toKey}`;
    let found = targets.get(id);
    if (!found) {
      found = {
        sliceId,
        toKey,
        quantity: 0,
        outQuantity: 0,
        releasedQuantity: 0,
        dispatchedTotal: 0,
        sharedQuantity: 0,
      };
      targets.set(id, found);
    }
    return found;
  };

  for (const write of writes) {
    switch (write.type) {
      case "partialMove": {
        const t = target(write.sliceId, write.toKey);
        t.quantity += write.units;
        t.outQuantity += write.units;
        t.dispatchedTotal += write.units;
        break;
      }
      case "moveHistory": {
        const row = byId.get(write.fromRowId);
        if (!row) {
          throw new Error(`Unknown source row ${write.fromRowId}`);
        }
        const t = target(write.sliceId, write.toKey);
        t.dispatchedTotal += historyOf(row);
        t.sharedQuantity += historyOf(row);
        break;
      }
      case "movePending": {
        target(write.sliceId, write.toKey).quantity += write.units;
        break;
      }
      case "moveReleased": {
        const t = target(write.sliceId, UNASSIGNED_KEY);
        t.quantity += write.units;
        t.releasedQuantity += write.units;
        break;
      }
      case "deleteRow":
        break;
    }
  }
  return Array.from(targets.values());
}
