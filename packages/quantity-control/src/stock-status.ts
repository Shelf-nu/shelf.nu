/**
 * `@shelf/quantity-control` — stock-status classification.
 *
 * The single derived verdict behind the assets index's `Stock status` column:
 * "for this pool of units, right now, can I hand one out, and should anyone be
 * worried?" One value per QUANTITY_TRACKED asset, computed from figures the
 * caller has already resolved.
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
 * ## Threshold semantics, and the definition this settles
 *
 * `LOW` reuses {@link isLowStock} verbatim, so the badge can never disagree
 * with the low-stock alert. That matters because two definitions currently
 * ship: the alert path uses AVAILABLE (`total − custody`), while the
 * `lowStockOnly` filter predicate uses TOTAL `quantity`. For an asset with
 * total 6, custody 2 and a threshold of 5 those disagree — the email fires and
 * the filter cannot find the row. This module is the available-based one, and
 * the SQL predicate is being moved onto it.
 *
 * ## `NO_THRESHOLD` is a first-class verdict, not a fallback
 *
 * A null `minQuantity` is the MAJORITY state in real workspaces (measured: 2 of
 * 12 quantity assets in a live account had one set, 0 of 10 in dev; nothing in
 * the product ever asks for it). Collapsing it into `ENOUGH` would print a
 * confident "you're fine" on rows where no floor was ever drawn. Callers render
 * it as an empty cell rather than a badge, so it cannot be read as a level,
 * while still being filterable as the setup worklist.
 *
 * @see {@link file://./low-stock.ts} — the threshold predicate this delegates to.
 * @see {@link file://./availability.ts} — where `available` comes from.
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
   * checkedOut`. Deliberately NOT reduced by future reservations — a reserved
   * unit is still physically on the shelf (the #2724 fix). Callers surface
   * `reserved` as its own column precisely because it is not subtracted here.
   */
  available: number;
  /**
   * The LARGEST single upcoming booking's claim on this pool — not the sum of
   * every upcoming booking.
   *
   * Summing is wrong for anything that comes back. Eight tripods reserved for
   * Monday and eight for Friday, from a pool of ten, sums to sixteen and would
   * report the pool as over-committed; in reality you never need more than
   * eight at once. That is the same double-count `peakConcurrent` exists to
   * solve, and true peak demand needs the booking intervals, which this
   * row-level verdict deliberately does not have (dates belong to the
   * availability view).
   *
   * The largest single booking is the conservative stand-in: it is a lower
   * bound on peak demand, so it CANNOT raise a false alarm, and it still
   * catches the case that matters — one booking asking for more units than
   * exist. It will miss two genuinely overlapping bookings that only exceed the
   * pool in combination; that gap is accepted and belongs to the availability
   * view.
   *
   * Note this is the one input where consumables would ideally differ: a
   * one-way consumable's future bookings really do stack, so for those the sum
   * is the honest figure. Branching on `consumptionType` is left out of v1
   * because the field is nullable and unset on existing quantity assets.
   */
  largestUpcomingBooking: number;
  /** Units held by custodians. Feeds `SHORT` only. */
  inCustody: number;
  /** Units earmarked to kits. Feeds `SHORT` only. */
  inKits: number;
  /** Units off the shelf on ONGOING/OVERDUE bookings. Feeds `SHORT` only. */
  checkedOut: number;
  /** The reorder floor, or `null` when nobody set one. */
  minQuantity: number | null;
};

/**
 * Total units promised or held across every claim on the pool.
 *
 * Exported because the `SHORT` verdict is the one figure a caller may want to
 * show alongside the badge ("promised 8, own 6"), and re-deriving it at the
 * call site is how the two drift.
 *
 * @param a - The claim counts (see {@link StockStatusInputs}).
 * @returns Sum of custody, kit, checked-out and reserved units.
 */
export function committedUnits(a: {
  largestUpcomingBooking: number;
  inCustody: number;
  inKits: number;
  checkedOut: number;
}): number {
  return a.inCustody + a.inKits + a.checkedOut + a.largestUpcomingBooking;
}

/**
 * Classifies one QUANTITY_TRACKED asset's pool.
 *
 * Evaluated most-urgent first, and the order is load-bearing:
 *
 * 1. `SHORT` — commitments exceed what is owned. Checked BEFORE `NONE_FREE`
 *    because an over-committed pool is always also empty, and "you promised
 *    more than you have" is the actionable half of that. It is the only verdict
 *    that fires without a threshold being set, because it is an integrity
 *    problem rather than a stock level, and for booking-led workspaces it is a
 *    double-booking.
 * 2. `NONE_FREE` — nothing to hand over. Named for what is true of both a
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
