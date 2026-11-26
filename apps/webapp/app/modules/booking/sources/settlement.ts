/**
 * Check-in settlement: the in-memory part of settling units that come back,
 * are used up, lost or damaged on a booking, by source row.
 *
 * A check-in opens one settlement per transaction (`openSettlement` in the
 * facade, after the booking lock and the asset lock), then for each
 * disposition, before writing its logs, calls {@link settleUnits}. In a
 * converted group that picks the rows the units were out from (a disposition
 * naming its slice settles on that slice; one naming no slice is spread over
 * the group's slices in {@link compareSlicesForGreedyFill} order, standalone
 * first, by {@link resolveUntaggedDisposition}), applies the settle
 * transition to them, and remembers one planned share per (category, slice,
 * row). After every log is written, `commitSettlement` in the facade gives
 * each new log its RECORDED shares ({@link matchSharesToLogs}) and writes the
 * rows, the conversion and the shares in one plan.
 *
 * Settle rules (per row): `out -= k, released += k`. Units out from UNKNOWN
 * leave the row with their plan (`quantity -= k, out -= k`) and land on the
 * slice's UNASSIGNED row as released units (`quantity += k, released += k`).
 * A settlement never refuses for capacity; it refuses only units that are not
 * out.
 *
 * A LEGACY group (adoption off, held back, or not quantity-tracked) is left
 * to the caller: {@link settleUnits} reports it `legacy` and plans nothing.
 *
 * Nothing here reads or writes the database, so the check-in paths can call
 * it freely inside their loops.
 *
 * @see {@link file://./booking-sources.server.ts} `openSettlement`, `commitSettlement`
 * @see {@link file://./untagged-resolution.ts}
 */

import { settleOnRow, sourceKey } from "@shelf/quantity-control";
import type { SourceRowState } from "@shelf/quantity-control";

import { ShelfError } from "~/utils/error";

import {
  BOOKING_DISPOSITION_CATEGORIES,
  compareSlicesForGreedyFill,
} from "../checkout-attribution";
import type { BookingDispositionCategory } from "../checkout-attribution";

import type {
  GroupSession,
  WorkingGroup,
  WorkingRow,
  WorkingSlice,
} from "./conversion.server";
import type { PlannedShare, Window } from "./types";
import { resolveUntaggedDisposition } from "./untagged-resolution";
import type { ResolvedShare } from "./untagged-resolution";

/** Categories whose units leave the stock (the placement reconcile). */
const DESTROY_CATEGORIES: ReadonlySet<BookingDispositionCategory> = new Set([
  "CONSUME",
  "LOSS",
  "DAMAGE",
]);

/** One check-in disposition of one asset on the booking. */
export type SettlementDisposition = {
  /** The slice the units are on, or null/omitted for an untagged request. */
  sliceId?: string | null;
  /** The asset (`BookingAsset.assetId`). */
  assetId: string;
  returned?: number;
  consumed?: number;
  lost?: number;
  damaged?: number;
};

/** Units of one category of a disposition planned on one slice row. */
export type PlannedSettleShare = {
  assetId: string;
  category: BookingDispositionCategory;
  /** The slice (`BookingAsset.id`). */
  sliceId: string;
  /** `sourceKey` of the row on that slice. */
  sourceKey: string;
  /** The row's kind, for the placement sources. */
  kind: SourceRowState["kind"];
  /** Set for a LOCATION row. */
  locationId: string | null;
  units: number;
};

/** What {@link settleUnits} decided for one disposition. */
export type SettledDisposition = {
  /**
   * True when the asset's group stays LEGACY on this booking: the caller
   * writes its logs exactly as before and nothing is recorded on rows.
   */
  legacy: boolean;
  /**
   * The slice to tag the logs with: the requested slice, or the only slice
   * the units came from; null when they span several slices. For a LEGACY
   * group, the requested slice.
   */
  bookingAssetId: string | null;
  /** Units per (slice, row), in resolution order. Empty for LEGACY. */
  shares: ResolvedShare[];
  /**
   * Manual placements the consumed, lost and damaged units left from (their
   * LOCATION rows), for the placement reconcile. Empty for LEGACY, for units
   * out from Unplaced, UNKNOWN or a KIT row.
   */
  destroyedFromLocations: Array<{ locationId: string; quantity: number }>;
  /**
   * The location the returned units left from, when every one of them was
   * out from the same LOCATION row; null otherwise (and for LEGACY).
   */
  returnLocationId: string | null;
};

