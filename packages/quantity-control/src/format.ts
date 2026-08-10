/**
 * `@shelf/quantity-control` — unit-count formatting.
 *
 * A pure display helper for phrasing a unit count with an asset's unit of
 * measure (`"10 boxes"`, `"10 units"`). Kept dependency-free and
 * responsibility-minimal: it does NOT gate on asset type and does NOT sanitize
 * the label (Markdoc sanitization is an app-layer concern that stays in the
 * webapp) — it only formats.
 *
 * @see {@link file://../../../apps/webapp/app/utils/asset-quantity.ts}
 */

/**
 * Formats a unit count with an asset's unit of measure, defaulting to "units"
 * when no (or a blank) unit is supplied.
 *
 * @param n - The count to render.
 * @param unitOfMeasure - The asset's unit of measure (blank/absent → "units").
 * @returns A label like `"10 boxes"` or `"10 units"`.
 */
export function formatUnitCount(
  n: number,
  unitOfMeasure?: string | null
): string {
  const unit = (unitOfMeasure && unitOfMeasure.trim()) || "units";
  return `${n} ${unit}`;
}
