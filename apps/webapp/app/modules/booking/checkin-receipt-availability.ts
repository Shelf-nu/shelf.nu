/**
 * The enabled rule of the booking check-in receipt.
 *
 * Pure and dependency-light so the booking page (client), the bookings list
 * loader (server) and the receipt entry all decide "can this booking print a
 * receipt" with the same function.
 *
 * @see {@link file://./../../components/booking/booking-checkin-receipt-pdf.tsx}
 * @see {@link file://./list-flags.server.ts}
 */
import { BookingStatus } from "@prisma/client";

/**
 * Whether a booking has anything for a check-in receipt to state.
 *
 * A finished booking always has something to state, even if some rows never
 * went out. Before that, a single reconciled slice is enough: a partial return
 * is exactly the case a printed record is wanted for.
 *
 * Nothing is recorded until something has left: a booking archived straight
 * from reserved is finished and has no check-out marker on any slice, and a
 * receipt for it would be a return document over rows that never moved.
 * Past that, anything reconciled is enough. `checkedInAt` alone would miss a
 * quantity slice returned in part (it stays NULL), so the units it sent back
 * count too, through `hasDispositionedUnits`.
 *
 * @param args.status - The booking's status
 * @param args.bookingAssets - The booking's slices. Only the two markers are
 *   read; they may arrive as ISO strings, so they are compared against `null`
 *   rather than treated as dates.
 * @param args.hasDispositionedUnits - Whether any booked unit has been
 *   accounted for (any disposition log exists)
 * @returns `true` when the receipt can be generated
 */
export function isCheckinReceiptAvailable({
  status,
  bookingAssets,
  hasDispositionedUnits,
}: {
  status: BookingStatus;
  bookingAssets: Array<{
    checkedOutAt: string | Date | null;
    checkedInAt: string | Date | null;
  }>;
  hasDispositionedUnits: boolean;
}): boolean {
  const hasCheckedInSlice = bookingAssets.some((ba) => ba.checkedInAt != null);
  const hasCheckedOutSlice = bookingAssets.some(
    (ba) => ba.checkedOutAt != null
  );
  const isFinished =
    status === BookingStatus.COMPLETE || status === BookingStatus.ARCHIVED;
  return (
    hasCheckedOutSlice &&
    (isFinished || hasCheckedInSlice || hasDispositionedUnits)
  );
}
