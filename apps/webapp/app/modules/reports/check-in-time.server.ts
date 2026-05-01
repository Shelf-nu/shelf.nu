/**
 * Booking Check-In Time Resolver
 *
 * Server-only helper that resolves the canonical check-in moment for a batch
 * of bookings. The check-in moment is defined as the time at which a booking
 * transitioned into the `COMPLETE` status — the user-driven "I'm returning
 * the assets" event.
 *
 * Why this exists / why not `booking.updatedAt`:
 * `Booking.updatedAt` is unreliable as a check-in signal because it shifts on
 * any row mutation: edits, the auto-archive job, status flips into
 * `OVERDUE`/`ARCHIVED`, etc. The canonical signal lives in the `ActivityEvent`
 * table — specifically the row written by `createStatusTransitionNote` inside
 * the booking status mutation transaction
 * (see `apps/webapp/app/modules/booking/service.server.ts:264-275`).
 *
 * Lookup contract:
 *   action:  "BOOKING_STATUS_CHANGED"
 *   toValue: "COMPLETE"
 *
 * Legacy-data caveat:
 * The `ActivityEvent` system was introduced on 2026-04-21. Bookings completed
 * before that date have no event — the resolver intentionally returns no
 * entry for them. Callers (e.g. the booking-compliance lateness helper) must
 * treat a missing key as "no signal available" and fall back to a safe
 * default rather than guessing from `booking.updatedAt`.
 *
 * @see {@link file://./helpers.server.ts}
 * @see {@link file://../activity-event/service.server.ts}
 * @see {@link file://../booking/service.server.ts}
 */

import { db } from "~/database/db.server";

/**
 * Resolves the canonical check-in moment for each booking in `bookingIds`.
 *
 * Fires a single batched Prisma query against `ActivityEvent` and returns a
 * `Map<bookingId, Date>` keyed only by bookings that actually have an event.
 * Bookings without an event are intentionally absent from the result — see
 * the file-level legacy-data caveat.
 *
 * If multiple `BOOKING_STATUS_CHANGED → COMPLETE` events exist for the same
 * booking (a rare COMPLETE → OVERDUE → COMPLETE flip), the latest one wins.
 *
 * @param bookingIds - The bookings to resolve check-in times for. Empty
 *   input short-circuits and skips the database round-trip.
 * @returns A `Map` of `bookingId → Date`. Bookings with no recorded event
 *   are absent from the map.
 */
export async function resolveCheckInTimes(
  bookingIds: string[]
): Promise<Map<string, Date>> {
  const result = new Map<string, Date>();

  // Empty input → skip the DB entirely.
  if (bookingIds.length === 0) {
    return result;
  }

  const events = await db.activityEvent.findMany({
    where: {
      action: "BOOKING_STATUS_CHANGED",
      // `toValue` is a Prisma `Json?` column; compare with the JSON-filter
      // `equals` operator rather than a bare string literal so the generated
      // Prisma client types accept the predicate.
      toValue: { equals: "COMPLETE" },
      bookingId: { in: bookingIds },
    },
    select: { bookingId: true, occurredAt: true },
    // Ascending so later events overwrite earlier ones in the loop below —
    // handles the rare COMPLETE → OVERDUE → COMPLETE flip.
    orderBy: { occurredAt: "asc" },
  });

  for (const event of events) {
    // Defensive: `bookingId` is nullable on ActivityEvent. Filtering by
    // `bookingId: { in: ... }` should already exclude nulls, but TS still
    // narrows it as `string | null`, and skipping is the safe behaviour.
    if (!event.bookingId) continue;
    result.set(event.bookingId, event.occurredAt);
  }

  return result;
}
