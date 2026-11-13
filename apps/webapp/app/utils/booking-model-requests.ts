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
 * Whether more units can still be matched to physical assets on this booking.
 *
 * `true` only while the booking is live. On COMPLETE / CANCELLED / ARCHIVED
 * nothing further will ever be assigned, so leftover reservations stop being
 * outstanding WORK and become a historical fact.
 *
 * That distinction has to reach the UI or the signals lie: a cancelled booking
 * was carrying an amber "4 units unassigned" flag in the bookings list and
 * "4 of 5 units still to assign" on its page. Both invite action on a booking
 * nobody can act on, and the flag is noise in the one list operators use to
 * decide what needs attention.
 *
 * Mirrors the status gate in `ModelRequestRowActionsDropdown`, which already
 * hides the per-row actions on these statuses; this simply makes the
 * surrounding copy and emphasis agree with it.
 *
 * @param status - The booking's status.
 * @returns `true` when units can still be assigned.
 */
export function canAssignModelUnits(status: string): boolean {
  return (
    status === "DRAFT" ||
    status === "RESERVED" ||
    status === "ONGOING" ||
    status === "OVERDUE"
  );
}

/**
 * Whether the reserved quantity itself can still be changed on this booking.
 *
 * The same live-booking window as {@link canAssignModelUnits}, and that is the
 * point: a reservation an operator can still fulfil is one they must also be
 * able to correct. A booking that is already out is exactly when they find out
 * a unit is damaged, lost, or was never collected — and until the reservation
 * is reduced it keeps holding those units against every other booking whose
 * window overlaps.
 *
 * Status is the only thing this answers. Two further limits live on the server
 * and apply at every status: the quantity can never drop below the units
 * already assigned, and a reservation with assigned units is reduced rather
 * than cancelled (deleting it would orphan the assets it explains).
 *
 * The two predicates must move together — see
 * `upsertBookingModelRequest` / `removeBookingModelRequest`, which enforce it.
 *
 * @param status - The booking's status.
 * @returns `true` when the reservation can still be adjusted or cancelled.
 */
export function canEditModelReservations(status: string): boolean {
  return canAssignModelUnits(status);
}

/**
 * Whether a reservation can be cancelled outright, rather than reduced.
 *
 * Only while nothing has been assigned to it. Once a unit is on the booking
 * the row is the record of how it got there, and deleting it strips that
 * asset's `bookingModelRequestId` through the FK's `ON DELETE SET NULL`. The
 * server refuses such a cancellation, so a surface that offers the control
 * anyway is handing the operator a button that always fails — the route that
 * works is reducing the quantity to the assigned count, which releases
 * everything still unassigned.
 *
 * Every surface showing a cancel control asks here. The rule was previously
 * spelled out inline on one surface and missing on two others, which is the
 * drift this exists to stop.
 *
 * @param request - The reservation, or its assigned-unit count.
 * @returns `true` when cancelling is still possible.
 */
export function canCancelModelReservation(request: {
  fulfilledQuantity: number;
}): boolean {
  return request.fulfilledQuantity === 0;
}

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

/**
 * What a booking's reservation of one model is measured against, as the Models
 * tab receives it.
 */
export type ReservationPool = {
  /**
   * Units of the model free over the window with this booking left out of the
   * pool, clamped at zero.
   */
  available: number;
  /**
   * Units of the model this booking holds by name that no custodian holds.
   * They take from the same pool as the reservation's unassigned units.
   */
  namedNotInCustody: number;
};

/**
 * The most units this booking's reservation of a model may be, mirroring the
 * check `upsertBookingModelRequest` runs: the units it holds by name plus the
 * reservation's unassigned units must fit in `available`. Fulfilled units are
 * named units already, so they are added back.
 *
 * May be zero or negative when the booking already holds more by name than
 * the pool leaves; callers clamp before showing it.
 *
 * @param pool - The model's availability for this booking.
 * @param fulfilled - Units of the reservation already assigned (0 for a new one).
 * @returns The highest reservation quantity the server accepts as an increase.
 */
export function getReservationCeiling(
  pool: ReservationPool,
  fulfilled: number
): number {
  return pool.available - pool.namedNotInCustody + fulfilled;
}

/**
 * Whether a booking's reservation of a model is more than the pool can give it
 * over the window: the state the "Over-reserved" badge shows.
 *
 * Reservations are a read-then-decide, so two operators reserving at once can
 * both be told there is room and both commit; the pool then owes more than it
 * holds and somebody arrives to an empty shelf.
 *
 * @param pool - The model's availability for this booking.
 * @param reservation - The reservation's quantity and assigned units.
 * @returns `true` when the reservation exceeds its ceiling.
 */
export function isReservationOverCommitted(
  pool: ReservationPool,
  reservation: { quantity: number; fulfilled: number }
): boolean {
  return (
    reservation.quantity > getReservationCeiling(pool, reservation.fulfilled)
  );
}

