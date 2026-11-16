/**
 * Which quantity figure the asset screen shows, and under which label.
 *
 * The web and this app call a pool's free units "Free now": total minus
 * custody, units in kits and units out, with reservations NOT subtracted. The
 * server sends it as the asset's top-level `freeNow`, also when the quantity
 * breakdown is null (units held only in kits leave nothing to slice, yet
 * nothing is free). An older server sends no `freeNow`, only the breakdown's
 * `available`, which also subtracts reservations, so that number keeps its old
 * "Available" label rather than being passed off as Free now.
 *
 * Mirrors the web's "Free now" figure; the canonical value is computed by
 * apps/webapp/app/modules/asset/quantity-breakdown.server.ts
 * (`getAssetQuantityRows`) and sent by
 * apps/webapp/app/routes/api+/mobile+/assets.$assetId.ts. Display only.
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
 * Prefers the server's `freeNow`. Without it (an older server) the
 * breakdown's reservation-aware `available` is shown under its old label, and
 * with neither the whole pool counts as free.
 *
 * @param freeNow - The asset's top-level Free now figure; absent or `null`
 *   on servers that do not send it
 * @param breakdown - The server's quantity breakdown; `null` when nothing is
 *   in custody, reserved or out
 * @param quantity - The asset's total quantity
 * @returns The figure and whether it may be labelled "Free now"
 */
export function resolveFreeNowFigure(
  freeNow: number | null | undefined,
  breakdown: Pick<AssetQuantityBreakdown, "available"> | null | undefined,
  quantity: number | null | undefined
): FreeNowFigure {
  if (typeof freeNow === "number") {
    return { value: freeNow, isFreeNow: true };
  }
  if (breakdown) {
    return { value: breakdown.available, isFreeNow: false };
  }
  return { value: quantity ?? null, isFreeNow: true };
}
