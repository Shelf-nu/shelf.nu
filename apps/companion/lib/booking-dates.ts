/**
 * Pure date rules shared by the booking create and edit forms.
 *
 * Both screens drive their pickers in the acting user's preference zone and
 * hold real instants, so any rule about how one picked date constrains another
 * belongs here rather than in either screen — a rule that lives in two places
 * gets fixed in one.
 *
 * Runs under Node's test runner via tsx, so this module must not import React
 * Native, Expo, or `@/`-aliased paths.
 *
 * @see {@link file://./booking-dates.test.ts}
 * @see {@link file://../app/(tabs)/bookings/new.tsx}
 * @see {@link file://../app/(tabs)/bookings/edit.tsx}
 */
import { addDaysInZone } from "@shelf/datetime";

/**
 * Keep a booking's end after its start, moving it out a day when it is not.
 *
 * Called when the user picks a new start: an end at or before it is no longer a
 * valid window, so it moves to the same clock on the next calendar day. That is
 * a CALENDAR day in `timeZone`, not a fixed 24 hours — across a DST boundary the
 * day is 23 or 25 hours long, and adding elapsed time there moves the clock the
 * user chose.
 *
 * A `null` end is left alone: the form has its own "required" handling, and
 * inventing a value here would mask an empty field as a filled one.
 *
 * @param end - the current end instant, or null when unset
 * @param start - the newly picked start instant
 * @param timeZone - the acting user's preference zone, whose calendar days count
 * @returns the unchanged end when it is already after `start`, else the
 *   next-day instant; `null` stays `null`
 */
export function keepEndAfterStart(
  end: Date | null,
  start: Date,
  timeZone: string
): Date | null {
  if (!end || end > start) return end;
  return addDaysInZone(start, 1, timeZone);
}
