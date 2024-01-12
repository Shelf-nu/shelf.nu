import { useMemo } from "react";
import { AssetStatus, BookingStatus } from "@prisma/client";

type BookingSubset = {
  status: BookingStatus;
  assets: {
    status: AssetStatus;
    availableToBook: boolean;
  }[];
};

export function useBookingStatus(booking: BookingSubset) {
  const hasAssets = useMemo(() => booking.assets?.length > 0, [booking.assets]);

  const hasUnavailableAssets = useMemo(
    () => booking.assets?.some((asset) => !asset.availableToBook),
    [booking.assets]
  );

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

  const hasCheckedOutAssets = useMemo(
    () =>
      booking.assets?.some((asset) => asset.status === AssetStatus.CHECKED_OUT), // Assets are still checked out from another booking

    [booking.assets]
  );

  return {
    hasAssets,
    hasUnavailableAssets,
    isDraft,
    isReserved,
    isOngoing,
    isCompleted,
    isArchived,
    isOverdue,
    isCancelled,
    hasCheckedOutAssets,
  };
}
