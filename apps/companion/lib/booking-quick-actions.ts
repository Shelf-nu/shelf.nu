/**
 * Booking quick actions.
 *
 * Reads the booking detail endpoint's `canQuickCheckout` flag. The server sends
 * `false` when the workspace requires explicit (scan/select) check-out for the
 * caller's role, and it refuses the one-tap check-out for that role; the
 * booking screen then hides "Check Out All Assets".
 *
 * Servers older than the explicit check-out setting omit the flag. They never
 * refuse the one-tap check-out, so a missing flag means the button stays:
 * reading it as `false` would take a working action away from every user of
 * such a server.
 *
 * This runs under Node's test runner too, so it must not import React Native,
 * Expo, or `@/`-aliased paths.
 *
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} - the booking screen
 */
import type { BookingDetailResponse } from "./api/types";

/**
 * Whether the booking screen may offer the one-tap "Check Out All Assets".
 *
 * @param payload - The booking detail response, from any server version
 * @returns `false` only when the server says the workspace forbids it
 */
export function canOfferQuickCheckout(
  payload: Pick<BookingDetailResponse, "canQuickCheckout">
): boolean {
  return payload.canQuickCheckout ?? true;
}
