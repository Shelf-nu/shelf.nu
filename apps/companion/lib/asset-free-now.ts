/**
 * Which quantity figure the asset screen shows, and under which label.
 *
 * The web and this app call a pool's free units "Free now": total minus
 * custody, units in kits and units out, with reservations NOT subtracted. The
 * server sends it as `quantityBreakdown.freeNow`. An older server sends only
 * `available`, which also subtracts reservations, so that number keeps its old
 * "Available" label rather than being passed off as Free now.
 *
 * Pure and free of React Native imports so it runs under Node's test runner.
 *
 * @see ./asset-free-now.test.ts
 */
import type { AssetQuantityBreakdown } from "./api/types";

/** The figure to show and whether it is the "Free now" figure. */
export type FreeNowFigure = {
  /** Units to show, or `null` when there is nothing to show. */
  value: number | null;
  /** `true` when `value` is the Free now figure; `false` for the older "Available". */
  isFreeNow: boolean;
};

/**
 * Picks the free-units figure for a quantity-tracked asset.
 *
 * @param breakdown - The server's quantity breakdown; `null` when nothing is
 *   in custody, reserved or out, which leaves the whole pool free
 * @param quantity - The asset's total quantity
 * @returns The figure and whether it may be labelled "Free now"
 */
export function resolveFreeNowFigure(
  breakdown:
    | Pick<AssetQuantityBreakdown, "available" | "freeNow">
    | null
    | undefined,
  quantity: number | null | undefined
): FreeNowFigure {
  if (breakdown?.freeNow != null) {
    return { value: breakdown.freeNow, isFreeNow: true };
  }
  if (breakdown) {
    return { value: breakdown.available, isFreeNow: false };
  }
  return { value: quantity ?? null, isFreeNow: true };
}