/** The bounds a model reservation's quantity is judged against. */
export type ModelRequestQuantityBounds = {
  /**
   * Units already matched to a concrete asset. The reservation can never go
   * below this: those assets are on the booking already.
   */
  floor: number;
  /**
   * Units this booking may climb to, from {@link getReservationCeiling}.
   * `null` when the pool is unknown. May be zero or negative when the pool
   * has nothing left for this booking.
   */
  capacity: number | null;
  /** The reservation's stored quantity, which a change is measured against. */
  current: number;
  /** Units of the model in the workspace, for the message. */
  total: number | null;
};

/**
 * The reason a quantity is not allowed on an existing model reservation, or
 * `null` when it is.
 *
 * Mirrors the two bounds `upsertBookingModelRequest` enforces, in its order —
 * the floor first, because it is the one the server applies unconditionally.
 *
 * **A reduction is exempt from the capacity bound**, and the exemption is the
 * point rather than a convenience: a reduction hands units back, so nothing
 * about the pool can refuse it, and measuring anyway fails in the one case that
 * matters most. When other bookings owe more than the pool holds, the capacity
 * is zero or negative, so capping would reject every quantity the floor allows
 * — while "Over-reserved" asks the operator to reduce, and Remove is
 * unavailable once a unit is assigned. The server skips its own availability
 * guard on a reduction for exactly this reason; a client that caps them
 * contradicts it and strands the operator.
 *
 * @param quantity - The quantity being proposed.
 * @param bounds - The floor, the capacity, the stored quantity and the total.
 * @returns The message to show, or `null` when the quantity is allowed.
 */
export function getModelRequestQuantityIssue(
  quantity: number,
  bounds: ModelRequestQuantityBounds
): string | null {
  const { floor, capacity, current, total } = bounds;

  if (floor > 0 && quantity < floor) {
    return `${floor} ${
      floor === 1 ? "unit is" : "units are"
    } already assigned — ${floor} is the lowest this can go.`;
  }

  // Nothing to measure against, or not an increase.
  if (capacity == null || quantity <= current) {
    return null;
  }

  if (quantity > capacity) {
    // Clamped: a negative remainder is a real state of the pool, but "Only -2
    // available" is not a sentence to show anyone.
    return `Only ${Math.max(
      0,
      capacity
    )} of ${total} available in this window — reduce the quantity to continue.`;
  }

  return null;
}

/** Reserved units of one model that no asset has been assigned to yet. */
export type UnassignedModelUnits = {
  /** The asset model's name. */
  name: string;
  /** Units of this model still unassigned. */
  count: number;
};

/**
 * Names the reserved units still unassigned, in one line an operator can read
 * before confirming a check-out: "2 × Dell Latitude, 1 × HP LaserJet and
 * 3 × Pelican case".
 *
 * A booking can reserve dozens of models, so the line names at most `limit` of
 * them and counts the rest ("… and 5 more models"). Models with nothing
 * unassigned are left out.
 *
 * @param units - Unassigned units per model, in display order.
 * @param limit - Most models to name before counting the rest.
 * @returns The summary, or an empty string when nothing is unassigned.
 */
export function summarizeUnassignedUnits(
  units: UnassignedModelUnits[],
  limit = 5
): string {
  const open = units.filter((unit) => unit.count > 0);
  const named = open
    .slice(0, limit)
    .map((unit) => `${unit.count} × ${unit.name}`);
  const rest = open.length - named.length;
  const parts =
    rest > 0 ? [...named, `${rest} more model${rest === 1 ? "" : "s"}`] : named;

  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * URL parameter holding the Models tab's search text on the booking
 * manage-assets / manage-kits dialogs. Separate from the asset list's `s` so
 * searching one tab never filters the other.
 */
export const MODEL_TAB_SEARCH_PARAM = "modelSearch";

/** URL parameter holding the Models tab's 1-based page. See above. */
export const MODEL_TAB_PAGE_PARAM = "modelPage";

/**
 * URL parameter that, set to `"true"`, lists models with no bookable asset on
 * the Models tab. They are hidden by default: nothing can be reserved from
 * them, and an inventory moving to models carries many empty ones.
 */
export const MODEL_TAB_SHOW_EMPTY_PARAM = "showEmptyModels";

/**
 * Reads the Models tab's search, page and empty-model toggle from the request
 * URL, in the shape `getBookingModelTabData` takes.
 *
 * @param searchParams - The request's search params.
 * @returns `search` (trimmed, omitted when blank), `page` (omitted unless a
 *   whole number above 1) and `showModelsWithoutAssets` (false unless the
 *   toggle is on).
 */
export function readModelTabParams(searchParams: URLSearchParams): {
  search?: string;
  page?: number;
  showModelsWithoutAssets: boolean;
} {
  const search = searchParams.get(MODEL_TAB_SEARCH_PARAM)?.trim();
  const page = Number(searchParams.get(MODEL_TAB_PAGE_PARAM));
  return {
    ...(search ? { search } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    showModelsWithoutAssets:
      searchParams.get(MODEL_TAB_SHOW_EMPTY_PARAM) === "true",
  };
}
