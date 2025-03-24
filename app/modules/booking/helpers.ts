import { isAfter, isSameDay } from "date-fns";

/**
 * This function checks if the booking is being early checkout
 */
export function isBookingEarlyCheckout(from: string | Date): boolean {
  const now = new Date();

  /** If the booking is for today, it's not early checkout */
  if (isSameDay(from, now)) {
    return false;
  }

  return isAfter(from, now);
}

/**
 * This function checks if the booking is being early checkin
 */
export function isBookingEarlyCheckin(to: string | Date) {
  const now = new Date();

  /** If the booking is ending today, it's not early checkin */
  if (isSameDay(to, now)) {
    return false;
  }

  return isAfter(to, now);
}
