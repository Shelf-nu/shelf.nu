/**
 * Booking extension rules for the "Extend booking" sheet.
 *
 * Reads the booking detail endpoint's `bookingActions.canExtend` flag, moves a
 * proposed end by the sheet's preset steps, and checks the one rule the sheet
 * can judge before sending: the new end must be after the current end.
 *
 * `newEndError` is a MIRROR of the after-current-end check in
 * `apps/webapp/app/routes/api+/mobile+/bookings.extend.ts`, cosmetic only: it
 * spares a round trip, and the server enforces the rule along with working
 * hours, the booking buffer, the maximum length and clashes, none of which the
 * phone can see. Extraction target: a pure `packages/*` booking module (none
 * yet).
 *
 * This runs under Node's test runner too, so it must not import React Native,
 * Expo, or `@/`-aliased paths.
 *
 * @see {@link file://./../components/bookings/extend-booking-sheet.tsx} - the sheet
 * @see {@link file://./../app/(tabs)/bookings/[id].tsx} - the booking screen
 */
import { addDaysInZone } from "@shelf/datetime";
import type { BookingDetailResponse } from "./api/types";

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
 * Why a proposed end cannot be sent, or `null` when it can.
 *
 * @param newEnd - The end the user picked
 * @param currentEnd - The booking's end now
 * @returns The message to show, or `null`
 */
export function newEndError(newEnd: Date, currentEnd: Date): string | null {
  return newEnd <= currentEnd
    ? "The new end must be after the current end."
    : null;
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
