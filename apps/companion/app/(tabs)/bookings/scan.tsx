import {
  Redirect,
  useLocalSearchParams,
  useNavigation,
  useRoute,
} from "expo-router";
import { ScannerScreen } from "@/components/scanner/scanner-screen";
import {
  parseBookingScanParams,
  sitsOnItsBooking,
} from "@/lib/booking-scan-route";

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
 * It only runs on top of its own booking (see `sitsOnItsBooking`). Opened any
 * other way, such as from a link, it opens that booking instead; without a
 * booking id, the bookings list.
 *
 * @see {@link file://../../../lib/booking-scan-route.ts} the route and params
 * @returns the scanner for the booking named in the route params
 */
export default function BookingScanScreen() {
  const params = useLocalSearchParams<{
    bookingId?: string;
    bookingAction?: string;
  }>();
  const navigation = useNavigation();
  const route = useRoute();
  const booking = parseBookingScanParams(params);

  if (!booking) return <Redirect href="/(tabs)/bookings" withAnchor />;
  const routes = navigation.getState()?.routes ?? [];
  if (!sitsOnItsBooking(routes, route.key, booking.bookingId)) {
    // Anchored, so the bookings list sits under the booking and back works
    // even when nothing was beneath the scanner.
    return (
      <Redirect href={`/(tabs)/bookings/${booking.bookingId}`} withAnchor />
    );
  }
  return <ScannerScreen booking={booking} />;
}
