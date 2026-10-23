/**
 * `@shelf/quantity-control` — low-stock threshold logic.
 *
 * The pure predicates behind the webapp's low-stock alerting
 * (`consumption-log/low-stock.server.ts`), stripped of all Prisma / email /
 * notification I/O. The app resolves `available` (total − custody) and the
 * asset's `minQuantity`, then asks these predicates whether to alert.
 *
 * A `null` `minQuantity` means "no threshold configured" — both predicates
 * return `false`. A threshold of exactly `0` IS valid: it alerts when the asset
 * is out of stock (`available <= 0`). This matches the webapp notifier's
 * predicate (`minQuantity != null && available <= minQuantity`) so the shared
 * package and the server never diverge. (A negative threshold can never be
 * crossed by a non-negative `available`, so it effectively never alerts.)
 *
 * @see {@link file://../../../apps/webapp/app/modules/consumption-log/low-stock.server.ts}
 */

/**
 * Whether an asset's available quantity is at or below its configured
 * threshold. Only a `null` `minQuantity` means "no threshold" (returns
 * `false`); `0` is a valid out-of-stock threshold.
 *
 * @param a.available - Units currently available (total − custody).
 * @param a.minQuantity - The configured low-stock threshold, if any.
 * @returns `true` when a threshold is set and `available <= minQuantity`.
 */
export function isLowStock(a: {
  available: number;
  minQuantity: number | null;
}): boolean {
  if (a.minQuantity == null) return false;
  return a.available <= a.minQuantity;
}

/**
 * Whether a change in available quantity CROSSED the threshold from above to
 * at-or-below — the debounce that fires the alert only on the transition, not
 * on every decrement while already low. Only a `null` `minQuantity` means "no
 * threshold"; `0` is a valid out-of-stock threshold.
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
  if (a.minQuantity == null) return false;
  return a.before > a.minQuantity && a.after <= a.minQuantity;
}