/** An open settlement: the planned session and the shares planned so far. */
export type Settlement = {
  organizationId: string;
  bookingId: string;
  /** Groups that are converted for this check-in, keyed by asset id. */
  groups: Map<string, WorkingGroup>;
  /** Shares {@link settleUnits} planned, written by `commitSettlement`. */
  planned: PlannedSettleShare[];
  /** The session to write; null when there is nothing to write. */
  session: GroupSession | null;
};

/**
 * A settlement with no converted group: every disposition is LEGACY and the
 * commit writes nothing.
 *
 * @param args.organizationId - The trusted workspace id
 * @param args.bookingId - The booking
 */
export function emptySettlement(args: {
  organizationId: string;
  bookingId: string;
}): Settlement {
  return {
    organizationId: args.organizationId,
    bookingId: args.bookingId,
    groups: new Map(),
    planned: [],
    session: null,
  };
}

/**
 * The window a check-in allocates seeded pending units over: the rest of
 * the booking, `[max(from, now), to)`. An overdue booking (its end already
 * past) gets a one-millisecond window at `now`, so free units are what is
 * free right now.
 *
 * @param booking - The booking's stored start and end
 * @param now - The current time
 */
export function settlementWindow(
  booking: { from: Date; to: Date },
  now: Date
): Window {
  const from = new Date(Math.max(booking.from.getTime(), now.getTime()));
  const to =
    booking.to.getTime() > from.getTime()
      ? booking.to
      : new Date(from.getTime() + 1);
  return { from, to };
}

/** Sum of a disposition's units. */
function unitsOf(d: SettlementDisposition): number {
  return (
    (d.returned ?? 0) + (d.consumed ?? 0) + (d.lost ?? 0) + (d.damaged ?? 0)
  );
}

/**
 * A stable reference to a row for the resolver: its id when persisted, else
 * a reference sorting after every persisted id (rows conversion just seeded).
 */
function rowRef(row: WorkingRow): string {
  return row.id ?? `~${sourceKey(row)}`;
}

/**
 * Units out on a converted group, on one slice or on every slice of the
 * asset, as the settlement holds them now (earlier settles included).
 *
 * @param settlement - The open settlement
 * @param args.assetId - The asset
 * @param args.sliceId - One slice; every slice of the asset when omitted
 * @returns Units out, or null when the group is LEGACY
 */
export function unitsOutInSettlement(
  settlement: Settlement,
  args: { assetId: string; sliceId?: string | null }
): number | null {
  const group = settlement.groups.get(args.assetId);
  if (!group) return null;
  return group.slices
    .filter((s) => !args.sliceId || s.id === args.sliceId)
    .reduce(
      (sum, s) => sum + s.rows.reduce((rowSum, r) => rowSum + r.outQuantity, 0),
      0
    );
}

/**
 * Units of a converted group not settled yet: the sum of `quantity -
 * releasedQuantity` over every row of every slice (AUTO, MANUAL and KIT), as
 * the settlement holds them now. Zero means every planned unit of the group
 * came back or was used up, whatever was re-dispatched in between: that is
 * when the asset is fully reconciled on the booking. Pending units that never
 * left count as not settled.
 *
 * @param settlement - The open settlement
 * @param assetId - The asset
 * @returns Units not settled, or null when the group is LEGACY
 */
export function remainingInSettlement(
  settlement: Settlement,
  assetId: string
): number | null {
  const group = settlement.groups.get(assetId);
  if (!group) return null;
  return group.slices.reduce(
    (sum, s) =>
      sum +
      s.rows.reduce(
        (rowSum, r) => rowSum + (r.quantity - r.releasedQuantity),
        0
      ),
    0
  );
}

