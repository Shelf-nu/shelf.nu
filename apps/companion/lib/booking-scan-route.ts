/**
 * The booking scanner's route: where a booking's "Scan to ..." buttons go, and
 * how that screen reads which booking and which flow it serves.
 *
 * Booking scanning is its own screen in the Bookings stack
 * (`app/(tabs)/bookings/scan.tsx`), pushed on top of the booking. The Scan tab
 * (`app/(tabs)/scanner.tsx`) is always the plain scanner and reads no route
 * params: a tab screen keeps the params it was last opened with, so a booking
 * context passed to the tab would still be there the next time someone taps
 * Scan in the tab bar.
 *
 * Pure and free of React Native, Expo and `@/` paths so it runs under Node's
 * test runner.
 *
 * @see {@link file://./booking-scan-route.test.ts}
 * @see {@link file://../app/(tabs)/bookings/scan.tsx} the booking scanner
 * @see {@link file://../app/(tabs)/scanner.tsx} the scanner both screens render
 */

/**
 * Which booking flow the booking scanner serves.
 *
 * - `checkin`: scan assets on the booking to check them in
 * - `checkout`: scan assets on the booking to check them out, a batch at a time
 * - `add`: scan assets and kits to add them to the booking
 * - `fulfil`: scan units of the reserved models, then assign and check out
 */
export type BookingScanAction = "checkin" | "checkout" | "add" | "fulfil";

/** The booking a scanner screen serves, or null for the plain Scan tab. */
export type BookingScanContext = {
  bookingId: string;
  /** Shown in the scanner header; empty when the link carried no name. */
  bookingName: string;
  action: BookingScanAction;
};

/** Route pattern of the booking scanner, the route file's path under `app/`. */
export const BOOKING_SCAN_PATHNAME = "/(tabs)/bookings/scan";

const ACTIONS: readonly BookingScanAction[] = [
  "checkin",
  "checkout",
  "add",
  "fulfil",
];

/**
 * The href that opens the booking scanner for a booking, for `router.push`
 * from the booking screen (same stack, so back returns to the booking).
 *
 * @param booking - the booking's id and name
 * @param action - the flow to scan for
 * @returns an object href that expo-router encodes, name included
 */
export function bookingScanHref(
  booking: { id: string; name: string },
  action: BookingScanAction
) {
  return {
    pathname: BOOKING_SCAN_PATHNAME,
    params: {
      bookingId: booking.id,
      bookingName: booking.name,
      bookingAction: action,
    },
  } as const;
}

/** A route param as expo-router hands it over: absent, one value or repeated. */
type RouteParam = string | string[] | undefined;

/** The first value of a route param, or undefined. */
function firstValue(param: RouteParam): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

/**
 * Reads the booking scanner's route params.
 *
 * @param params - `bookingId`, `bookingName` and `bookingAction` from the route
 * @returns the booking context, or null without a booking id (the screen then
 *   has no booking to scan for). A missing or unknown action is `checkin`.
 */
export function parseBookingScanParams(params: {
  bookingId?: RouteParam;
  bookingName?: RouteParam;
  bookingAction?: RouteParam;
}): BookingScanContext | null {
  const bookingId = firstValue(params.bookingId)?.trim();
  if (!bookingId) return null;

  const rawAction = firstValue(params.bookingAction);
  const action = ACTIONS.find((a) => a === rawAction) ?? "checkin";

  return {
    bookingId,
    bookingName: firstValue(params.bookingName) ?? "",
    action,
  };
}
