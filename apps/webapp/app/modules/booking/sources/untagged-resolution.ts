/**
 * Resolution of an untagged check-in over the slices and rows of a group.
 *
 * A quantity-level disposition that names no slice is attributed to the rows
 * with units out: most out first, then by slice allocation order, then by row
 * id. Each (slice, row) used becomes one share.
 *
 * @see {@link file://./types.ts}
 * @see superpowers/2026-11-10-booking-source-locations-design.md section 16
 */
import type { SourceRowState } from "@shelf/quantity-control";

import type { SourceAllocationMode } from "./types";

/** Quantity-level disposition of one asset on a booking. */
export type UntaggedDisposition = {
  assetId: string;
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

/** Units of an untagged disposition attributed to one slice row. */
export type ResolvedShare = {
  sliceId: string;
  sourceRowId: string;
  units: number;
};

/** Row kinds that can have units out and take an untagged settlement. */
const RESOLVABLE_KINDS: readonly SourceRowState["kind"][] = [
  "LOCATION",
  "UNPLACED",
  "KIT",
  "UNKNOWN",
];

/**
 * Spreads `units` settled units over the rows that have units out.
 *
 * @param args.slices - The slices of one converted group with their rows
 * @param args.units - Units to attribute, a positive integer
 * @returns One share per (slice, row) used, `units > 0`, in resolution order
 * @throws {Error} When a slice is LEGACY, or `units` exceeds the total out
 */
export function resolveUntaggedDisposition(args: {
  slices: Array<{
    id: string;
    mode: SourceAllocationMode;
    allocationOrder: number;
    rows: Array<SourceRowState & { id: string }>;
  }>;
  units: number;
}): ResolvedShare[] {
  const { slices, units } = args;
  const candidates: Array<{
    sliceId: string;
    rowId: string;
    out: number;
    order: number;
  }> = [];
  for (const slice of slices) {
    if (slice.mode === "LEGACY") {
      throw new Error(
        `Slice ${slice.id} is LEGACY: untagged resolution needs a converted group`
      );
    }
    for (const row of slice.rows) {
      if (row.outQuantity > 0 && RESOLVABLE_KINDS.includes(row.kind)) {
        candidates.push({
          sliceId: slice.id,
          rowId: row.id,
          out: row.outQuantity,
          order: slice.allocationOrder,
        });
      }
    }
  }
  const totalOut = candidates.reduce((sum, c) => sum + c.out, 0);
  if (units > totalOut) {
    throw new Error(`Cannot resolve ${units} units: only ${totalOut} out`);
  }
  candidates.sort(
    (a, b) =>
      b.out - a.out ||
      a.order - b.order ||
      (a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0)
  );
  const shares: ResolvedShare[] = [];
  let remaining = units;
  for (const c of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(c.out, remaining);
    shares.push({ sliceId: c.sliceId, sourceRowId: c.rowId, units: take });
    remaining -= take;
  }
  return shares;
}