/**
 * The slices a check-in walks, with every converted group's slices taken from
 * the settlement: those were read under the booking and asset locks, so a
 * slice added or removed between the caller's own read and its locks is seen
 * as it is now. LEGACY groups keep the caller's slices.
 *
 * The result keeps the caller's order for LEGACY slices; a converted group's
 * slices take the place of the caller's first slice of that asset, in
 * allocation order (standalone first, then by id). Callers that need another
 * order sort the result.
 *
 * @param settlement - The open settlement
 * @param slices - The caller's slices, read before the locks
 * @param adopt - Builds the caller's slice for a settlement slice: `read` is
 *   the caller's slice with the same id when it has one, `sibling` a slice of
 *   the same asset (for asset-level fields such as the title)
 * @returns The slices to walk
 */
export function slicesUnderLock<T extends { id: string; assetId: string }>(
  settlement: Settlement,
  slices: T[],
  adopt: (slice: WorkingSlice, read: T | undefined, sibling: T) => T
): T[] {
  const result: T[] = [];
  const placed = new Set<string>();
  for (const slice of slices) {
    const group = settlement.groups.get(slice.assetId);
    if (!group) {
      result.push(slice);
      continue;
    }
    if (placed.has(slice.assetId)) continue;
    placed.add(slice.assetId);
    for (const working of [...group.slices].sort(compareSlicesForGreedyFill)) {
      const read = slices.find((s) => s.id === working.id);
      result.push(adopt(working, read, slice));
    }
  }
  return result;
}

/** A 400 for units asked back that are not out. */
function notOut(asked: number, out: number, assetId: string): ShelfError {
  return new ShelfError({
    cause: null,
    title: "Booking sources",
    message:
      out === 0
        ? "None of these units are out on this booking."
        : `Cannot check in ${asked} units. Only ${out} are out on this booking.`,
    additionalData: { assetId, asked, out },
    label: "Booking",
    status: 400,
    shouldBeCaptured: false,
  });
}

/** Moves settled UNKNOWN units onto the slice's UNASSIGNED row, released. */
function addReleasedToUnassigned(slice: WorkingSlice, units: number) {
  let row = slice.rows.find((r) => r.kind === "UNASSIGNED");
  if (!row) {
    row = {
      kind: "UNASSIGNED",
      locationId: null,
      quantity: 0,
      outQuantity: 0,
      releasedQuantity: 0,
      dispatchedTotal: 0,
      sharedQuantity: 0,
    };
    slice.rows.push(row);
  }
  row.quantity += units;
  row.releasedQuantity += units;
}

/**
 * Settles one disposition on the rows it was out from, in memory, and plans
 * its shares. Call it before writing the disposition's logs.
 *
 * - LEGACY group: nothing changes; `legacy: true`.
 * - Slice named: its rows with units out, most out first, then row order.
 * - No slice named: the group's slices in {@link compareSlicesForGreedyFill}
 *   order (standalone first, then kit-driven, each by id), the order the
 *   LEGACY check-in spreads an untagged disposition in
 *   (`spreadUntaggedCheckin`). Each slice takes at most what its rows have
 *   out, its rows most out first, then row order. A LEGACY and a converted
 *   group therefore tag an untagged check-in onto the same slices.
 *
 * The units are poured into the chosen (slice, row) pieces category by
 * category (returned, consumed, lost, damaged), so one log covering several
 * rows or slices gets one share per piece.
 *
 * @param settlement - The open settlement
 * @param disposition - What came back or was used up
 * @returns What was settled, for the caller's log writes
 * @throws {ShelfError} 400 when more units are asked than are out, or the
 *   named slice is not a slice of the asset on this booking
 */
