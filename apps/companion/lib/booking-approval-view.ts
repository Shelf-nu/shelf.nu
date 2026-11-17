import type { BookingDetail } from "./api/types";

/** What the booking screen shows for a reservation request. */
export type BookingApprovalView = {
  /** The request waits for a decision: show the Pending approval pill. */
  isPending: boolean;
  /** This caller may decide it (Approve request). */
  canApprove: boolean;
  /**
   * Offer "Approve request": the caller may decide it and its end date has
   * not passed (the server refuses to approve a request that has ended).
   */
  showApprove: boolean;
  /** Reserving this draft sends a request: word Reserve as a request. */
  reservationIsRequest: boolean;
  /**
   * Check-out may be offered: never on a pending request, for anyone. It is
   * approved first, then checked out, as on the web.
   */
  mayCheckOutNow: boolean;
};

/**
 * Reads the approval flags the booking detail endpoint sends. Each flag is
 * optional (an older server omits them), and anything but `true` reads as
 * false, so nothing is hidden and nothing is worded as a request by mistake.
 *
 * @param booking - The booking detail payload, or nothing while it loads
 * @param now - The moment to judge the end date against
 * @returns The approval state the booking screen renders
 */
export function bookingApprovalView(
  booking:
    | (Pick<
        BookingDetail,
        "isPendingApproval" | "canApprove" | "reservationNeedsApproval"
      > &
        Partial<Pick<BookingDetail, "to">>)
    | null
    | undefined,
  now: Date = new Date()
): BookingApprovalView {
  const isPending = booking?.isPendingApproval === true;
  const canApprove = booking?.canApprove === true;
  const hasEnded = booking?.to ? new Date(booking.to) < now : false;
  return {
    isPending,
    canApprove,
    showApprove: canApprove && !hasEnded,
    reservationIsRequest: booking?.reservationNeedsApproval === true,
    mayCheckOutNow: !isPending,
  };
}

/** The body of `POST /api/mobile/bookings/approve`. */
export type ApproveBookingBody = {
  bookingId: string;
  /** The request version the screen showed; the server refuses a mismatch. */
  requestVersion: string;
};

/**
 * The approve request for the booking on screen. An approval is checked
 * against the request version the approver saw, and the route requires it,
 * so without a version there is nothing to send.
 *
 * @param booking - The booking detail payload on screen
 * @returns The request body, or `null` when the payload carries no version
 */
export function approveBookingBody(
  booking: Pick<BookingDetail, "id" | "requestVersion">
): ApproveBookingBody | null {
  if (!booking.requestVersion) return null;
  return { bookingId: booking.id, requestVersion: booking.requestVersion };
}
