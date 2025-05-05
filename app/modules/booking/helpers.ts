import { addMinutes, isAfter, isBefore, subMinutes } from "date-fns";

/**
 * This function checks if the booking is being early checkout.
 * It only considers it early if it's more than 15 minutes before the booking start time.
 */
export function isBookingEarlyCheckout(from: string | Date): boolean {
  const now = new Date();
  const fromWithBuffer = subMinutes(from, 15);
  return isAfter(fromWithBuffer, now);
}

/**
 * This function checks if the booking is being early checkin.
 * It only considers it early if it's more than 15 minutes before the booking end time.
 */
export function isBookingEarlyCheckin(to: string | Date) {
  const nowWithBuffer = addMinutes(new Date(), 15);
  return isBefore(nowWithBuffer, to);
}
