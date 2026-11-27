/**
 * Source allocation: which loose sources (the pool's manual placements and the
 * unplaced units) a new demand of N units is taken from.
 *
 * Rules, in order: Unplaced alone when it fits; else the oldest location that
 * fits alone; else a split (Unplaced first, then most free, ties by creation
 * order); else refuse. The involuntary variant never refuses and reports the
 * part that fits nowhere.
 *
 * @see {@link file://./source-shortage.ts} the sweep that flags short slices.
 */

/** Free units at one loose source over the booking window. */
export type SourceFree = {
  kind: "LOCATION" | "UNPLACED";
  locationId: string | null;
  free: number;
  /** Creation order of the placement; lower is older. */
  createdOrder: number;
};

/** Units taken from one source. */
export type AllocationPart = {
  kind: "LOCATION" | "UNPLACED";
  locationId: string | null;
  quantity: number;
};

/** Outcome of {@link allocateSources}. */
export type AllocationResult =
  | { ok: true; parts: AllocationPart[] }
  | { ok: false; freeBySource: SourceFree[] };

/** Inputs shared by both allocators. */
type AllocationArgs = { quantity: number; sources: SourceFree[] };

/** Copies sources with negative free clamped to 0. */
function clamp(sources: SourceFree[]): SourceFree[] {
  return sources.map((s) => ({ ...s, free: Math.max(0, s.free) }));
}

/** Turns a source and a quantity into a part. */
function part(s: SourceFree, quantity: number): AllocationPart {
  return { kind: s.kind, locationId: s.locationId, quantity };
}

/**
 * Applies rules 1 and 2 (a single source covers everything).
 *
 * @returns The one-part result, or null when no single source fits
 */
function singleSource(
  n: number,
  sources: SourceFree[]
): AllocationPart[] | null {
  const unplaced = sources.find((s) => s.kind === "UNPLACED" && s.free >= n);
  if (unplaced) return [part(unplaced, n)];
  const oldest = sources
    .filter((s) => s.kind === "LOCATION" && s.free >= n)
    .sort((a, b) => a.createdOrder - b.createdOrder)[0];
  return oldest ? [part(oldest, n)] : null;
}

/**
 * Greedy split: Unplaced first, then locations by most free (ties: older).
 *
 * @returns The parts and the units that fit nowhere
 */
function split(
  n: number,
  sources: SourceFree[]
): { parts: AllocationPart[]; rest: number } {
  const ordered = [
    ...sources.filter((s) => s.kind === "UNPLACED"),
    ...sources
      .filter((s) => s.kind === "LOCATION")
      .sort((a, b) => b.free - a.free || a.createdOrder - b.createdOrder),
  ];
  const parts: AllocationPart[] = [];
  let rest = n;
  for (const s of ordered) {
    const take = Math.min(rest, s.free);
    if (take > 0) {
      parts.push(part(s, take));
      rest -= take;
    }
  }
  return { parts, rest };
}

/**
 * Allocates `quantity` units across sources, or refuses.
 *
 * @param args - The demand and the free units per source
 * @returns The parts, or every source's free count when the total is short
 */
export function allocateSources(args: AllocationArgs): AllocationResult {
  if (args.quantity <= 0) return { ok: true, parts: [] };
  const sources = clamp(args.sources);
  const single = singleSource(args.quantity, sources);
  if (single) return { ok: true, parts: single };
  const { parts, rest } = split(args.quantity, sources);
  if (rest > 0) return { ok: false, freeBySource: sources };
  return { ok: true, parts };
}

/**
 * Involuntary variant: never refuses; units that fit nowhere are returned as
 * `unassigned` for the caller to put on the slice's UNASSIGNED row.
 *
 * @param args - The demand and the free units per source
 */
export function allocateSourcesOrUnassigned(args: AllocationArgs): {
  parts: AllocationPart[];
  unassigned: number;
} {
  if (args.quantity <= 0) return { parts: [], unassigned: 0 };
  const sources = clamp(args.sources);
  const single = singleSource(args.quantity, sources);
  if (single) return { parts: single, unassigned: 0 };
  const { parts, rest } = split(args.quantity, sources);
  return { parts, unassigned: rest };
}
