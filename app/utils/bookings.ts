import { BookingStatus, type Booking } from "@prisma/client";

export function canUserManageBookingAssets(
  booking: Pick<Booking, "status"> & {
    from?: string | Date | null; // from is string in case if it is formatted
    to?: string | Date | null; // to is string in case if it is formatted
  },
  isSelfService: boolean
) {
  const isCompleted = booking.status === BookingStatus.COMPLETE;
  const isArchived = booking.status === BookingStatus.ARCHIVED;
  const isCancelled = booking.status === BookingStatus.CANCELLED;

  const cantManageAssetsAsSelfService =
    isSelfService && booking.status === BookingStatus.DRAFT;

  return (
    !!booking.from &&
    !!booking.to &&
    !isCompleted &&
    !isArchived &&
    !isCancelled &&
    !cantManageAssetsAsSelfService
  );
}

export const bookingStatusColorMap: { [key in BookingStatus]: string } = {
  DRAFT: "#667085",
  RESERVED: "#175CD3",
  ONGOING: "#7A5AF8",
  OVERDUE: "#B54708",
  COMPLETE: "#17B26A",
  ARCHIVED: "#667085",
  CANCELLED: "#667085",
};
