/**
 * Legacy group conversion planner (pure, no DB access).
 *
 * Turns a LEGACY group (every slice of one asset on one booking) and its
 * disposition logs into what conversion writes: quantity-level disposition
 * shares, the seeded source rows of every slice, and each slice's new mode.
 * The caller reads the slices and logs under the booking and asset locks,
 * runs {@link planGroupConversion}, and writes only when it returns
 * `convert`; a `held_back` plan writes nothing.
 *
 * Steps (spec section 12.2):
 * 1. Candidate shares reproduce the greedy fill's per-slice totals in two
 *    passes: tagged logs first, then untagged logs in `(createdAt, id)` order
 *    poured into the slices in {@link compareSlicesForGreedyFill} order.
 * 2. The gate: every slice must have `D - S <= Q`, or the group is held back.
 * 3. For a slice with `S > D`, the latest `S - D` share units become OVERFLOW,
 *    then rows are seeded from `out`, `pending` and `released`.
 *
 * @see {@link file://./types.ts} the shared types
 * @see {@link file://../checkout-attribution.ts} the greedy fill reproduced here
 * @see superpowers/2026-11-10-booking-source-locations-design.md section 12.2
 */

import { sourceKey } from "@shelf/quantity-control";
import type { SourceRowState } from "@shelf/quantity-control";

import { compareSlicesForGreedyFill } from "../checkout-attribution";
import type {
  ConversionLog,
  ConversionSlice,
  PlannedShare,
  SourceAllocationMode,
} from "./types";

