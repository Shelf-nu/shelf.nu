/**
 * Booking-Pool Availability — pure, client-safe core
 *
 * THE single formula for "how many units of a QUANTITY_TRACKED asset are
 * available for booking use". Every booking-family availability surface
 * (asset overview card, booking overview badge, manage-assets picker,
 * scanner picker, checkout guard, model-request pool) derives its number
 * from this function — either directly (client-bundled reducers) or via
 * the batch fetcher in `availability.server.ts`. Do NOT re-implement the
 * subtraction inline anywhere; seven divergent copies of this formula are
 * exactly the bug class this module exists to kill.
 *
 * This file is intentionally NOT suffixed `.server` — it is imported by
 * client-bundled code (`asset-status-badge/quantity-data.ts`,
 * `quantity-overview-card.tsx`) and must stay free of server-only imports.
 *
 * TWO AVAILABILITY FAMILIES — do not conflate:
 *   1. BOOKING family (this module): subtracts booking reservations.
 *      Answers "can I reserve N more units for a booking?".
 *   2. CUSTODY family (`computeAvailableQuantity` in
 *      `~/modules/consumption-log/service.server`, `custodyAvailable` on the
 *      asset overview, `low-stock.server.ts`): deliberately does NOT
 *      subtract reservations, because reserved units are still physically
 *      present on the shelf until the booking checks out. Custody
 *      assignment and quantity adjustment are capped by the custody
 *      family, not this one.
 *
 * @see {@link file://./availability.server.ts} — batch DB fetcher over this core
 * @see {@link file://../consumption-log/service.server.ts} — custody family
 */

/** Inputs for {@link computeBookingPoolAvailability}. All counts are unit sums. */
export type BookingPoolInputs = {
  /** Workspace stock — `Asset.quantity` (see quantity-semantics-per-surface rule). */
  total: number;
  /** Units held by custodians — Σ `Custody.quantity` (scope decided by caller). */
  inCustody: number;
  /** Units committed to RESERVED (not-yet-out) bookings — Σ `BookingAsset.quantity`. */
  reserved: number;
  /** Units committed to ONGOING/OVERDUE bookings. Defaults to 0 when the surface folds them into `reserved`. */
  checkedOut?: number;
  /** Units earmarked for kits — Σ `AssetKit.quantity`. Defaults to 0 for surfaces that don't subtract kit slices. */
  inKits?: number;
};

/** Result of {@link computeBookingPoolAvailability}. */
export type BookingPoolAvailability = {
  /**
   * The signed headroom: `total − inKits − inCustody − reserved − checkedOut`.
   * Negative when the pool is over-committed (more units promised across
   * bookings/custody than exist). Diagnostics, guards, and "over-committed
   * by N" callouts read this — it never lies about oversubscription.
   */
  raw: number;
  /**
   * Display-safe availability: `max(0, raw)`. UI surfaces render this so
   * users never see "-7 available"; pair it with a raw-derived callout when
   * the oversubscription itself must be surfaced.
   */
  available: number;
};

/**
 * Computes booking-pool availability for a QUANTITY_TRACKED asset.
 *
 * Returns BOTH the signed (`raw`) and clamped (`available`) values so call
 * sites make an explicit, named choice instead of re-deriving the formula
 * with or without a clamp. Invariant (property-tested):
 * `available === Math.max(0, raw)` for every input combination.
 *
 * @param inputs - Unit sums per bucket (see {@link BookingPoolInputs})
 * @returns `{ raw, available }` per {@link BookingPoolAvailability}
 */
export function computeBookingPoolAvailability(
  inputs: BookingPoolInputs
): BookingPoolAvailability {
  const raw =
    inputs.total -
    (inputs.inKits ?? 0) -
    inputs.inCustody -
    inputs.reserved -
    (inputs.checkedOut ?? 0);

  return { raw, available: Math.max(0, raw) };
}

/** Inputs for {@link splitDisplayBookingCommitments}. */
export type DisplayBookingCommitmentInputs = {
  /**
   * Disposition-adjusted commitment of RESERVED-status bookings — the
   * `reserved` field of a `dispositionAware` booking-pool row.
   */
  poolReserved: number;
  /**
   * Disposition-adjusted commitment of ONGOING/OVERDUE bookings — the
   * `checkedOut` field of a `dispositionAware` booking-pool row. Named
   * "active" here because the physical split below re-partitions it.
   */
  poolActive: number;
  /**
   * RAW `Σ BookingAsset.quantity` over the same ONGOING/OVERDUE slices, i.e.
   * before dispositions are subtracted. Used only to recover how many units
   * those dispositions removed (`rawActiveBooked − poolActive`).
   */
  rawActiveBooked: number;
  /**
   * Units claimed by `PartialBookingCheckout` across those active bookings —
   * `computeCheckedOutForAsset`. This is a RAW scan count: partial check-in
   * never decrements it, which is exactly why it must be reconciled here
   * rather than rendered directly.
   */
  scannedOut: number;
};

/**
 * Re-splits a disposition-aware booking commitment into the PHYSICAL buckets
 * the asset-overview card renders ("Reserved (bookings)" vs "Checked out
 * (bookings)").
 *
 * why this exists: the booking-pool module splits by BOOKING STATUS, but the
 * overview card promises a physical split — what is still on the shelf vs what
 * already left. Deriving those rows from raw `BookingAsset.quantity` sums (the
 * pre-fix behavior) breaks the card's own arithmetic the moment a
 * CONSUME/LOSS/DAMAGE partial check-in lands: those units were already
 * decremented from `Asset.quantity` AND from the pool, so the raw sums render
 * phantom units and `total − inKits − inCustody − reserved − checkedOut` stops
 * equalling the `raw` behind the "Available" row.
 *
 * The split is total-preserving by construction —
 * `reserved + checkedOut === poolReserved + poolActive` — and that sum is
 * precisely what {@link computeBookingPoolAvailability} consumes, so the card
 * reconciles for every input.
 *
 * @param inputs - See {@link DisplayBookingCommitmentInputs}
 * @returns `reserved` (committed but still physically present) and
 *   `checkedOut` (committed AND physically off the shelf)
 */
export function splitDisplayBookingCommitments({
  poolReserved,
  poolActive,
  rawActiveBooked,
  scannedOut,
}: DisplayBookingCommitmentInputs): {
  reserved: number;
  checkedOut: number;
} {
  /**
   * Units the active bookings disposed of via partial check-in. The pool has
   * already removed them; `scannedOut` has not, so it over-reports the
   * physically-out count by exactly this much. Floored at 0 defensively —
   * `poolActive` can only exceed `rawActiveBooked` on pathological data.
   */
  const disposedOnActiveBookings = Math.max(0, rawActiveBooked - poolActive);

  /**
   * Physically out = scanned out, minus what has since been disposed of,
   * capped by the outstanding commitment (a booking cannot have more units
   * off the shelf than it still owes).
   */
  const physicallyOut = Math.min(
    poolActive,
    Math.max(0, scannedOut - disposedOnActiveBookings)
  );

  return {
    // Everything committed but not physically out: RESERVED bookings plus the
    // active bookings' booked-but-not-yet-scanned-out remainder.
    reserved: poolReserved + (poolActive - physicallyOut),
    checkedOut: physicallyOut,
  };
}
