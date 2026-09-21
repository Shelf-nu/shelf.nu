/**
 * Bounds for editing a booking's model-level reservation.
 *
 * A `BookingModelRequest` promises N units of an asset model without naming
 * which ones. Two limits apply whenever that number is edited, and they are
 * the same limits the server enforces in `upsertBookingModelRequest`:
 *
 *  - it cannot climb past what the pool still has free for the booking's
 *    window, plus the units this booking already holds by name;
 *  - it cannot drop below the units already assigned to the booking. Those
 *    are real assets sitting on it; a smaller reservation would promise fewer
 *    units than the booking is already holding.
 *
 * Setting the quantity to exactly the assigned count is the operator's way to
 * hand back units that were damaged or never collected: everything still
 * unassigned goes straight back to the pool and the reservation closes.
 *
 * MIRROR of the web bounds in
 * `apps/webapp/app/components/booking/adjust-model-reservation-dialog.tsx`
 * and `manage-model-requests.tsx`. Cosmetic only — the server owns the pool
 * and refuses anything outside these bounds regardless of what the client
 * sends. Extraction target: a pure `packages/*` booking module (none yet).
 *
 * @see {@link file://./../app/(tabs)/bookings/add-assets.tsx} — the Models tab
 */

/** How far a reservation may be moved, inclusive at both ends. */
export type ModelReservationBounds = {
  /** Lowest acceptable quantity. Never below 1 — a reservation holds units. */
  min: number;
  /** Highest acceptable quantity for this booking's window. */
  max: number;
};

/** One model's pool position on the booking being edited. */
export type ModelReservationInput = {
  /**
   * Units of this model still free for the booking's window. Already excludes
   * this booking's own reservation.
   */
  available: number;
  /** Units of this reservation already matched to a concrete asset. */
  fulfilledQuantity?: number;
};

/**
 * Computes the range a reservation's quantity may be set to.
 *
 * @param input - See {@link ModelReservationInput}.
 * @returns The inclusive `{ min, max }` range.
 */
export function modelReservationBounds({
  available,
  fulfilledQuantity = 0,
}: ModelReservationInput): ModelReservationBounds {
  const assigned = Math.max(0, fulfilledQuantity);

  return {
    // Assigned units are already this booking's, so they are headroom the
    // free pool does not have to supply.
    max: Math.max(0, available) + assigned,
    // A reservation always holds at least one unit; releasing the last one is
    // a cancellation, which is a separate action.
    min: Math.max(1, assigned),
  };
}