/** Orders logs by `createdAt`, then `id`, earliest first. */
function compareLogsChronologically(a: ConversionLog, b: ConversionLog) {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Units a slice can absorb from the untagged pool: its lifetime departures or its plan. */
function capacityOf(slice: ConversionSlice): number {
  return Math.max(slice.quantity, slice.checkedOutQuantity);
}

/**
 * Step 1: candidate shares, reproducing today's per-slice totals.
 *
 * Tagged logs go first, whatever their date: a log tagged with a slice of
 * the group is one share of its full quantity on that slice (capacity is not
 * checked, as in the greedy fill); a log tagged with a slice outside the
 * group becomes an OVERFLOW share and never joins the untagged pool. Untagged
 * logs then pour, in `(createdAt, id)` order, into the slices in greedy-fill
 * order, each slice taking up to `max(quantity, checkedOutQuantity)` minus
 * what it already has; one log may split across several slices, and what
 * fits nowhere becomes an OVERFLOW share. Logs with quantity 0 get no share.
 *
 * In-group shares carry `origin: "SEEDED"` and `sourceKey: null`; the row
 * they land on is decided by {@link planGroupConversion}.
 *
 * @param args.slices - Every slice of the group
 * @param args.logs - Every disposition log of the group
 * @returns The candidate shares; per log they sum to `log.quantity`
 */
export function computeCandidateShares(args: {
  slices: ConversionSlice[];
  logs: ConversionLog[];
}): PlannedShare[] {
  const { slices, logs } = args;
  const sliceIds = new Set(slices.map((s) => s.id));
  const filled = new Map<string, number>(slices.map((s) => [s.id, 0]));
  const ordered = [...logs].sort(compareLogsChronologically);
  const shares: PlannedShare[] = [];

  // Pass 1: every tagged log, whatever its date.
  for (const log of ordered) {
    if (log.bookingAssetId === null || log.quantity <= 0) continue;
    if (sliceIds.has(log.bookingAssetId)) {
      shares.push({
        consumptionLogId: log.id,
        bookingAssetId: log.bookingAssetId,
        sourceKey: null,
        quantity: log.quantity,
        origin: "SEEDED",
      });
      filled.set(
        log.bookingAssetId,
        (filled.get(log.bookingAssetId) ?? 0) + log.quantity
      );
    } else {
      // A tag outside the group is a data error: counted against nobody.
      shares.push({
        consumptionLogId: log.id,
        bookingAssetId: null,
        sourceKey: null,
        quantity: log.quantity,
        origin: "OVERFLOW",
      });
    }
  }

  // Pass 2: untagged logs, poured in greedy-fill order.
  const fillOrder = [...slices].sort(compareSlicesForGreedyFill);
  for (const log of ordered) {
    if (log.bookingAssetId !== null || log.quantity <= 0) continue;
    let left = log.quantity;
    for (const slice of fillOrder) {
      if (left === 0) break;
      const already = filled.get(slice.id) ?? 0;
      const room = Math.max(0, capacityOf(slice) - already);
      if (room === 0) continue;
      const take = Math.min(room, left);
      shares.push({
        consumptionLogId: log.id,
        bookingAssetId: slice.id,
        sourceKey: null,
        quantity: take,
        origin: "SEEDED",
      });
      filled.set(slice.id, already + take);
      left -= take;
    }
    if (left > 0) {
      shares.push({
        consumptionLogId: log.id,
        bookingAssetId: null,
        sourceKey: null,
        quantity: left,
        origin: "OVERFLOW",
      });
    }
  }

  return shares;
}

/** The outcome of planning one group's conversion. */
export type GroupConversionPlan =
  | {
      status: "convert";
      /** Every share to write; per log they sum to `log.quantity`. */
      shares: PlannedShare[];
      /** The seeded source rows of each slice, keyed by slice id. */
      rowsBySlice: Map<string, SourceRowState[]>;
      /** The new mode of each slice: KIT for kit slices, AUTO otherwise. */
      modeBySlice: Map<string, SourceAllocationMode>;
      /**
       * Pending units of each standalone slice that no row holds yet; the
       * caller allocates them. Always 0 for a kit slice (its KIT row holds them).
       */
      pendingToAllocateBySlice: Map<string, number>;
    }
  | {
      status: "held_back";
      /** Raw booked `Q`, dispatched `D` and candidate shares `S` per slice. */
      slices: Array<{ id: string; Q: number; D: number; S: number }>;
    };

/** Sum of share quantities per slice id. */
function sharedBySlice(shares: PlannedShare[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const share of shares) {
    if (share.bookingAssetId === null) continue;
    out.set(
      share.bookingAssetId,
      (out.get(share.bookingAssetId) ?? 0) + share.quantity
    );
  }
  return out;
}

/**
 * Step 3, first half: re-marks the latest `excess` units of one slice's
 * shares as OVERFLOW (latest log `createdAt` first, then latest id), splitting
 * the last share touched when needed. Per-log totals stay unchanged.
 *
 * @returns A new share list
 */
function remarkExcessAsOverflow(
  shares: PlannedShare[],
  sliceId: string,
  excess: number,
  logsById: Map<string, ConversionLog>
): PlannedShare[] {
  const next = shares.map((s) => ({ ...s }));
  const latestFirst = next
    .filter((s) => s.bookingAssetId === sliceId)
    .sort((a, b) => {
      const la = logsById.get(a.consumptionLogId);
      const lb = logsById.get(b.consumptionLogId);
      if (!la || !lb) return 0;
      return compareLogsChronologically(lb, la);
    });
  const overflow: PlannedShare[] = [];
  let left = excess;
  for (const share of latestFirst) {
    if (left === 0) break;
    const take = Math.min(left, share.quantity);
    share.quantity -= take;
    left -= take;
    overflow.push({
      consumptionLogId: share.consumptionLogId,
      bookingAssetId: null,
      sourceKey: null,
      quantity: take,
      origin: "OVERFLOW",
    });
  }
  return [...next.filter((s) => s.quantity > 0), ...overflow];
}

/**
 * Builds a source row with every counter set.
 */
function row(
  kind: SourceRowState["kind"],
  locationId: string | null,
  counters: Omit<SourceRowState, "kind" | "locationId">
): SourceRowState {
  return { kind, locationId, ...counters };
}

/**
 * The carrier row kind of a standalone slice: its recorded source, else
 * UNKNOWN when the pool had placements, else the unplaced units.
 */
function carrierOf(
  slice: ConversionSlice,
  poolHasPlacements: boolean
): Pick<SourceRowState, "kind" | "locationId"> {
  if (slice.sourceLocationId !== null) {
    return { kind: "LOCATION", locationId: slice.sourceLocationId };
  }
  if (slice.recordedSourceIsUnplaced) {
    return { kind: "UNPLACED", locationId: null };
  }
  return poolHasPlacements
    ? { kind: "UNKNOWN", locationId: null }
    : { kind: "UNPLACED", locationId: null };
}

/**
 * Plans the conversion of one LEGACY group (spec section 12.2, steps 1 to 3).
 *
 * Computes the candidate shares, applies the gate (`D - S <= Q` on every
 * slice, else the whole group is held back with its raw numbers), re-marks
 * the excess of any slice with `S > D` as OVERFLOW, and seeds rows with
 * `out = max(0, D - S)`, `pending = max(0, Q - D)` and
 * `released = Q - out - pending`:
 * - standalone slice (AUTO): the carrier row takes `out`, `dispatchedTotal = D`
 *   and every share; `released` goes on the carrier when it is a known row,
 *   else on an UNASSIGNED row; `pending` is left to the caller
 *   (`pendingToAllocateBySlice`);
 * - kit slice (KIT): one KIT row with `quantity = Q`, the same `out` and
 *   `released`, `dispatchedTotal = D` and every share.
 *
 * Every in-group share gets the `sourceKey` of its slice's carrier or KIT row.
 *
 * @param args.slices - Every slice of the group
 * @param args.logs - Every disposition log of the group
 * @param args.poolHasPlacements - Whether the pool had manual placements,
 *   deciding UNKNOWN versus UNPLACED for a slice with no recorded source
 * @returns The plan to write, or `held_back` when the gate fails
 */
export function planGroupConversion(args: {
  slices: ConversionSlice[];
  logs: ConversionLog[];
  poolHasPlacements: boolean;
}): GroupConversionPlan {
  const { slices, logs, poolHasPlacements } = args;
  const candidates = computeCandidateShares({ slices, logs });
  const candidateS = sharedBySlice(candidates);

  // Step 2: the gate, on the candidate shares, before anything is written.
  const gatePasses = slices.every(
    (s) => s.checkedOutQuantity - (candidateS.get(s.id) ?? 0) <= s.quantity
  );
  if (!gatePasses) {
    return {
      status: "held_back",
      slices: slices.map((s) => ({
        id: s.id,
        Q: s.quantity,
        D: s.checkedOutQuantity,
        S: candidateS.get(s.id) ?? 0,
      })),
    };
  }

  // Step 3: re-mark settlements beyond departures as OVERFLOW.
  const logsById = new Map(logs.map((l) => [l.id, l]));
  let shares = candidates;
  for (const slice of slices) {
    const excess = (candidateS.get(slice.id) ?? 0) - slice.checkedOutQuantity;
    if (excess > 0) {
      shares = remarkExcessAsOverflow(shares, slice.id, excess, logsById);
    }
  }
  const finalS = sharedBySlice(shares);

  // Step 3: seed rows.
  const rowsBySlice = new Map<string, SourceRowState[]>();
  const modeBySlice = new Map<string, SourceAllocationMode>();
  const pendingToAllocateBySlice = new Map<string, number>();
  const keyBySlice = new Map<string, string>();

  for (const slice of slices) {
    const Q = slice.quantity;
    const D = slice.checkedOutQuantity;
    const S = finalS.get(slice.id) ?? 0;
    const out = Math.max(0, D - S);
    const pending = Math.max(0, Q - D);
    const released = Q - out - pending;

    if (slice.assetKitId !== null) {
      const kitRow = row("KIT", null, {
        quantity: Q,
        outQuantity: out,
        releasedQuantity: released,
        dispatchedTotal: D,
        sharedQuantity: S,
      });
      rowsBySlice.set(slice.id, [kitRow]);
      modeBySlice.set(slice.id, "KIT");
      pendingToAllocateBySlice.set(slice.id, 0);
      keyBySlice.set(slice.id, sourceKey(kitRow));
      continue;
    }

    const carrier = carrierOf(slice, poolHasPlacements);
    const carrierIsKnown = carrier.kind !== "UNKNOWN";
    const carrierRow = row(carrier.kind, carrier.locationId, {
      quantity: carrierIsKnown ? out + released : out,
      outQuantity: out,
      releasedQuantity: carrierIsKnown ? released : 0,
      dispatchedTotal: D,
      sharedQuantity: S,
    });
    const rows = [carrierRow];
    if (!carrierIsKnown && released > 0) {
      rows.push(
        row("UNASSIGNED", null, {
          quantity: released,
          outQuantity: 0,
          releasedQuantity: released,
          dispatchedTotal: 0,
          sharedQuantity: 0,
        })
      );
    }
    rowsBySlice.set(slice.id, rows);
    modeBySlice.set(slice.id, "AUTO");
    pendingToAllocateBySlice.set(slice.id, pending);
    keyBySlice.set(slice.id, sourceKey(carrierRow));
  }

  return {
    status: "convert",
    shares: shares.map((share) => ({
      ...share,
      sourceKey:
        share.bookingAssetId === null
          ? null
          : keyBySlice.get(share.bookingAssetId) ?? null,
    })),
    rowsBySlice,
    modeBySlice,
    pendingToAllocateBySlice,
  };
}
