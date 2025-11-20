import { AssetStatus, BookingStatus } from "@prisma/client";
import { addMinutes, isAfter, isBefore, subMinutes } from "date-fns";
import { ONE_DAY, ONE_HOUR } from "~/utils/constants";

/**
 * This function checks if the booking is being early checkout.
 * It only considers it early if it's more than 15 minutes before the booking start time.
 */
export function isBookingEarlyCheckout(from: Date): boolean {
  const now = new Date();
  const fromWithBuffer = subMinutes(from, 15);
  return isAfter(fromWithBuffer, now);
}

/**
 * This function checks if the booking is being early checkin.
 * It only considers it early if it's more than 15 minutes before the booking end time.
 */
export function isBookingEarlyCheckin(to: Date) {
  const nowWithBuffer = addMinutes(new Date(), 15);
  return isBefore(nowWithBuffer, to);
}

// Calculate and format booking duration
export function formatBookingDuration(
  from: Date,
  to: Date
): string {
  const start = new Date(from);
  const end = new Date(to);

  // Calculate duration in milliseconds
  const durationMs = end.getTime() - start.getTime();

  // Convert to days, hours, minutes
  const days = Math.floor(durationMs / ONE_DAY);
  const hours = Math.floor((durationMs % ONE_DAY) / ONE_HOUR);
  const minutes = Math.floor((durationMs % ONE_HOUR) / (1000 * 60));

  // Format the duration string
  let durationStr = "";

  if (days > 0) {
    durationStr += `${days} day${days !== 1 ? "s" : ""}`;
  }

  if (hours > 0) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (minutes > 0 || (days === 0 && hours === 0)) {
    durationStr += durationStr ? " · " : "";
    durationStr += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  return durationStr;
}

/**
 * Core logic for determining if an asset has booking conflicts
 * Used by both isAssetAlreadyBooked and kit-related functions
 */
export function hasAssetBookingConflicts(
  asset: {
    status: string;
    bookings?: { id: string; status: string }[];
  },
  currentBookingId: string
): boolean {
  if (!asset.bookings?.length) return false;

  const conflictingBookings = asset.bookings.filter(
    (b) => b.id !== currentBookingId
  );

  if (conflictingBookings.length === 0) return false;

  // Check if any conflicting booking is RESERVED (always conflicts)
  const hasReservedConflict = conflictingBookings.some(
    (b) => b.status === BookingStatus.RESERVED
  );

  if (hasReservedConflict) return true;

  // For ONGOING/OVERDUE bookings, only conflict if asset is actually CHECKED_OUT
  const hasOngoingConflict = conflictingBookings.some(
    (b) =>
      (b.status === BookingStatus.ONGOING ||
        b.status === BookingStatus.OVERDUE) &&
      asset.status === AssetStatus.CHECKED_OUT
  );

  return hasOngoingConflict;
}

/**
 * Determines if an asset is already booked and unavailable for the current booking context
 * Handles partial check-in logic properly
 */
export function isAssetAlreadyBooked(
  asset: {
    status: string;
    bookings?: { id: string; status: string }[];
  },
  currentBookingId: string
): boolean {
  return hasAssetBookingConflicts(asset, currentBookingId);
}
