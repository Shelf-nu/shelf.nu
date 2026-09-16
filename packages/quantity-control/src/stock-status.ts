/**
 * `@shelf/quantity-control` — stock-status classification.
 *
 * The single derived verdict behind the assets index's `Stock status` column:
 * "for this pool of units, can I hand one out today, and is anything promised
 * beyond what the workspace owns?" One value per QUANTITY_TRACKED asset,
 * computed from figures the caller has already resolved.
 *
 * ## Why this exists as a derived enum rather than more filters
 *
 * The advanced index derives its filters from its COLUMNS, and a filter can
 * only compare a field to a typed-in literal — there is no field-to-field
 * operator, so "available below its own minQuantity" is not expressible as a
 * user-authored filter. The webapp worked around that once already with the
 * standalone `lowStockOnly` URL param and its bespoke SQL branch in
 * `generateWhereClause`. Collapsing the whole question into ONE enum column
 * means the remaining states (short / none free / no threshold) arrive through
 * the normal column→filter→sort path instead of three more bespoke params, and
 * they become visible in the row rather than only findable by someone who
 * already suspects the problem.
 *
 * ## The figures, and where each one is measured
 *
 * Every input mirrors the availability primitive in the webapp
 * (`getAssetAvailability` / `getAssetAvailabilityBatch`), which is what the
 * booking engine itself consults. Two rules from that primitive are
 * load-bearing here and easy to get wrong:
 *
 * - **Units inside a kit are counted once, as `inKits`.** A kit in custody
 *   writes custody rows for its members, and a booked kit writes booking rows
 *   for its members; both are the SAME units `inKits` already holds. Callers
 *   must pass operator custody only and standalone booking slices only.
 * - **Bookings are intervals, not a sum.** Two bookings that never overlap
 *   never compete for the same units, and a booking that is out today is not
 *   competing with one that starts after it returns. `peakBooked` is the most
 *   units owed to bookings at any single instant from now on — the same
 *   peak-concurrency sweep the booking engine runs before it accepts a
 *   reservation — so `SHORT` fires exactly when that engine would refuse.
 *
 * ## Threshold semantics
 *
 * `LOW` reuses {@link isLowStock} verbatim, so the badge can never disagree
 * with the low-stock alert, provided both are fed the same `available` figure
 * (the webapp's `physicalAvailable`).
 *
 * ## `NO_THRESHOLD` is a first-class verdict, not a fallback
 *
 * A null `minQuantity` is the common state in real workspaces: nothing in the
 * product requires one. Collapsing it into `ENOUGH` would print a confident
 * "you're fine" on rows where no floor was ever drawn. Callers render it as an
 * empty cell rather than a badge, so it cannot be read as a level, while still
 * being filterable as the setup worklist.
 *
 * @see {@link file://./low-stock.ts} — the threshold predicate this delegates to.
 * @see {@link file://./availability.ts} — `peakConcurrent`, the sweep behind `peakBooked`.
 * @see {@link file://../../labels/index.js} — the user-facing strings.
 */

import { isLowStock } from "./low-stock";

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
 * Sort weight per verdict — lower is more urgent, matching the declaration
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
  /** `Asset.quantity` — total units owned. */
  total: number;
  /**
   * Units free to hand over right now: `total − inCustody − inKits −
   * checkedOut`, where `checkedOut` is the standalone units that have actually
   * left on ONGOING/OVERDUE bookings. Deliberately NOT reduced by future
   * reservations — a reserved unit is still physically on the shelf. Callers
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
 * Classifies one QUANTITY_TRACKED asset's pool.
 *
 * Evaluated most-urgent first, and the order is load-bearing:
 *
 * 1. `SHORT` — at some instant ahead, more units are owed than exist. Checked
 *    BEFORE `NONE_FREE` because an over-committed pool is usually also empty,
 *    and "you promised more than you have" is the actionable half of that. It
 *    is the only verdict that fires without a threshold being set, because it
 *    is an integrity problem rather than a stock level, and for booking-led
 *    workspaces it is a double-booking.
 * 2. `NONE_FREE` — nothing to hand over today. Named for what is true of both a
 *    sold-out consumable and a fully checked-out equipment pool, without
 *    prescribing the opposite actions those two need (buy more vs. wait).
 * 3. `LOW` — at or below the floor, via {@link isLowStock}. Self-gating: with
 *    no `minQuantity` it cannot fire, so workspaces that never set thresholds
 *    never see it.
 * 4. `NO_THRESHOLD` — free stock, but no floor to judge it against.
 * 5. `ENOUGH` — above a floor somebody actually drew.
 *
 * @param a - Resolved figures for the asset (see {@link StockStatusInputs}).
 * @returns The verdict. Callers pass only QUANTITY_TRACKED assets; INDIVIDUAL
 *   assets have no pool and should render an empty cell without calling this.
 */
export function classifyStockStatus(a: StockStatusInputs): StockStatus {
  if (committedUnits(a) > a.total) return "SHORT";
  if (a.available <= 0) return "NONE_FREE";
  if (isLowStock({ available: a.available, minQuantity: a.minQuantity })) {
    return "LOW";
  }
  if (a.minQuantity == null) return "NO_THRESHOLD";
  return "ENOUGH";
}

/**
 * Whether a verdict should draw attention — used to decide the row highlight
 * and which footer counters are worth rendering.
 *
 * `NO_THRESHOLD` is deliberately NOT actionable: for a stock account it is a
 * setup worklist, but for an equipment rental account it is the correct and
 * permanent state, and painting it as a problem would nag that cohort forever.
 *
 * @param s - A verdict, or `null` for an INDIVIDUAL asset.
 * @returns `true` for `SHORT`, `NONE_FREE` and `LOW`.
 */
export function isActionableStockStatus(s: StockStatus | null): boolean {
  return s === "SHORT" || s === "NONE_FREE" || s === "LOW";
}
