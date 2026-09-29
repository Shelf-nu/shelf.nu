/**
 * Stock ledger rules.
 *
 * The stock ledger is the set of `ConsumptionLog` rows carrying a
 * `stockChange`. Each row says how many units arrived at (positive) or left
 * (negative) one place, where a place is a location or, with a NULL
 * `locationId`, the unplaced units. From an asset's `stockLedgerStartedAt`
 * on, its rows sum to the live stock:
 *
 * - per location: the manual `AssetLocation.quantity` (`assetKitId IS NULL`),
 * - with no location: the unplaced units, `Asset.quantity` minus the manual
 *   placements (negative on a pool whose placements exceed its total),
 * - over all rows: `Asset.quantity`.
 *
 * Kit-driven placements are a separate axis, bounded on their own, and never
 * enter the ledger.
 *
 * Rows are derived from what a change actually did, never from what the
 * request asked for: the caller reads the pool's {@link StockState} under the
 * asset lock before it writes, and the ledger diffs it against the state
 * after. The caller only names the events (a consume of 5, a restock of 10)
 * so the diff can be labelled; whatever the events do not explain is a
 * {@link MOVE_CATEGORY} between places, which never changes the total.
 *
 * Pure: no database access. The database side is `stock-ledger.server.ts`.
 *
 * @see {@link file://./stock-ledger.server.ts}
 */

import type { ConsumptionCategory } from "@prisma/client";

/** The category of the rows that move units between places. */
export const MOVE_CATEGORY = "MOVE" satisfies ConsumptionCategory;

/** The category of the rows that record a pool's stock when its ledger starts. */
export const OPENING_BALANCE_CATEGORY =
  "OPENING_BALANCE" satisfies ConsumptionCategory;

/**
 * A pool's stock as the ledger counts it.
 */
export type StockState = {
  /** `Asset.quantity`. */
  total: number;
  /** Units placed by hand at each location, keyed by location id. */
  placed: Map<string, number>;
  /** `Asset.stockLedgerStartedAt`: NULL until the ledger started for the pool. */
  ledgerStartedAt: Date | null;
};

/** The state of an asset that does not exist yet. */
export function emptyStockState(): StockState {
  return { total: 0, placed: new Map(), ledgerStartedAt: null };
}

/** The unplaced units of a pool: its total minus the manual placements. */
export function unplacedUnits(state: StockState): number {
  let placedSum = 0;
  for (const quantity of state.placed.values()) placedSum += quantity;
  return state.total - placedSum;
}

/**
 * How much one place gained or lost. `locationId` NULL is the unplaced units.
 */
export type PlaceChange = { locationId: string | null; change: number };

/**
 * The per-place stock of a pool, unplaced units included: the rows an
 * opening balance writes, and the numbers a replay must reach.
 */
export function stockByPlace(state: StockState): PlaceChange[] {
  const places: PlaceChange[] = [];
  const unplaced = unplacedUnits(state);
  if (unplaced !== 0) places.push({ locationId: null, change: unplaced });
  for (const locationId of [...state.placed.keys()].sort()) {
    const quantity = state.placed.get(locationId) ?? 0;
    if (quantity !== 0) places.push({ locationId, change: quantity });
  }
  return places;
}

/**
 * The non-zero change at each place between two states of one pool, unplaced
 * units first, then locations by id.
 */
export function diffStockStates(
  before: StockState,
  after: StockState
): PlaceChange[] {
  const changes: PlaceChange[] = [];
  const unplacedChange = unplacedUnits(after) - unplacedUnits(before);
  if (unplacedChange !== 0) {
    changes.push({ locationId: null, change: unplacedChange });
  }

  const locationIds = new Set([
    ...before.placed.keys(),
    ...after.placed.keys(),
  ]);
  for (const locationId of [...locationIds].sort()) {
    const change =
      (after.placed.get(locationId) ?? 0) -
      (before.placed.get(locationId) ?? 0);
    if (change !== 0) changes.push({ locationId, change });
  }
  return changes;
}

/**
 * One thing that changed a pool's total, as the caller knows it: "consumed 5
 * on this booking slice", "restocked 10 at Studio". The ledger decides which
 * places the units actually came from or went to.
 */
export type StockEvent = {
  /** Anything but MOVE / OPENING_BALANCE, which the ledger writes itself. */
  category: ConsumptionCategory;
  /** Signed change to the total: positive for units in, negative for units out. */
  change: number;
  /**
   * Where the caller expects the units to have come from or gone to (NULL =
   * the unplaced units). Tried first; the diff decides.
   */
  locationId?: string | null;
  bookingId?: string | null;
  bookingAssetId?: string | null;
  custodianId?: string | null;
  note?: string | null;
};

