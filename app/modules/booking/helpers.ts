import { isAfter } from "date-fns";

/**
 * This function checks if the booking is being early checkout
 */
export function isBookingEarlyCheckout(from: string | Date): boolean {
  const now = new Date();
  return isAfter(from, now);
}

/**
 * This function checks if the booking is being early checkin
 */
export function isBookingEarlyCheckin(to: string | Date) {
  const now = new Date();
  return isAfter(to, now);
}
