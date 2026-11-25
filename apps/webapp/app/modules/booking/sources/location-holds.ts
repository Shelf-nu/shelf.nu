/**
 * A pool's line on a location page (pure, no DB access):
 * "8 here · 2 out on bookings · 1 in custody · 3 reserved next".
 *
 * Out on bookings and in custody are now-figures. "Here" is what is on the
 * shelf now: units placed at the location minus both. "Reserved next" is the
 * peak of units still to leave this location for bookings, over the next
 * booking window from now. It is a peak, never a sum: two bookings a week
 * apart that each take 3 units reserve 3, not 6.
 *
 * Only manual placements count. Kit-driven units keep their own display, and
 * the status badge reads now-figures only, never "reserved next".
 *
 * @see {@link file://./location-holds.server.ts} the reader
 * @see {@link file://../../../routes/_layout+/locations.$locationId.assets.tsx}
 */

import { peakConcurrent } from "@shelf/quantity-control";
import type { AvailabilityInterval } from "@shelf/quantity-control";

/** One booking's units still to leave a location, over its window. */
export type PendingHold = {
  /** Booking start. */
  from: Date;
  /** Booking end, half-open; far in the future for an overdue booking. */
  to: Date;
  /** Units planned from this location that have not left yet. */
  pending: number;
};

/**
 * The peak of pending units over the next booking window from now.
 *
 * The next window is that of the booking whose hold starts soonest (a booking
 * already running starts now), clipped to start no earlier than now; ties go
 * to the one ending first. Every hold overlapping that window counts toward
 * the peak, clipped to it. Holds already over count for nothing.
 *
 * @param holds - Pending holds at one location of one pool
 * @param now - The current instant
 * @returns Units reserved next; 0 when nothing is pending
 */
export function reservedNextAtLocation(
  holds: readonly PendingHold[],
  now: Date
): number {
  const nowMs = now.getTime();
  const live = holds.filter((h) => h.pending > 0 && h.to.getTime() > nowMs);
  if (live.length === 0) return 0;

  const startOf = (h: PendingHold) => Math.max(h.from.getTime(), nowMs);
  const next = [...live].sort(
    (a, b) => startOf(a) - startOf(b) || a.to.getTime() - b.to.getTime()
  )[0];
  const windowFrom = startOf(next);
  const windowTo = next.to.getTime();

  const intervals: AvailabilityInterval[] = [];
  for (const h of live) {
    const from = Math.max(h.from.getTime(), windowFrom);
    const to = Math.min(h.to.getTime(), windowTo);
    if (from >= to) continue;
    intervals.push({ from: new Date(from), to: new Date(to), qty: h.pending });
  }
  return peakConcurrent(intervals);
}

/** The now-figures and the reservation behind one pool line. */
export type LocationPoolFigures = {
  /** Units placed here manually (`AssetLocation.quantity`, no kit). */
  placed: number;
  /** Units out on bookings that left from here. */
  outOnBookings: number;
  /** Units in custody taken from here. */
  inCustody: number;
  /** {@link reservedNextAtLocation} for this pool here. */
  reservedNext: number;
};

/**
 * Units on the shelf here right now: placed minus out and custody, never
 * below 0. A placement reduced below what is out or held reads 0.
 *
 * @param figures - The pool's figures at this location
 * @returns Units here now
 */
export function unitsHereNow(
  figures: Pick<LocationPoolFigures, "placed" | "outOnBookings" | "inCustody">
): number {
  return Math.max(
    0,
    figures.placed - figures.outOnBookings - figures.inCustody
  );
}

/**
 * The pool line: "8 here · 2 out on bookings · 1 in custody · 3 reserved next".
 * "Here" always shows; each other part only when it is above 0.
 *
 * @param figures - The pool's figures at this location
 * @returns The line, parts joined by " · "
 */
export function formatLocationPoolLine(figures: LocationPoolFigures): string {
  const parts = [`${unitsHereNow(figures)} here`];
  if (figures.outOnBookings > 0) {
    parts.push(`${figures.outOnBookings} out on bookings`);
  }
  if (figures.inCustody > 0) parts.push(`${figures.inCustody} in custody`);
  if (figures.reservedNext > 0) {
    parts.push(`${figures.reservedNext} reserved next`);
  }
  return parts.join(" · ");
}
