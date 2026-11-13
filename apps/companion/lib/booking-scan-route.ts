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
 * from the booking screen (same stack, so back returns to the booking). It
 * carries no name: the scanner shows the name the server returns.
 *
 * @param booking - the booking to scan for
 * @param action - the flow to scan for
 * @returns an object href that expo-router encodes
 */
export function bookingScanHref(
  booking: { id: string },
  action: BookingScanAction
) {
  return {
    pathname: BOOKING_SCAN_PATHNAME,
    params: { bookingId: booking.id, bookingAction: action },
  } as const;
}

/** Route name of the booking detail screen in the Bookings stack. */
export const BOOKING_DETAIL_ROUTE_NAME = "[id]";

/** A route in a stack's navigation state: what this module reads of it. */
export type StackRoute = {
  key: string;
  name: string;
  params?: object;
};

/**
 * Whether the booking scanner sits directly on the booking it scans for.
 *
 * The booking screen is the only way in: it pushes the scanner on top of
 * itself. Back and every finished flow then go back one screen, so that
 * screen must be this booking. A scanner reached any other
 * way (a link, a stack restored without its booking) opens the booking
 * instead, and never shows a booking name that came from the link.
 *
 * @param routes - the Bookings stack's routes, bottom first
 * @param ownKey - the booking scanner's own route key, which `routes` may not
 *   list yet
 * @param bookingId - the booking the scanner was opened for
 * @returns true when the route right below the scanner is that booking
 */
export function sitsOnItsBooking(
  routes: readonly StackRoute[],
  ownKey: string,
  bookingId: string
): boolean {
  const index = routes.findIndex((route) => route.key === ownKey);
  // The pushed screen renders once before the stack lists it, while the push
  // is still in flight: then the route below it is the stack's current top.
  const below = index === -1 ? routes[routes.length - 1] : routes[index - 1];
  if (below?.name !== BOOKING_DETAIL_ROUTE_NAME) return false;
  const params = below.params as { id?: unknown } | undefined;
  return params?.id === bookingId;
}

/**
 * What leaving the booking scanner does (back arrow, back swipe, Android
 * back), as `useDiscardGuard` decides it.
 *
 * - A booking request still waiting for its answer holds the scanner in
 *   place: its success alert goes back to the booking, which is only right
 *   while the scanner is still on top of it.
 * - Scans not sent yet ask "Discard?" first.
 * - Otherwise the scanner leaves.
 *
 * @param state - whether a request is pending and how many rows are listed
 * @returns `hold`, `prompt` or `leave`
 */
export function bookingScanLeaveDecision(
  state: BookingScanLeaveState
): "hold" | "prompt" | "leave" {
  if (state.submitting) return "hold";
  return state.itemCount > 0 ? "prompt" : "leave";
}

/** What the leave guard reads at the moment someone tries to leave. */
export type BookingScanLeaveState = {
  /** A booking request is waiting for its answer. */
  submitting: boolean;
  /** Rows in the scan list, not yet sent to the booking. */
  itemCount: number;
};

/**
 * Navigation actions a person starts to leave the scanner: the back arrow
 * and Android back (`GO_BACK`), the back swipe (`POP`), and a re-tap on the
 * Bookings tab (`POP_TO_TOP`). The guard stops only these. Removals the app
 * starts (the sign-in redirect when a session ends, a push notification
 * opening another screen) pass, even while a request is pending: its later
 * `goBack()` names the scanner's own route, which is gone, so it does
 * nothing.
 */
export const BOOKING_SCAN_BACK_ACTIONS: readonly string[] = Object.freeze([
  "GO_BACK",
  "POP",
  "POP_TO_TOP",
]);

/**
 * The booking scanner's leave guard, as `useDiscardGuard` takes it (all but
 * `active`).
 *
 * @param readLeaveState - reads the current leave state when someone leaves
 * @returns the decision, the discard prompt, the notice for a held leave and
 *   the actions the guard stops
 */
export function bookingScanGuard(readLeaveState: () => BookingScanLeaveState) {
  return {
    decide: () => bookingScanLeaveDecision(readLeaveState()),
    title: "Discard scanned items?",
    message:
      "Nothing you scanned has been sent to the booking yet. Leaving the scanner discards the list.",
    holdNotice: {
      title: "Still sending",
      message:
        "Your scans are still being sent to the booking. Wait for it to finish.",
    },
    guardedActions: BOOKING_SCAN_BACK_ACTIONS,
  };
}

/** What the booking scanner route renders. */
export type BookingScanScreenDecision =
  | { kind: "list" }
  | { kind: "booking"; bookingId: string }
  | { kind: "scan"; booking: BookingScanContext };

/**
 * What the booking scanner route shows for its params and place in the stack.
 *
 * - No booking id: the bookings list.
 * - Not directly on its own booking (a link, a double tap): that booking.
 * - Otherwise: the scanner for the booking and flow.
 *
 * @param args - the route params, the Bookings stack's routes and the
 *   scanner's own route key
 * @returns which of the three the route renders
 */
export function bookingScanScreenDecision(args: {
  params: { bookingId?: RouteParam; bookingAction?: RouteParam };
  routes: readonly StackRoute[];
  ownKey: string;
}): BookingScanScreenDecision {
  const booking = parseBookingScanParams(args.params);
  if (!booking) return { kind: "list" };
  if (!sitsOnItsBooking(args.routes, args.ownKey, booking.bookingId)) {
    return { kind: "booking", bookingId: booking.bookingId };
  }
  return { kind: "scan", booking };
}

/**
 * Claims the booking screen's "open the scanner" for one push. A second tap
 * before the screen loses focus is ignored, so two fast taps never push two
 * scanners. The booking screen clears the gate when it gains focus again.
 *
 * @param gate - the booking screen's ref; true while a push is in flight
 * @returns true when this tap may push the scanner
 */
export function takeScannerOpening(gate: { current: boolean }): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}

/**
 * The leave state of a flow that has sent its scans: nothing pending, nothing
 * left to lose. A finished flow sets it before it goes back, so leaving never
 * asks to discard scans that are already on the booking.
 */
export const BOOKING_SCAN_SENT: BookingScanLeaveState = Object.freeze({
  submitting: false,
  itemCount: 0,
});

/** A route param as expo-router hands it over: absent, one value or repeated. */
type RouteParam = string | string[] | undefined;

/** The first value of a route param, or undefined. */
function firstValue(param: RouteParam): string | undefined {
  return Array.isArray(param) ? param[0] : param;
}

/**
 * Reads the booking scanner's route params.
 *
 * @param params - `bookingId` and `bookingAction` from the route
 * @returns the booking context, or null without a booking id (the screen then
 *   has no booking to scan for). A missing or unknown action is `checkin`.
 */
export function parseBookingScanParams(params: {
  bookingId?: RouteParam;
  bookingAction?: RouteParam;
}): BookingScanContext | null {
  const bookingId = firstValue(params.bookingId)?.trim();
  if (!bookingId) return null;

  const rawAction = firstValue(params.bookingAction);
  const action = ACTIONS.find((a) => a === rawAction) ?? "checkin";

  return { bookingId, action };
}
