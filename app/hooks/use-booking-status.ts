import { useMemo } from "react";
import type { Booking } from "@prisma/client";
import { AssetStatus, BookingStatus } from "@prisma/client";

type BookingSubset = {
  id: Booking["id"];
  status: BookingStatus;
  assets: {
    status: AssetStatus;
    availableToBook: boolean;
    bookings?: { id: Booking["id"]; status: BookingStatus }[];
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

  const hasAlreadyBookedAssets = useMemo(
    () =>
      /** Here we need to check the other bookings belonging to the each asset.
       * If any of the assets has a booking where the id is not the same as the current booking id,
       * then we know that the asset is already booked by another booking.
       * Extra note: the booking needs to have a status different than reserved, ongoing or overdue
       * Important not here is that the asset.bookings have to be queried/filtered based on the same date range as the current booking
       * Check the query for more info
       *
       */

      booking.assets?.some(
        (asset) => asset.bookings && asset?.bookings.length > 0
      ), // Assets are still checked out from another booking
    [booking.assets]
  );

  const hasAssetsInCustody = useMemo(
    () =>
      booking.assets?.some((asset) => asset.status === AssetStatus.IN_CUSTODY), // Assets are in custody
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
    hasAlreadyBookedAssets,
    hasAssetsInCustody,
  };
}
