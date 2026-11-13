/**
 * Short-slice sweep: which slices hold pending units that a source can no
 * longer cover.
 *
 * Per source, over time: units out are granted first and once (they are
 * physically gone), then the remaining capacity goes to pending units only, by
 * booking `from` ascending, then `createdAt`, then booking id. A slice is short
 * when at some instant its pending units exceed what it was granted. UNASSIGNED
 * pending units are always short. Shared by the loader, the check-out guard and
 * the scanner blocker so they never disagree.
 *
 * @see {@link file://./booking-sources.ts} for the source key format.
 */

/** One slice's hold at one source (LOCATION or UNPLACED rows only). */
export type SourceHold = {
  sliceId: string;
  /** Key from `sourceKey()` of the row. */
  sourceKey: string;
  bookingFrom: Date;
  bookingCreatedAt: Date;
  bookingId: string;
  /** Half-open window `[from, to)` the hold is active in. */
  from: Date;
  to: Date;
  out: number;
  pending: number;
};

/** A slice short at a source, by the largest shortfall over time. */
export type SliceShortage = {
  sliceId: string;
  sourceKey: string;
  shortBy: number;
};

/** Source key reported for UNASSIGNED pending units. */
const UNASSIGNED_KEY = "UNASSIGNED:";

/** Priority order for granting pending capacity. */
function byPriority(a: SourceHold, b: SourceHold): number {
  return (
    a.bookingFrom.getTime() - b.bookingFrom.getTime() ||
    a.bookingCreatedAt.getTime() - b.bookingCreatedAt.getTime() ||
    (a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0) ||
    (a.sliceId < b.sliceId ? -1 : a.sliceId > b.sliceId ? 1 : 0)
  );
}

/**
 * Computes every short slice.
 *
 * @param args.capacityBySource - Placed minus custody per source key; a missing key is 0
 * @param args.holds - LOCATION and UNPLACED holds of active bookings
 * @param args.unassignedPendingBySlice - Pending units on each slice's UNASSIGNED row
 * @returns One entry per short slice and source, sorted by slice id then source key
 */
export function computeShortSlices(args: {
  capacityBySource: Map<string, number>;
  holds: SourceHold[];
  unassignedPendingBySlice: Map<string, number>;
}): SliceShortage[] {
  const shortBy = new Map<string, SliceShortage>();
  const record = (sliceId: string, sourceKey: string, amount: number) => {
    if (amount <= 0) return;
    const id = `${sliceId}|${sourceKey}`;
    const prev = shortBy.get(id);
    if (!prev || prev.shortBy < amount) {
      shortBy.set(id, { sliceId, sourceKey, shortBy: amount });
    }
  };

  const bySource = new Map<string, SourceHold[]>();
  for (const h of args.holds) {
    const list = bySource.get(h.sourceKey) ?? [];
    list.push(h);
    bySource.set(h.sourceKey, list);
  }

  for (const [key, holds] of bySource) {
    const capacity = Math.max(0, args.capacityBySource.get(key) ?? 0);
    const ordered = [...holds].sort(byPriority);
    // Each distinct boundary starts a stretch where the active set is constant.
    const instants = [
      ...new Set(holds.flatMap((h) => [h.from.getTime(), h.to.getTime()])),
    ].sort((a, b) => a - b);
    for (const t of instants) {
      const active = ordered.filter(
        (h) => h.from.getTime() <= t && t < h.to.getTime()
      );
      if (active.length === 0) continue;
      const outTotal = active.reduce((sum, h) => sum + h.out, 0);
      let remaining = Math.max(0, capacity - outTotal);
      for (const h of active) {
        const granted = Math.min(h.pending, remaining);
        remaining -= granted;
        record(h.sliceId, key, h.pending - granted);
      }
    }
  }

  for (const [sliceId, pending] of args.unassignedPendingBySlice) {
    record(sliceId, UNASSIGNED_KEY, pending);
  }

  return [...shortBy.values()].sort(
    (a, b) =>
      (a.sliceId < b.sliceId ? -1 : a.sliceId > b.sliceId ? 1 : 0) ||
      (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0)
  );
}
