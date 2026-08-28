/**
 * Quantity-display helpers for QUANTITY_TRACKED assets.
 *
 * These power the additive, read-only quantity UI on the assets list row and
 * the asset detail screen. INDIVIDUAL assets never reach these helpers (the
 * call sites guard on `isQuantityTracked` first), so display is unchanged for
 * them.
 *
 * Every helper is defensive: the live server may not yet send the quantity
 * fields, so a missing `quantity` resolves to `null` (render nothing) rather
 * than crashing. Mirrors the webapp's quantity formatting in spirit while
 * keeping the companion's own concise number/unit style.
 *
 * @see {@link file://./api/types.ts} AssetQuantityFields / AssetQuantityBreakdown
 * @see {@link file://../app/(tabs)/assets/index.tsx} list-row consumer
 * @see {@link file://../app/(tabs)/assets/[id].tsx} detail-screen consumer
 */
import type { AssetQuantityFields } from "@/lib/api";

/**
 * True when the asset is server-classified as QUANTITY_TRACKED. Pre-quantity
 * servers omit `type`, so this is `false` then — INDIVIDUAL assets render
 * exactly as before.
 *
 * @param asset - Any asset shape carrying the optional quantity fields.
 * @returns Whether the asset is a quantity-tracked row.
 */
export function isQuantityTracked(
  asset: Pick<AssetQuantityFields, "type">
): boolean {
  return asset.type === "QUANTITY_TRACKED";
}

/**
 * Compact "<n> <unit>" label for a quantity, e.g. `"10 pcs"` or `"10"` when no
 * unit of measure is set. Returns `null` when the quantity is absent/non-finite
 * so callers can render nothing instead of "null" or "NaN".
 *
 * @param quantity - The unit count (may be null/undefined on older servers).
 * @param unitOfMeasure - Optional display unit; appended when present.
 * @returns The formatted label, or `null` when there is nothing to show.
 */
export function formatQuantity(
  quantity: number | null | undefined,
  unitOfMeasure: string | null | undefined
): string | null {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    return null;
  }
  const unit = unitOfMeasure?.trim();
  return unit ? `${quantity} ${unit}` : `${quantity}`;
}