export function settleUnits(
  settlement: Settlement,
  disposition: SettlementDisposition
): SettledDisposition {
  const requested = disposition.sliceId ?? null;
  const group = settlement.groups.get(disposition.assetId);
  if (!group) {
    return {
      legacy: true,
      bookingAssetId: requested,
      shares: [],
      destroyedFromLocations: [],
      returnLocationId: null,
    };
  }
  const units = unitsOf(disposition);
  const ordered = [...group.slices].sort(compareSlicesForGreedyFill);
  const candidates = requested
    ? ordered.filter((s) => s.id === requested)
    : ordered;
  if (requested && candidates.length === 0) {
    throw new ShelfError({
      cause: null,
      title: "Booking sources",
      message: "This booking item is not part of the booking.",
      additionalData: { sliceId: requested, assetId: disposition.assetId },
      label: "Booking",
      status: 400,
      shouldBeCaptured: false,
    });
  }
  if (units === 0) {
    return {
      legacy: false,
      bookingAssetId: requested,
      shares: [],
      destroyedFromLocations: [],
      returnLocationId: null,
    };
  }

  const out = candidates.reduce(
    (sum, s) => sum + s.rows.reduce((rowSum, r) => rowSum + r.outQuantity, 0),
    0
  );
  if (units > out) throw notOut(units, out, disposition.assetId);

  const shares = resolveUntaggedDisposition({
    slices: candidates.map((s) => ({
      id: s.id,
      mode: s.mode,
      allocationOrder: ordered.indexOf(s),
      rows: s.rows.map((r) => ({ ...r, id: rowRef(r) })),
    })),
    units,
  });

  // Pour the categories into the resolved pieces, in order.
  const left: Record<BookingDispositionCategory, number> = {
    RETURN: disposition.returned ?? 0,
    CONSUME: disposition.consumed ?? 0,
    LOSS: disposition.lost ?? 0,
    DAMAGE: disposition.damaged ?? 0,
  };
  const planned: PlannedSettleShare[] = [];
  for (const share of shares) {
    const slice = candidates.find((s) => s.id === share.sliceId);
    const row = slice?.rows.find((r) => rowRef(r) === share.sourceRowId);
    if (!slice || !row) continue; // the resolver only names candidate rows
    let pieceLeft = share.units;
    // The categories pour in the order of BOOKING_DISPOSITION_CATEGORIES.
    for (const category of BOOKING_DISPOSITION_CATEGORIES) {
      if (pieceLeft === 0) break;
      const take = Math.min(pieceLeft, left[category]);
      if (take === 0) continue;
      left[category] -= take;
      pieceLeft -= take;
      planned.push({
        assetId: disposition.assetId,
        category,
        sliceId: slice.id,
        sourceKey: sourceKey(row),
        kind: row.kind,
        locationId: row.locationId,
        units: take,
      });
    }
    const settled = settleOnRow(row, share.units);
    Object.assign(row, settled.row);
    if (settled.toUnassigned) {
      addReleasedToUnassigned(slice, settled.toUnassigned.released);
    }
  }
  settlement.planned.push(...planned);

  const destroyed = new Map<string, number>();
  for (const p of planned) {
    if (DESTROY_CATEGORIES.has(p.category) && p.locationId !== null) {
      destroyed.set(p.locationId, (destroyed.get(p.locationId) ?? 0) + p.units);
    }
  }
  const returns = planned.filter((p) => p.category === "RETURN");
  const returnKeys = new Set(returns.map((p) => p.sourceKey));
  const sliceIds = new Set(shares.map((s) => s.sliceId));
  return {
    legacy: false,
    bookingAssetId:
      requested ?? (sliceIds.size === 1 ? [...sliceIds][0] : null),
    shares,
    destroyedFromLocations: [...destroyed].map(([locationId, quantity]) => ({
      locationId,
      quantity,
    })),
    returnLocationId:
      returnKeys.size === 1 && returns[0].kind === "LOCATION"
        ? returns[0].locationId
        : null,
  };
}

/**
 * The slice shape the check-in's ledger events and placement helpers read,
 * standing in for a converted slice: its units left from the settled
 * LOCATION row with the most destroyed units, or from no placement.
 *
 * @param settled - A settled converted disposition
 */
export function settledPlacementSlice(settled: SettledDisposition): {
  assetKitId: null;
  sourceKitId: null;
  sourceLocationId: string | null;
} {
  const main = [...settled.destroyedFromLocations].sort(
    (a, b) => b.quantity - a.quantity
  )[0];
  return {
    assetKitId: null,
    sourceKitId: null,
    sourceLocationId: main?.locationId ?? null,
  };
}

/**
 * Units consumed, lost or damaged per slice in this settlement so far.
 *
 * @param settlement - The open settlement
 * @param assetId - The asset
 * @returns slice id -> units destroyed
 */
