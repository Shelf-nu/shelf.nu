/**
 * `@shelf/quantity-control` — low-stock threshold logic.
 *
 * The pure predicates behind the webapp's low-stock alerting
 * (`consumption-log/low-stock.server.ts`), stripped of all Prisma / email /
 * notification I/O. The app resolves `available` (total − custody) and the
 * asset's `minQuantity`, then asks these predicates whether to alert.
 *
 * A `minQuantity` of `null` or `<= 0` means "no threshold configured" — both
 * predicates return `false`, so a workspace that never set a threshold is
 * never alerted (and a threshold of exactly 0 does not spam on every zero).
 *
 * @see {@link file://../../../apps/webapp/app/modules/consumption-log/low-stock.server.ts}
 */

/**
 * Whether an asset's available quantity is at or below its configured
 * threshold. Requires a positive `minQuantity` — `null`/`<= 0` means "no
 * threshold" and returns `false`.
 *
 * @param a.available - Units currently available (total − custody).
 * @param a.minQuantity - The configured low-stock threshold, if any.
 * @returns `true` when a threshold is set and `available <= minQuantity`.
 */
export function isLowStock(a: {
  available: number;
  minQuantity: number | null;
}): boolean {
  if (a.minQuantity == null || a.minQuantity <= 0) return false;
  return a.available <= a.minQuantity;
}

/**
 * Whether a change in available quantity CROSSED the threshold from above to
 * at-or-below — the debounce that fires the alert only on the transition, not
 * on every decrement while already low. Requires a positive `minQuantity`.
 *
 * @param a.before - Available quantity before the change.
 * @param a.after - Available quantity after the change.
 * @param a.minQuantity - The configured low-stock threshold, if any.
 * @returns `true` only when `before > minQuantity` and `after <= minQuantity`.
 */
export function crossedLowStockThreshold(a: {
  before: number;
  after: number;
  minQuantity: number | null;
}): boolean {
  if (a.minQuantity == null || a.minQuantity <= 0) return false;
  return a.before > a.minQuantity && a.after <= a.minQuantity;
}
