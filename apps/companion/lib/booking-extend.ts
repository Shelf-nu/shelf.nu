/**
 * Booking extension rules for the "Extend booking" sheet.
 *
 * Reads the booking detail endpoint's `bookingActions.canExtend` flag, picks
 * where the sheet opens, moves a proposed end by the sheet's preset steps,
 * checks the two rules the sheet can judge before sending (the new end must be
 * after the current end, and in the future), and builds the request body.
 *
 * `newEndError` is cosmetic only. Its future-date rule mirrors the check in
 * `ExtendBookingSchema`
 * (`apps/webapp/app/components/booking/forms/forms-schema.ts`). Its
 * after-current-end rule is the sheet's own: the server's `extendBooking`
 * (`apps/webapp/app/modules/booking/service.server.ts`) also accepts an
 * earlier end, which this sheet does not offer. The server enforces working
 * hours, the booking buffer, the maximum length and clashes, none of which
 * the phone can see.
 * Extraction target: a pure `packages/*` booking module (none yet).
 *
 * This runs under Node's test runner too, so it must not import React Native,
 * Expo, or `@/`-aliased paths.
 *
 * @see {@link file://./../components/bookings/extend-booking-sheet.tsx} - the sheet
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} - the booking screen
 */
import { addDaysInZone, wallClockWireInZone } from "@shelf/datetime";
import type { BookingDetailResponse, ExtendBookingPayload } from "./api/types";

/** The quick steps the sheet offers for moving the end later. */
export type ExtendPreset = "hour" | "fourHours" | "day";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How each preset moves an end. Hours are elapsed time; a day is a calendar
 * day in the zone, so the wall clock stays put across a DST change.
 */
const PRESET_SHIFTS: Record<
  ExtendPreset,
  (base: Date, timeZone: string) => Date
> = {
  hour: (base) => new Date(base.getTime() + HOUR_MS),
  fourHours: (base) => new Date(base.getTime() + 4 * HOUR_MS),
  day: (base, timeZone) => addDaysInZone(base, 1, timeZone),
};

/**
 * Whether the booking screen may offer "Extend booking".
 *
 * @param actions - The detail response's action flags, from any server version
 * @returns `true` only when the server says so; a server without the flag has
 *   no extend endpoint
 */
export function canOfferExtend(
  actions: Pick<BookingDetailResponse["bookingActions"], "canExtend">
): boolean {
  return actions.canExtend === true;
}

/**
 * Where the sheet opens, and the earliest end its picker offers: the booking's
 * current end, or now when that end has already passed (an OVERDUE booking).
 *
 * @param currentEnd - The booking's end now
 * @param now - The current instant
 * @returns The later of the two
 */
export function extendFloor(currentEnd: Date, now: Date): Date {
  return currentEnd > now ? currentEnd : now;
}

/**
 * Why a proposed end cannot be sent, or `null` when it can.
 *
 * @param newEnd - The end the user picked
 * @param currentEnd - The booking's end now
 * @param now - The current instant
 * @returns The message to show, or `null`
 */
export function newEndError(
  newEnd: Date,
  currentEnd: Date,
  now: Date
): string | null {
  if (newEnd <= currentEnd) return "The new end must be after the current end.";
  if (newEnd <= now) return "The new end must be in the future.";
  return null;
}

/**
 * The extend endpoint's request body. The end travels as a wall clock with no
 * offset, decoded on the server in the zone sent beside it.
 *
 * @param bookingId - The booking to extend
 * @param newEnd - The end the user confirmed
 * @param timeZone - The preference zone the sheet's picker edits in
 * @returns The body for `POST /api/mobile/bookings/extend`
 */
export function buildExtendPayload(
  bookingId: string,
  newEnd: Date,
  timeZone: string
): ExtendBookingPayload {
  return {
    bookingId,
    endDate: wallClockWireInZone(newEnd, timeZone),
    timeZone,
  };
}

/**
 * Moves an end later by one of the sheet's presets.
 *
 * @param base - The end to move from
 * @param preset - Which step to take
 * @param timeZone - The zone whose calendar a "day" counts in
 * @returns The moved end
 */
export function shiftEnd(
  base: Date,
  preset: ExtendPreset,
  timeZone: string
): Date {
  return PRESET_SHIFTS[preset](base, timeZone);
}
