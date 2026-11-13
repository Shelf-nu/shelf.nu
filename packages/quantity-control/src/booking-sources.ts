/**
 * Booking source rows: the per-slice accounting of where the units of a
 * quantity-tracked pool asset on a booking come from.
 *
 * A source row is one kind (LOCATION, UNPLACED, UNKNOWN, UNASSIGNED, KIT) of
 * one slice with four counters (`quantity`, `outQuantity`, `releasedQuantity`,
 * `dispatchedTotal`) plus the sum of disposition shares attributed to it. This
 * module holds the derived numbers, the validity rules, and every transition
 * as a pure function that returns new objects and throws on an illegal move.
 * Persistence and locking live in the webapp.
 *
 * @see {@link file://./source-allocation.ts} which sources a new demand uses.
 * @see {@link file://./source-shortage.ts} which pending units are short.
 */

/** Where a source row's units come from. */
export type SourceKind =
  | "LOCATION"
  | "UNPLACED"
  | "UNKNOWN"
  | "UNASSIGNED"
  | "KIT";

/** The counters of one source row. All values are non-negative integers. */
export type SourceRowState = {
  /** What the row stands for. */
  kind: SourceKind;
  /** Set exactly when `kind` is LOCATION. */
  locationId: string | null;
  /** Planned units on this row. */
  quantity: number;
  /** Units from this row physically out right now. */
  outQuantity: number;
  /** Planned units that came back or were used up and are no longer held. */
  releasedQuantity: number;
  /** Lifetime units sent out from this row (reconciliation only). */
  dispatchedTotal: number;
  /** Sum of share quantities attributed to this row. */
  sharedQuantity: number;
};

/**
 * Kinds that dispatch and settle like a real source: a manual placement, the
 * unplaced units, or the plan state of a live kit slice.
 */
export const KNOWN_KINDS: readonly SourceKind[] = [
  "LOCATION",
  "UNPLACED",
  "KIT",
];

/** True for a kind in {@link KNOWN_KINDS}. */
function isKnownKind(kind: SourceKind): boolean {
  return KNOWN_KINDS.includes(kind);
}

/**
 * Stable identity of a source within a slice or a pool.
 *
 * @param row - Anything carrying a kind and a location id
 * @returns `${kind}:${locationId ?? ""}`
 */
export function sourceKey(
  row: Pick<SourceRowState, "kind" | "locationId">
): string {
  return `${row.kind}:${row.locationId ?? ""}`;
}

/** Planned units not yet out and not released: `quantity - released - out`. */
export function pendingOf(row: SourceRowState): number {
  return row.quantity - row.releasedQuantity - row.outQuantity;
}

/** Units the row still holds: pending plus out. */
export function remainingReservationOf(row: SourceRowState): number {
  return row.quantity - row.releasedQuantity;
}

/** Units that left and were settled: `dispatchedTotal - outQuantity`. */
export function historyOf(row: SourceRowState): number {
  return row.dispatchedTotal - row.outQuantity;
}

/**
 * Checks every structural rule of a row.
 *
 * @param row - The row to check
 * @returns Human-readable violations; empty when the row is valid
 */
