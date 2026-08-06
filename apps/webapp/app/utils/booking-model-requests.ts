/**
 * Booking model-request counting helpers.
 *
 * A `BookingModelRequest` is a reservation against an `AssetModel` rather than
 * a concrete asset: the operator has committed to supplying N units of "PT-DZ21K
 * projector" without yet saying *which* projectors. Units are materialised into
 * real `BookingAsset` rows by scanning, which increments `fulfilledQuantity`;
 * `fulfilledAt` is stamped once the request is fully drained.
 *
 * These helpers exist because the "how much work is left" number was being
 * derived independently on three surfaces (bookings index, booking overview,
 * assets sidebar) and had already drifted between them. Every surface that
 * shows outstanding reservations MUST count through here.
 *
 * **Units, not rows.** One request for 5 projectors is five things somebody has
 * to walk to a shelf and find, so the operator-facing number is units
 * outstanding, not request rows. A request that is partially fulfilled
 * contributes only its remainder.
 *
 * @see {@link file://./../components/booking/unassigned-model-units-pill.tsx}
 * @see {@link file://./../components/booking/booking-assets-sidebar.tsx}
 */

/**
 * Minimal `BookingModelRequest` shape these helpers need.
 *
 * Declared structurally (rather than importing the Prisma type) so callers
 * loading bookings with narrow inline includes can pass their rows straight
 * through without a widening cast — the same reason
 * `SidebarModelRequest` is declared this way.
 */
export type CountableModelRequest = {
  /** Total reserved units (original intent). Does not decrease on scan. */
  quantity: number;
  /** Units already materialised into `BookingAsset` rows via scan. */
  fulfilledQuantity: number;
  /** Set when `fulfilledQuantity === quantity`. `null` means outstanding. */
  fulfilledAt: Date | string | null;
};

/**
 * Filters a booking's model requests down to those with work remaining.
 *
 * Fully-fulfilled rows are history, not active work: they stay in the Models
 * tab of manage-assets as an audit trail but must not appear in any
 * outstanding-work count or list.
 *
 * @param modelRequests - The booking's model requests. Tolerates
 *   `null`/`undefined` so callers whose include omits the relation don't need
 *   their own guard.
 * @returns Only the requests still awaiting assignment.
 */
export function getOutstandingModelRequests<T extends CountableModelRequest>(
  modelRequests: T[] | null | undefined
): T[] {
  return (modelRequests ?? []).filter((req) => req.fulfilledAt === null);
}

/**
 * Counts the physical units across a booking still waiting to be matched to a
 * concrete asset.
 *
 * This is the number the operator acts on: it answers "how many things do I
 * still have to go and find before this booking can leave". It is deliberately
 * NOT the number of request rows — see the module JSDoc.
 *
 * Clamped at zero per request so a data anomaly where `fulfilledQuantity`
 * exceeds `quantity` can't subtract from a sibling request's remainder and
 * under-report the total.
 *
 * @param modelRequests - The booking's model requests (fulfilled rows are
 *   ignored). Tolerates `null`/`undefined`.
 * @returns Total outstanding units. `0` when nothing is awaiting assignment.
 */
export function countUnassignedModelUnits(
  modelRequests: CountableModelRequest[] | null | undefined
): number {
  return getOutstandingModelRequests(modelRequests).reduce(
    (sum, req) => sum + Math.max(0, req.quantity - req.fulfilledQuantity),
    0
  );
}
