/**
 * How the app tells the server a booking check-in or check-out was made.
 *
 * The server cannot tell a scan from a tick on the partial check-in, partial
 * check-out and fulfil-and-check-out routes, so the app says so with every
 * request: the Scan tab sends `scanned`, the booking screen's Select paths send
 * `selected`. The server records the value on the booking's activity events
 * and prints it on the check-in receipt, and records `null` when a request
 * carries no method rather than guessing one. The quick "Check Out All" and
 * "Check In All" taps declare nothing; the server knows those routes are the
 * one-tap actions.
 *
 * Pure, so the request bodies can be tested under Node without Expo.
 *
 * @see ../../webapp/app/modules/booking/checkout-method.ts the server's side
 */

/** The two methods the app can declare. */
export const BOOKING_METHOD = Object.freeze({
  /** The row went through the Scan tab (camera or typed code). */
  scanned: "scanned",
  /** The row was ticked in a list on the booking screen. */
  selected: "selected",
});

/** A method the app declares on a check-in or check-out request. */
export type BookingMethod =
  (typeof BOOKING_METHOD)[keyof typeof BOOKING_METHOD];

/**
 * Adds the declared method to a request body, when there is one.
 *
 * Kept as a spread rather than `method: undefined` so an undeclared method is
 * absent from the JSON the server receives, exactly like a bundle that predates
 * the field.
 *
 * @param body - The request body without a method
 * @param method - What the app knows about how the rows were collected
 * @returns The body, with `method` when one was declared
 */
export function withBookingMethod<T extends object>(
  body: T,
  method: BookingMethod | undefined
): T | (T & { method: BookingMethod }) {
  return method ? { ...body, method } : body;
}