export function sourceRowViolations(row: SourceRowState): string[] {
  const out: string[] = [];
  const counters: Array<[string, number]> = [
    ["quantity", row.quantity],
    ["outQuantity", row.outQuantity],
    ["releasedQuantity", row.releasedQuantity],
    ["dispatchedTotal", row.dispatchedTotal],
    ["sharedQuantity", row.sharedQuantity],
  ];
  for (const [name, value] of counters) {
    if (!Number.isInteger(value) || value < 0) {
      out.push(`${name} must be a non-negative integer (got ${value})`);
    }
  }
  if (row.outQuantity + row.releasedQuantity > row.quantity) {
    out.push(
      `out (${row.outQuantity}) + released (${row.releasedQuantity}) exceeds quantity (${row.quantity})`
    );
  }
  if (row.kind === "LOCATION" && row.locationId === null) {
    out.push("a LOCATION row needs a locationId");
  }
  if (row.kind !== "LOCATION" && row.locationId !== null) {
    out.push(`a ${row.kind} row must not have a locationId`);
  }
  if (row.kind === "UNKNOWN") {
    if (row.quantity !== row.outQuantity) {
      out.push("an UNKNOWN row must have quantity equal to outQuantity");
    }
    if (row.releasedQuantity !== 0) {
      out.push("an UNKNOWN row must have releasedQuantity 0");
    }
  }
  if (row.kind === "UNASSIGNED") {
    if (row.outQuantity !== 0) {
      out.push("an UNASSIGNED row must have outQuantity 0");
    }
    if (row.dispatchedTotal !== 0) {
      out.push("an UNASSIGNED row must have dispatchedTotal 0");
    }
    if (row.sharedQuantity !== 0) {
      out.push("an UNASSIGNED row must have no shares");
    }
  }
  if (row.dispatchedTotal - row.sharedQuantity !== row.outQuantity) {
    out.push(
      `dispatchedTotal (${row.dispatchedTotal}) - shared (${row.sharedQuantity}) must equal outQuantity (${row.outQuantity})`
    );
  }
  return out;
}

/**
 * True when the row can be deleted: every counter is 0 and it has no shares.
 * A row with history stays, or hands its history to another carrier first.
 */
export function isRowRemovable(row: SourceRowState): boolean {
  return (
    row.quantity === 0 &&
    row.outQuantity === 0 &&
    row.releasedQuantity === 0 &&
    row.dispatchedTotal === 0 &&
    row.sharedQuantity === 0
  );
}

/** Throws unless `k` is a positive integer. */
function assertPositive(k: number, what: string): void {
  if (!Number.isInteger(k) || k <= 0) {
    throw new Error(`${what} must be a positive integer (got ${k})`);
  }
}

/**
 * Sends `k` units out from a known row. Units beyond pending re-claim released
 * units on the same row.
 *
 * @param row - A LOCATION, UNPLACED or KIT row
 * @param k - Units to dispatch
 * @returns The new row and the number of released units re-claimed
 * @throws {Error} For other kinds, a bad `k`, or more than pending + released
 */
export function dispatchFromRow(
  row: SourceRowState,
  k: number
): { row: SourceRowState; reclaimed: number } {
  if (!isKnownKind(row.kind)) {
    throw new Error(`Cannot dispatch from a ${row.kind} row`);
  }
  assertPositive(k, "dispatch quantity");
  const pending = pendingOf(row);
  const reclaimed = Math.max(0, k - pending);
  if (reclaimed > row.releasedQuantity) {
    throw new Error(
      `Cannot dispatch ${k}: only ${pending + row.releasedQuantity} available`
    );
  }
  return {
    row: {
      ...row,
      outQuantity: row.outQuantity + k,
      releasedQuantity: row.releasedQuantity - reclaimed,
      dispatchedTotal: row.dispatchedTotal + k,
    },
    reclaimed,
  };
}

/**
 * Settles `k` out units (return, consume, lose, damage) and records the share.
 *
 * On an UNKNOWN row the planned units leave with the out units; the caller
 * puts `toUnassigned` on the slice's UNASSIGNED row as released units.
 *
 * @param row - The row the units were out from
 * @param k - Units to settle
 * @returns The new row, and for UNKNOWN the units to add to UNASSIGNED
 * @throws {Error} For UNASSIGNED, a bad `k`, or `k` beyond out
 */
export function settleOnRow(
  row: SourceRowState,
  k: number
): {
  row: SourceRowState;
  toUnassigned: { quantity: number; released: number } | null;
} {
  if (row.kind === "UNASSIGNED") {
    throw new Error("Nothing is out on an UNASSIGNED row");
  }
  assertPositive(k, "settle quantity");
  if (k > row.outQuantity) {
    throw new Error(`Cannot settle ${k}: only ${row.outQuantity} out`);
  }
  if (row.kind === "UNKNOWN") {
    return {
      row: {
        ...row,
        quantity: row.quantity - k,
        outQuantity: row.outQuantity - k,
        sharedQuantity: row.sharedQuantity + k,
      },
      toUnassigned: { quantity: k, released: k },
    };
  }
  return {
    row: {
      ...row,
      outQuantity: row.outQuantity - k,
      releasedQuantity: row.releasedQuantity + k,
      sharedQuantity: row.sharedQuantity + k,
    },
    toUnassigned: null,
  };
}

