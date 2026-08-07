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
 * Two conditions, deliberately:
 *
 *  - `fulfilledAt === null` is the documented completion stamp, and it is what
 *    re-opens a request: `upsertBookingModelRequest` clears it back to null
 *    whenever the new quantity exceeds `fulfilledQuantity`, so a fulfilled
 *    3-unit reservation raised to 5 correctly becomes outstanding again.
 *  - `fulfilledQuantity < quantity` guards the inverse. Nothing should reach
 *    "every unit assigned but no stamp", but if it did, the stamp alone would
 *    let a request with zero remaining units render a "0 units to assign" row
 *    and inflate the model count. Requiring real remaining work makes the
 *    predicate mean what its name says rather than trusting one column.
 *
 * @param modelRequests - The booking's model requests. Tolerates
 *   `null`/`undefined` so callers whose include omits the relation don't need
 *   their own guard.
 * @returns Only the requests still awaiting assignment.
 */
export function getOutstandingModelRequests<T extends CountableModelRequest>(
  modelRequests: T[] | null | undefined
): T[] {
  return (modelRequests ?? []).filter(
    (req) => req.fulfilledAt === null && req.fulfilledQuantity < req.quantity
  );
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

/**
 * Total units RESERVED across the requests that still have work outstanding.
 *
 * This is the denominator for {@link countUnassignedModelUnits}: 4 of 5 units
 * still to assign means five were promised and one has been scanned in.
 *
 * Both numbers have to be shown together. Showing the remainder alone leaves a
 * reader unable to tell whether "3 units" means three promised or three left,
 * and the answer differs per row — which is precisely the ambiguity this
 * module exists to remove.
 *
 * Counts only outstanding requests, so it agrees with the remainder it
 * partners: a fully fulfilled request contributes to neither.
 *
 * @param modelRequests - The booking's model requests. Tolerates
 *   `null`/`undefined`.
 * @returns Total reserved units across outstanding requests.
 */
export function countReservedModelUnits(
  modelRequests: CountableModelRequest[] | null | undefined
): number {
  return getOutstandingModelRequests(modelRequests).reduce(
    (sum, req) => sum + Math.max(0, req.quantity),
    0
  );
}
