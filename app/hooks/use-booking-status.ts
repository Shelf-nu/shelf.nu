import { useMemo } from "react";
import { BookingStatus } from "@prisma/client";

export function useBookingStatusHelpers(status: BookingStatus | undefined) {
  // Handle undefined case at the beginning
  const statusChecks = useMemo(() => {
    // If status is undefined, return all flags as false
    if (status === undefined) {
      return {
        isDraft: false,
        isReserved: false,
        isOngoing: false,
        isCompleted: false,
        isArchived: false,
        isOverdue: false,
        isCancelled: false,
      };
    }

    // If status is defined, return each flag according to the status
    return {
      isDraft: status === BookingStatus.DRAFT,
      isReserved: status === BookingStatus.RESERVED,
      isOngoing: status === BookingStatus.ONGOING,
      isCompleted: status === BookingStatus.COMPLETE,
      isArchived: status === BookingStatus.ARCHIVED,
      isOverdue: status === BookingStatus.OVERDUE,
      isCancelled: status === BookingStatus.CANCELLED,
      isInProgress:
        status === BookingStatus.ONGOING || status === BookingStatus.OVERDUE,
    };
  }, [status]);

  return statusChecks;
}
