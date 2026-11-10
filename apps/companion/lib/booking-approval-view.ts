import type { BookingDetail } from "./api/types";

/** What the booking screen shows for a reservation request. */
export type BookingApprovalView = {
  /** The request waits for a decision: show the Pending approval pill. */
  isPending: boolean;
  /** This caller may decide it: offer "Approve request". */
  canApprove: boolean;
  /** Reserving this draft sends a request: word Reserve as a request. */
  reservationIsRequest: boolean;
};

/**
 * Reads the approval flags the booking detail endpoint sends. Each flag is
 * optional (an older server omits them), and anything but `true` reads as
 * false, so nothing is hidden and nothing is worded as a request by mistake.
 *
 * @param booking - The booking detail payload, or nothing while it loads
 * @returns The approval state the booking screen renders
 */
export function bookingApprovalView(
  booking:
    | Pick<
        BookingDetail,
        "isPendingApproval" | "canApprove" | "reservationNeedsApproval"
      >
    | null
    | undefined
): BookingApprovalView {
  return {
    isPending: booking?.isPendingApproval === true,
    canApprove: booking?.canApprove === true,
    reservationIsRequest: booking?.reservationNeedsApproval === true,
  };
}
