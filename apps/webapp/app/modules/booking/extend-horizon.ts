/**
 * Client-side helpers for the Change end date dialog: the latest end worth
 * suggesting before the first clash, and the typed read of a refusal's
 * payload.
 *
 * Pure and zone-explicit: every wall-clock decision names the zone it is
 * made in, which is the acting user's resolved preference zone, the same one
 * the server parses the submitted end in.
 *
 * @see {@link file://../../components/booking/extend-booking-dialog.tsx}
 * @see {@link file://./next-reservations.server.ts}
 */
import {
  addDaysInZone,
  instantFromWallClockInZone,
  wallClockPartsInZone,
} from "~/utils/date-format";
import type { ClashingBooking } from "./clashing-bookings";

/**
 * The latest end to suggest when the next reservation starts at
 * `clashStart`: the booking's own end time of day, on the last calendar day
 * that keeps the end strictly before the clash.
 *
 * Keeping the booking's usual end time, rather than "one minute before the
 * clash", gives a time the workspace already accepted once, so working-hours
 * checks are unlikely to refuse it.
 *
 * @param currentEnd - The booking's current end (an instant)
 * @param clashStart - The first reservation's start (an instant)
 * @param timeZone - The zone the end time of day is read and written in
 * @param now - The current instant; an end at or before it cannot be
 * submitted (an overdue booking's end is already in the past)
 * @returns The suggested end, or `null` when no such end is later than both
 * the current end and now (the clash starts too soon to add a whole day)
 */
export function suggestEndBeforeClash({
  currentEnd,
  clashStart,
  timeZone,
  now = new Date(),
}: {
  currentEnd: Date;
  clashStart: Date;
  timeZone: string;
  now?: Date;
}): Date | null {
  const endClock = wallClockPartsInZone(currentEnd, timeZone);
  const clashDay = wallClockPartsInZone(clashStart, timeZone);
  let candidate = instantFromWallClockInZone(
    { ...clashDay, hour: endClock.hour, minute: endClock.minute },
    timeZone
  );
  if (candidate >= clashStart) {
    candidate = addDaysInZone(candidate, -1, timeZone);
  }
  return candidate > currentEnd && candidate > now ? candidate : null;
}

/** What an extend refusal carries about the bookings in the way. */
export type ClashRefusal = {
  clashingBookings: ClashingBooking[];
  freeUntil: string | null;
};

/**
 * Read the clash payload off an error's `additionalData`, tolerating any
 * shape: a refusal for another reason carries none.
 *
 * @param additionalData - The error's additional data, as the client sees it
 * @returns The typed payload, or `null` when it names no clashing bookings
 */
export function readClashRefusal(additionalData: unknown): ClashRefusal | null {
  if (typeof additionalData !== "object" || additionalData === null) {
    return null;
  }
  const { clashingBookings, freeUntil } = additionalData as {
    clashingBookings?: unknown;
    freeUntil?: unknown;
  };
  if (!Array.isArray(clashingBookings) || clashingBookings.length === 0) {
    return null;
  }
  const bookings = clashingBookings.flatMap((b: unknown) => {
    if (typeof b !== "object" || b === null) return [];
    const row = b as Partial<ClashingBooking>;
    if (typeof row.name !== "string") return [];
    return [
      {
        id: typeof row.id === "string" ? row.id : null,
        name: row.name,
        from: typeof row.from === "string" ? row.from : "",
        items: Array.isArray(row.items)
          ? row.items.filter(
              (item): item is ClashingBooking["items"][number] =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as { name?: unknown }).name === "string"
            )
          : [],
      },
    ];
  });
  if (bookings.length === 0) return null;
  return {
    clashingBookings: bookings,
    freeUntil: typeof freeUntil === "string" ? freeUntil : null,
  };
}