export function destroyedUnitsBySlice(
  settlement: Settlement,
  assetId: string
): Map<string, number> {
  const bySlice = new Map<string, number>();
  for (const p of settlement.planned) {
    if (p.assetId !== assetId || !DESTROY_CATEGORIES.has(p.category)) continue;
    bySlice.set(p.sliceId, (bySlice.get(p.sliceId) ?? 0) + p.units);
  }
  return bySlice;
}

/** A disposition log of the booking that has no shares yet. */
export type UnsharedLog = {
  id: string;
  assetId: string;
  /** The slice the log is tagged with, or null. */
  bookingAssetId: string | null;
  category: BookingDispositionCategory;
  /** Units of the log not covered by any share. */
  quantity: number;
  createdAt: Date;
};

/** What {@link matchSharesToLogs} produced. */
export type ShareMatch =
  | { ok: true; shares: PlannedShare[] }
  | {
      ok: false;
      /** Planned units no log carries, per asset and category. */
      plannedLeft: Array<{ assetId: string; category: string; units: number }>;
      /** Log units no planned share covers. */
      logsLeft: Array<{ logId: string; units: number }>;
    };

/** True when two logs are in `(createdAt, id)` order. */
function compareLogs(a: UnsharedLog, b: UnsharedLog): number {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Gives every new disposition log its RECORDED shares from the planned
 * pieces of the same asset and category.
 *
 * The logs are the booking's disposition logs of converted groups that no
 * share covers yet: the logs this check-in wrote (every earlier log of a
 * converted group is fully shared). Tagged logs go first and take pieces of
 * their own slice first; untagged logs, and the rest of a tagged log, take
 * the remaining pieces in plan order. A ledger row that split one event over
 * several places draws its pieces like any other log.
 *
 * Every log unit and every planned unit must be used; anything left over
 * means a writer logged without settling, or settled without logging.
 *
 * @param planned - The settlement's planned pieces
 * @param logs - The logs without shares, quantity = units not yet shared
 * @returns The shares, or what was left over on either side
 */
export function matchSharesToLogs(
  planned: PlannedSettleShare[],
  logs: UnsharedLog[]
): ShareMatch {
  const pieces = planned.map((p) => ({ ...p, left: p.units }));
  const sorted = [
    ...logs.filter((l) => l.bookingAssetId !== null).sort(compareLogs),
    ...logs.filter((l) => l.bookingAssetId === null).sort(compareLogs),
  ];
  const shares: PlannedShare[] = [];
  const logsLeft: Array<{ logId: string; units: number }> = [];

  for (const log of sorted) {
    let need = log.quantity;
    const ofCategory = pieces.filter(
      (p) => p.assetId === log.assetId && p.category === log.category
    );
    const passes = log.bookingAssetId
      ? [ofCategory.filter((p) => p.sliceId === log.bookingAssetId), ofCategory]
      : [ofCategory];
    for (const candidates of passes) {
      for (const piece of candidates) {
        if (need === 0) break;
        const take = Math.min(need, piece.left);
        if (take === 0) continue;
        piece.left -= take;
        need -= take;
        const last = shares[shares.length - 1];
        if (
          last &&
          last.consumptionLogId === log.id &&
          last.bookingAssetId === piece.sliceId &&
          last.sourceKey === piece.sourceKey
        ) {
          last.quantity += take;
        } else {
          shares.push({
            consumptionLogId: log.id,
            bookingAssetId: piece.sliceId,
            sourceKey: piece.sourceKey,
            quantity: take,
            origin: "RECORDED",
          });
        }
      }
    }
    if (need > 0) logsLeft.push({ logId: log.id, units: need });
  }

  const plannedLeft = new Map<
    string,
    { assetId: string; category: string; units: number }
  >();
  for (const p of pieces) {
    if (p.left === 0) continue;
    const key = `${p.assetId}:${p.category}`;
    const entry = plannedLeft.get(key) ?? {
      assetId: p.assetId,
      category: p.category,
      units: 0,
    };
    entry.units += p.left;
    plannedLeft.set(key, entry);
  }
  if (logsLeft.length > 0 || plannedLeft.size > 0) {
    return { ok: false, plannedLeft: [...plannedLeft.values()], logsLeft };
  }
  return { ok: true, shares };
}
