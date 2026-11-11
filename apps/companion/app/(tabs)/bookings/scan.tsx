import { Redirect, useLocalSearchParams } from "expo-router";
import { ScannerScreen } from "@/app/(tabs)/scanner";
import { parseBookingScanParams } from "@/lib/booking-scan-route";

/**
 * The booking scanner: the camera scanner serving one booking and flow
 * (check in, check out, add, or fulfil and check out), pushed on top of the
 * booking in the Bookings stack. Back, and every finished flow, return to
 * that booking.
 *
 * It is the same screen as the Scan tab with a booking passed in. Keeping it
 * off the tab keeps the tab a plain scanner: a tab screen keeps the params it
 * was last opened with, so a booking passed to it would still be there the
 * next time someone taps Scan in the tab bar.
 *
 * Without a booking id there is nothing to scan for, so it opens the
 * bookings list instead.
 *
 * @see {@link file://../../../lib/booking-scan-route.ts} the route and params
 * @returns the scanner for the booking named in the route params
 */
export default function BookingScanScreen() {
  const params = useLocalSearchParams<{
    bookingId?: string;
    bookingName?: string;
    bookingAction?: string;
  }>();
  const booking = parseBookingScanParams(params);
  if (!booking) return <Redirect href="/(tabs)/bookings" />;
  return <ScannerScreen booking={booking} />;
}
