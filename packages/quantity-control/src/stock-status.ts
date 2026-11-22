/**
 * `@shelf/quantity-control`, stock-status vocabulary and arithmetic.
 *
 * The values and figures behind the assets index's `Stock status` column:
 * "for this pool of units, can I hand one out today, and is anything promised
 * beyond what the workspace owns?" One verdict per QUANTITY_TRACKED asset.
 *
 * The verdict itself is computed in SQL (`POOL_STOCK_STATUS_EXPR` in the
 * webapp's `modules/asset/query.server.ts`), because the list filters and
 * sorts on it in the database. This module owns what both apps share with
 * that expression: the set of verdicts and their severity order, and the
 * shortfall arithmetic the badge and the Reserved cell print.
 *
 * ## The verdicts, most urgent first
 *
 * 1. `SHORT`: at some instant ahead, more units are owed than exist
 *    ({@link shortfallUnits} > 0). Judged before `NONE_FREE` because an
 *    over-committed pool is usually also empty, and "you promised more than
 *    you have" is the actionable half. The only verdict that needs no floor.
 * 2. `NONE_FREE`: nothing to hand over today.
 * 3. `LOW`: free units at or below the floor (`isLowStock`).
 * 4. `NO_THRESHOLD`: free stock, but no floor to judge it against. A
 *    first-class verdict, not a fallback: rendered as an empty cell so it is
 *    never read as "you're fine".
 * 5. `ENOUGH`: above a floor somebody drew.
 *
 * ## The figures, and where each one is measured
 *
 * Every input mirrors the availability primitive in the webapp
 * (`getAssetAvailability` / `getAssetAvailabilityBatch`), which is what the
 * booking engine itself consults. Two rules from that primitive are
 * load-bearing:
 *
 * - **Units inside a kit are counted once, as `inKits`.** A kit in custody
 *   writes custody rows for its members, and a booked kit writes booking rows
 *   for its members; both are the SAME units `inKits` already holds. Callers
 *   pass operator custody only and standalone booking slices only.
 * - **Bookings are intervals, not a sum.** `peakBooked` is the most units
 *   owed to bookings at any single instant from now on, the same
 *   peak-concurrency sweep the booking engine runs before it accepts a
 *   reservation, so `SHORT` fires exactly when that engine would refuse.
 *
 * @see {@link file://./availability.ts}, `peakConcurrent`, the sweep behind `peakBooked`.
 * @see {@link file://../../labels/index.js}, the user-facing strings.
 */

/**
 * Every stock-status verdict, ordered MOST to LEAST urgent. The union type
 * {@link StockStatus} is derived from this array so a value can never be added
 * to one without the other, and {@link STOCK_STATUS_SEVERITY} indexes it, so
 * "sort worst first" needs no second list to keep in step.
 */
export const STOCK_STATUSES = [
  "SHORT",
  "NONE_FREE",
  "LOW",
  "ENOUGH",
  "NO_THRESHOLD",
] as const;

/** A quantity asset's stock verdict. `null` for INDIVIDUAL assets. */
export type StockStatus = (typeof STOCK_STATUSES)[number];

/**
 * Sort weight per verdict, lower is more urgent, matching the declaration
 * order of {@link STOCK_STATUSES}. Ascending sort puts `SHORT` first.
 *
 * `NO_THRESHOLD` sorts last rather than beside `ENOUGH`, because it is the
 * absence of an opinion, not a healthy reading.
 */
export const STOCK_STATUS_SEVERITY: Readonly<Record<StockStatus, number>> =
  Object.freeze(
    Object.fromEntries(STOCK_STATUSES.map((s, i) => [s, i])) as Record<
      StockStatus,
      number
    >
  );

/** Resolved figures for one asset. All counts are units, not rows. */
export type StockStatusInputs = {
  /** `Asset.quantity`, total units owned. */
  total: number;
  /**
   * Units free to hand over right now: `total − inCustody − inKits −
   * checkedOut`, where `checkedOut` is the standalone units that have actually
   * left on ONGOING/OVERDUE bookings. Deliberately NOT reduced by future
   * reservations, a reserved unit is still physically on the shelf. Callers
   * surface `reserved` as its own column precisely because it is not
   * subtracted here.
   */
  available: number;
  /**
   * The most units owed to bookings at any single instant from now on, over
   * STANDALONE slices of active bookings (RESERVED, ONGOING and OVERDUE), with
   * an overdue booking treated as never ending. This is `peakConcurrent` over
   * the same intervals the booking engine sweeps, so a pool reads `SHORT`
   * exactly when a new reservation would be refused.
   *
   * Not a sum: eight tripods reserved for Monday and eight for Friday from a
   * pool of ten peak at eight, not sixteen. Not "the largest booking" either:
   * two bookings of six that overlap peak at twelve, which the largest-booking
   * reading would miss.
   */
  peakBooked: number;
  /**
   * Units held by custodians DIRECTLY (operator custody). Kit-inherited custody
   * rows are excluded: those units are already inside `inKits`.
   */
  inCustody: number;
  /** Units earmarked to kits, whatever the kit is currently doing. */
  inKits: number;
  /** The reorder floor, or `null` when nobody set one. */
  minQuantity: number | null;
};

/**
 * Units the pool must cover at its busiest point ahead: everything held today
 * that is not on a booking, plus the peak the bookings themselves reach.
 *
 * Checked-out units are NOT a separate term. A unit out on an ONGOING booking
 * is inside `peakBooked` for as long as that booking runs; adding it again
 * would count it twice and paint a rental pool `SHORT` because of a booking
 * that ends before the next one starts.
 *
 * Exported because the `SHORT` verdict is the one figure a caller may want to
 * show alongside the badge ("promised 12, own 10"), and re-deriving it at the
 * call site is how the two drift.
 *
 * @param a - The claim counts (see {@link StockStatusInputs}).
 * @returns Operator custody plus kit units plus the booking peak.
 */
export function committedUnits(a: {
  peakBooked: number;
  inCustody: number;
  inKits: number;
}): number {
  return a.inCustody + a.inKits + a.peakBooked;
}

/**
 * How many units a pool is short by: the units committed at the busiest point
 * ahead ({@link committedUnits}) minus the units owned, never below 0. It is
 * the number a `SHORT` verdict is about, so the badge ("Short by 2") and the
 * Reserved cell both read it from here.
 *
 * @param a - The claim counts plus `total`, the units owned.
 * @returns Units missing at the busiest point ahead; 0 when nothing is short.
 */
export function shortfallUnits(a: {
  total: number;
  peakBooked: number;
  inCustody: number;
  inKits: number;
}): number {
  return Math.max(0, committedUnits(a) - a.total);
}
