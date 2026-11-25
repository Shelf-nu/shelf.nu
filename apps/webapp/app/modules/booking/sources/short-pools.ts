/**
 * Which pools on a booking cannot go out at all because of short sources
 * (pure, no DB access).
 *
 * The scanner check-out drawer blocks a scanned pool only when the check-out
 * would refuse every unit of it: some standalone slice is short, and no
 * standalone slice of the asset has pending units at a LOCATION or UNPLACED
 * source that is not short. A pool with pending units at a healthy source can
 * still send those out, so the drawer lets it through and a check-out that
 * reaches a short source is refused by the server with its own message.
 *
 * The short flags come from the booking's source summaries, the same ones the
 * booking page's Location cell shows, so the drawer and the page never
 * disagree.
 *
 * @see {@link file://./booking-sources.server.ts} `getSliceSourceSummaries`
 * @see {@link file://../../../components/scanner/drawer/uses/partial-checkout-blockers.tsx}
 */

import type { BookingSourcePart } from "@shelf/quantity-control";

/** The slice fields {@link shortPoolAssetIds} reads. */
export type ShortPoolSlice = {
  /** `BookingAsset.id`. */
  id: string;
  assetId: string;
  /** Set on a kit-driven slice: kit units are never short at a source. */
  assetKitId: string | null;
};

/** What {@link shortPoolAssetIds} reads of one slice's source summary. */
export type ShortPoolSummary = {
  /** True when any pending unit of the slice cannot be covered. */
  short: boolean;
  /** The slice's display parts. */
  parts: ReadonlyArray<
    Pick<BookingSourcePart, "kind" | "planned" | "out" | "short">
  >;
};

/**
 * Whether a slice has pending units at a LOCATION or UNPLACED source that is
 * not short: those units can leave now.
 */
function hasHealthyPending(summary: ShortPoolSummary | undefined): boolean {
  if (!summary) return false;
  return summary.parts.some(
    (part) =>
      (part.kind === "LOCATION" || part.kind === "UNPLACED") &&
      part.planned - part.out > 0 &&
      !part.short
  );
}

/**
 * The asset ids the drawer blocks: some standalone slice of the asset is
 * short, and no standalone slice of it has pending units at a healthy
 * LOCATION or UNPLACED source.
 *
 * @param slices - The booking's slices
 * @param summaries - Source summary per slice id; a slice without an entry
 *   is neither short nor a source of pending units
 * @returns Asset ids, each once, in slice order
 */
export function shortPoolAssetIds(
  slices: readonly ShortPoolSlice[],
  summaries: ReadonlyMap<string, ShortPoolSummary>
): string[] {
  const shortAssets = new Set<string>();
  const healthyAssets = new Set<string>();
  for (const slice of slices) {
    if (slice.assetKitId) continue;
    const summary = summaries.get(slice.id);
    if (summary?.short) shortAssets.add(slice.assetId);
    if (hasHealthyPending(summary)) healthyAssets.add(slice.assetId);
  }
  return [...shortAssets].filter((assetId) => !healthyAssets.has(assetId));
}
