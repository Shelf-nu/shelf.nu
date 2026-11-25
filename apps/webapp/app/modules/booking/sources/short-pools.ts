/**
 * Which pools on a booking are short at their sources (pure, no DB access).
 *
 * The scanner check-out drawer blocks a scanned pool whose standalone slice is
 * short, because the check-out refuses it until its sources change. The short
 * flags come from the booking's source summaries, the same ones the booking
 * page's Location cell shows, so the drawer and the page never disagree.
 *
 * @see {@link file://./booking-sources.server.ts} `getSliceSourceSummaries`
 * @see {@link file://../../../components/scanner/drawer/uses/partial-checkout-blockers.tsx}
 */

/** The slice fields {@link shortPoolAssetIds} reads. */
export type ShortPoolSlice = {
  /** `BookingAsset.id`. */
  id: string;
  assetId: string;
  /** Set on a kit-driven slice: kit units are never short at a source. */
  assetKitId: string | null;
};

/**
 * The asset ids whose standalone slice on the booking is short.
 *
 * @param slices - The booking's slices
 * @param summaries - Short flag per slice id; a slice without an entry is
 *   not short
 * @returns Asset ids, each once, in slice order
 */
export function shortPoolAssetIds(
  slices: readonly ShortPoolSlice[],
  summaries: ReadonlyMap<string, { short: boolean }>
): string[] {
  const ids = new Set<string>();
  for (const slice of slices) {
    if (slice.assetKitId) continue;
    if (summaries.get(slice.id)?.short) ids.add(slice.assetId);
  }
  return [...ids];
}
