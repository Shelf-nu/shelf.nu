import { useMemo } from "react";
import type { AssetStatus, Booking } from "@prisma/client";
import { BookingStatus } from "@prisma/client";

type BookingSubset = {
  id: Booking["id"];
  status: BookingStatus;
  assets: {
    status: AssetStatus;
    availableToBook: boolean;
    bookings?: { id: Booking["id"]; status: BookingStatus }[];
  }[];
};

export function useBookingStatusHelpers(booking: BookingSubset) {
  const isDraft = useMemo(
    () => booking.status === BookingStatus.DRAFT,
    [booking.status]
  );
  const isReserved = useMemo(
    () => booking.status === BookingStatus.RESERVED,
    [booking.status]
  );
  const isOngoing = useMemo(
    () => booking.status === BookingStatus.ONGOING,
    [booking.status]
  );
  const isCompleted = useMemo(
    () => booking.status === BookingStatus.COMPLETE,
    [booking.status]
  );
  const isArchived = useMemo(
    () => booking.status === BookingStatus.ARCHIVED,
    [booking.status]
  );

  const isOverdue = useMemo(
    () => booking.status === BookingStatus.OVERDUE,
    [booking.status]
  );

  const isCancelled = useMemo(
    () => booking.status === BookingStatus.CANCELLED,
    [booking.status]
  );

  return {
    isDraft,
    isReserved,
    isOngoing,
    isCompleted,
    isArchived,
    isOverdue,
    isCancelled,
  };
}