/** A ledger row, ready to insert once the asset and user ids are added. */
export type PlannedLedgerRow = {
  category: ConsumptionCategory;
  /** Always positive: `Math.abs(stockChange)`. */
  quantity: number;
  stockChange: number;
  locationId: string | null;
  bookingId: string | null;
  bookingAssetId: string | null;
  custodianId: string | null;
  note: string | null;
};

/** Stable key for a place in a `Map`: the location id, or "" for unplaced. */
const placeKey = (locationId: string | null) => locationId ?? "";
const placeFromKey = (key: string) => (key === "" ? null : key);

/**
 * Turns one change of one pool into ledger rows.
 *
 * Each event takes its units from the places that moved in its direction:
 * its own `locationId` first, then the unplaced units, then the other
 * locations by id. Units an event cannot find there (two events of opposite
 * direction at one place, which the diff cancels out) are written at its
 * `locationId`, and the place is charged for them. What is left after every
 * event is units that only changed place: one MOVE row per place, and those
 * rows sum to zero.
 *
 * The rows always sum to `changes` at every place, so a replay stays exact
 * even when the events are wrong. When the events do not add up to the
 * change of the total, the difference becomes an ADJUSTMENT at the places
 * that moved, and `unexplained` reports it for the caller to log.
 *
 * @param changes - {@link diffStockStates} of the pool
 * @param events - What the caller did; all of them are written
 * @returns The rows, and the part of the total change no event explained
 */
export function planStockLedgerRows({
  changes,
  events,
}: {
  changes: PlaceChange[];
  events: StockEvent[];
}): { rows: PlannedLedgerRow[]; unexplained: number } {
  const remaining = new Map<string, number>();
  for (const { locationId, change } of changes) {
    remaining.set(placeKey(locationId), change);
  }

  const totalChange = changes.reduce((sum, c) => sum + c.change, 0);
  const explained = events.reduce((sum, e) => sum + e.change, 0);
  const unexplained = totalChange - explained;

  const allEvents: StockEvent[] = events.filter((e) => e.change !== 0);
  if (unexplained !== 0) {
    allEvents.push({ category: "ADJUSTMENT", change: unexplained });
  }

  const rows: PlannedLedgerRow[] = [];
  const pushRow = (
    event: StockEvent,
    locationId: string | null,
    stockChange: number
  ) => {
    rows.push({
      category: event.category,
      quantity: Math.abs(stockChange),
      stockChange,
      locationId,
      bookingId: event.bookingId ?? null,
      bookingAssetId: event.bookingAssetId ?? null,
      custodianId: event.custodianId ?? null,
      note: event.note ?? null,
    });
  };

  for (const event of allEvents) {
    const sign = Math.sign(event.change);
    let left = Math.abs(event.change);

    const preferred =
      event.locationId === undefined ? null : placeKey(event.locationId);
    const order = [
      ...(preferred !== null ? [preferred] : []),
      "",
      ...[...remaining.keys()].filter((key) => key !== "").sort(),
    ].filter((key, index, keys) => keys.indexOf(key) === index);

    for (const key of order) {
      if (left === 0) break;
      const atPlace = remaining.get(key) ?? 0;
      if (Math.sign(atPlace) !== sign) continue;
      const take = Math.min(left, Math.abs(atPlace));
      pushRow(event, placeFromKey(key), sign * take);
      remaining.set(key, atPlace - sign * take);
      left -= take;
    }

    if (left > 0) {
      const key = preferred ?? "";
      pushRow(event, placeFromKey(key), sign * left);
      remaining.set(key, (remaining.get(key) ?? 0) - sign * left);
    }
  }

  const move: StockEvent = { category: MOVE_CATEGORY, change: 0 };
  for (const key of [...remaining.keys()].sort()) {
    const change = remaining.get(key) ?? 0;
    if (change !== 0) pushRow(move, placeFromKey(key), change);
  }

  return { rows, unexplained };
}

/**
 * Sums ledger rows back into a stock: what a report does, and what the
 * rows of a pool must reach from its `stockLedgerStartedAt` on.
 *
 * @param rows - The pool's rows with a `stockChange`
 * @returns The total and the stock per place (`""` key = unplaced units)
 */
export function replayStockLedger(
  rows: Array<{ locationId: string | null; stockChange: number | null }>
): { total: number; byPlace: Map<string, number> } {
  const byPlace = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    if (row.stockChange == null) continue;
    total += row.stockChange;
    const key = placeKey(row.locationId);
    byPlace.set(key, (byPlace.get(key) ?? 0) + row.stockChange);
  }
  for (const [key, quantity] of byPlace) {
    if (quantity === 0) byPlace.delete(key);
  }
  return { total, byPlace };
}
