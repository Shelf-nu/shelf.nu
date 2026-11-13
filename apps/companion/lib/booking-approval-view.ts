import type { BookingDetail } from "./api/types";

/** What the booking screen shows for a reservation request. */
export type BookingApprovalView = {
  /** The request waits for a decision: show the Pending approval pill. */
  isPending: boolean;
  /** This caller may decide it, which also lets their check-out approve it. */
  canApprove: boolean;
  /**
   * Offer "Approve request": the caller may decide it and its end date has
   * not passed (the server refuses to approve a request that has ended).
   */
  showApprove: boolean;
  /** Reserving this draft sends a request: word Reserve as a request. */
  reservationIsRequest: boolean;
  /**
   * Check-out may be offered: a pending request goes out only through someone
   * who may approve it (their check-out approves it), as on the web.
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
    mayCheckOutNow: !isPending || canApprove,
  };
}
