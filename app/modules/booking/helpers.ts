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