/**
 * Moves `k` out units from one row to another (rehome). Plan, out and lifetime
 * counters move together; shares stay with the origin.
 *
 * @throws {Error} When `k` exceeds the origin's out units or either row is UNASSIGNED
 */
export function partialMoveOut(
  origin: SourceRowState,
  dest: SourceRowState,
  k: number
): { origin: SourceRowState; dest: SourceRowState } {
  assertPositive(k, "move quantity");
  if (origin.kind === "UNASSIGNED" || dest.kind === "UNASSIGNED") {
    throw new Error("Out units cannot move to or from UNASSIGNED");
  }
  if (k > origin.outQuantity) {
    throw new Error(`Cannot move ${k}: only ${origin.outQuantity} out`);
  }
  return {
    origin: {
      ...origin,
      quantity: origin.quantity - k,
      outQuantity: origin.outQuantity - k,
      dispatchedTotal: origin.dispatchedTotal - k,
    },
    dest: {
      ...dest,
      quantity: dest.quantity + k,
      outQuantity: dest.outQuantity + k,
      dispatchedTotal: dest.dispatchedTotal + k,
    },
  };
}

/**
 * Moves a row's whole history (`dispatchedTotal - out`, with its shares) to
 * another row of the same slice. Both rows keep the reconciliation invariant.
 *
 * @throws {Error} When either row is UNASSIGNED
 */
export function moveHistory(
  origin: SourceRowState,
  dest: SourceRowState
): { origin: SourceRowState; dest: SourceRowState } {
  if (origin.kind === "UNASSIGNED" || dest.kind === "UNASSIGNED") {
    throw new Error("History cannot move to or from UNASSIGNED");
  }
  const history = historyOf(origin);
  return {
    origin: {
      ...origin,
      dispatchedTotal: origin.dispatchedTotal - history,
      sharedQuantity: origin.sharedQuantity - history,
    },
    dest: {
      ...dest,
      dispatchedTotal: dest.dispatchedTotal + history,
      sharedQuantity: dest.sharedQuantity + history,
    },
  };
}

/**
 * Lowers the planned quantity of one slice by `d`, never below out units.
 *
 * Order: pending first (UNASSIGNED, then known rows by smallest pending, ties
 * by source key), then released units in the same row order
 * (`quantity -= x, released -= x`). Rows that end removable stay in the array;
 * the caller decides cleanup.
 *
 * @param rows - The rows of ONE slice
 * @param d - Units to remove
 * @returns New rows in the input order
 * @throws {Error} When `d` exceeds what can be removed
 */
export function decreaseSliceQuantity(
  rows: SourceRowState[],
  d: number
): SourceRowState[] {
  if (!Number.isInteger(d) || d < 0) {
    throw new Error(`decrease must be a non-negative integer (got ${d})`);
  }
  const order = rows
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = rows[a];
      const rb = rows[b];
      const ua = ra.kind === "UNASSIGNED" ? 0 : 1;
      const ub = rb.kind === "UNASSIGNED" ? 0 : 1;
      if (ua !== ub) return ua - ub;
      const pa = pendingOf(ra);
      const pb = pendingOf(rb);
      if (pa !== pb) return pa - pb;
      return sourceKey(ra).localeCompare(sourceKey(rb));
    });
  const next = rows.map((r) => ({ ...r }));
  let left = d;
  for (const i of order) {
    const x = Math.min(left, pendingOf(next[i]));
    next[i].quantity -= x;
    left -= x;
  }
  for (const i of order) {
    const x = Math.min(left, next[i].releasedQuantity);
    next[i].quantity -= x;
    next[i].releasedQuantity -= x;
    left -= x;
  }
  if (left > 0) {
    throw new Error(
      `Cannot decrease by ${d}: ${left} would go below out units`
    );
  }
  return next;
}
