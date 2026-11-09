/**
 * Booking "Discard draft" rules for the booking detail screen.
 *
 * Discarding a draft archives it (POST /api/mobile/bookings/archive with
 * `discardDraft: true`): it is how members who may not delete a booking drop
 * a draft from their list while the record stays in the workspace history.
 *
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} the screen that offers it
 * @see {@link file://./api/bookings.ts} `discardDraftBooking`
 */
import type { BookingDetailResponse } from "./api/types";

/**
 * Whether the booking screen may offer "Discard draft".
 *
 * @param actions - The detail response's action flags, from any server version
 * @returns `true` only when the server says so; a server without the flag
 *   cannot discard a draft
 */
export function canOfferDiscardDraft(
  actions: Pick<BookingDetailResponse["bookingActions"], "canDiscardDraft">
): boolean {
  return actions.canDiscardDraft === true;
}

/**
 * Whether a discard that answered with an error has nonetheless landed.
 *
 * A request can archive the draft and still fail on the way back (a timeout),
 * so the screen re-reads the booking before reporting a failure. An ARCHIVED
 * booking means the discard went through.
 *
 * @param status - The booking's status as re-read after the error, or
 *   `undefined` when it could not be re-read
 * @returns `true` when the draft is already archived
 */
export function discardLanded(status: string | undefined): boolean {
  return status === "ARCHIVED";
}
