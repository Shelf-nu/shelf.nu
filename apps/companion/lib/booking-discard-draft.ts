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

/** What a discard that answered with an error actually did. */
export type DiscardOutcome = "landed" | "not-landed" | "unknown";

/**
 * Reads the outcome of a discard that answered with an error.
 *
 * A request can archive the draft and still fail on the way back (a timeout),
 * so the screen re-reads the booking before reporting a failure. An ARCHIVED
 * booking means the discard went through; any other status means it did not.
 * When the re-read fails as well, usually because the connection dropped, the
 * outcome is unknown and the screen must not claim either.
 *
 * @param reread - The booking as re-read after the error, or `null` when it
 *   could not be re-read
 * @returns Whether the discard landed, did not, or cannot be told
 */
export function discardOutcome(
  reread: { status: string } | null
): DiscardOutcome {
  if (!reread) return "unknown";
  return reread.status === "ARCHIVED" ? "landed" : "not-landed";
}
