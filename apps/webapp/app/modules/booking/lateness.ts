/**
 * Booking Lateness Helper
 *
 * Centralized, dependency-light source of truth for "how late was a booking?"
 * calculations. Both the booking detail page (TimeRemaining indicator) and the
 * Booking Compliance report rely on these helpers so the same booking is
 * never reported as on-time in one place and overdue in another.
 *
 * The module is intentionally pure — no Prisma, no IO, no server-only deps —
 * so it can be safely imported from both server (loaders, report helpers) and
 * client (React components) code.
 *
 * @see {@link file://./../../components/booking/time-remaining.tsx}
 * @see {@link file://./../reports/helpers.server.ts}
 */

import { BookingStatus } from "@prisma/client";

/**
 * Grace period (in ms) within which a return is still considered "on time".
 *
 * A booking returned up to 15 minutes after its scheduled `to` date counts as
 * compliant. This absorbs realistic check-in delays (walking back to the
 * counter, scanning the QR code, etc.) without flagging users as late.
 */
export const COMPLIANCE_GRACE_PERIOD_MS = 15 * 60 * 1000;

/**
 * Booking statuses for which a lateness measurement is meaningful.
 *
 * - `COMPLETE` and `ARCHIVED` represent finished bookings — we compare their
 *   actual check-in time against the scheduled `to` date.
 * - `OVERDUE` is in-flight but has already passed its `to` date — we compare
 *   "now" against the scheduled `to` date.
 *
 * Statuses like `DRAFT`, `RESERVED`, `ONGOING`, and `CANCELLED` are excluded:
 * they either haven't run yet, are still within their window, or never
 * completed.
 */
export const MEASURABLE_BOOKING_STATUSES = [
  BookingStatus.COMPLETE,
  BookingStatus.OVERDUE,
  BookingStatus.ARCHIVED,
] as const;

/** Union of statuses for which {@link getLatenessMs} can return a number. */
export type MeasurableBookingStatus =
  (typeof MEASURABLE_BOOKING_STATUSES)[number];

/** Arguments for {@link getLatenessMs}. */
export interface GetLatenessMsArgs {
  /** The booking's current status. */
  status: BookingStatus;
  /** Scheduled return date (`booking.to`). May be null on legacy data. */
  to: Date | null;
  /** Actual check-in timestamp (`booking.checkInAt`). Null until checked in. */
  checkInAt: Date | null;
  /**
   * Reference "now" — injectable for deterministic testing. Defaults to
   * `new Date()` at call time. Only consulted for `OVERDUE` bookings.
   */
  now?: Date;
}

/**
 * Returns how late a booking was, in milliseconds, or `null` when lateness
 * cannot be measured.
 *
 * - For `OVERDUE`: returns `now − to`. `checkInAt` is ignored (by definition
 *   the booking has not been checked in yet).
 * - For `COMPLETE` / `ARCHIVED` with a `checkInAt`: returns `checkInAt − to`.
 *   A negative result means the booking was returned early.
 * - For `COMPLETE` / `ARCHIVED` without a `checkInAt`: returns `null`. We
 *   deliberately do **not** fall back to `updatedAt` — many fields can move
 *   `updatedAt` after the actual check-in, leading to false "very late"
 *   readings.
 * - For any other status, or when `to` is missing: returns `null`.
 *
 * @param args - Booking status, scheduled return, actual check-in, and optional now.
 * @returns Lateness in ms, or `null` if not measurable.
 */
export function getLatenessMs(args: GetLatenessMsArgs): number | null {
  const { status, to, checkInAt, now = new Date() } = args;

  // Without a scheduled return, there is no reference point.
  if (!to) {
    return null;
  }

  if (status === BookingStatus.OVERDUE) {
    // The booking is currently overdue; lateness is measured against now.
    return now.getTime() - to.getTime();
  }

  if (status === BookingStatus.COMPLETE || status === BookingStatus.ARCHIVED) {
    // We need an actual check-in timestamp to know when the booking returned.
    if (!checkInAt) {
      return null;
    }
    return checkInAt.getTime() - to.getTime();
  }

  // DRAFT, RESERVED, ONGOING, CANCELLED — no meaningful lateness.
  return null;
}

/** Arguments for {@link isOnTime}. */
export interface IsOnTimeArgs {
  /** The booking's current status. */
  status: BookingStatus;
  /** Lateness in ms, as returned by {@link getLatenessMs}. */
  latenessMs: number | null;
}

/**
 * Returns whether a booking should be counted as "on time" for compliance
 * reporting.
 *
 * Rules, in order:
 * 1. `OVERDUE` bookings are never on time — by definition they have already
 *    blown past their scheduled return.
 * 2. `null` lateness (status was not measurable, or `to` / `checkInAt` was
 *    missing) is treated as on-time so absent data does not skew compliance
 *    rates downward. Callers that need a stricter view should pre-filter.
 * 3. Otherwise: on-time iff `latenessMs <= COMPLIANCE_GRACE_PERIOD_MS`.
 *    Negative lateness (returned early) is on-time.
 *
 * @param args - Booking status and computed lateness.
 * @returns `true` if the booking counts as on-time, `false` otherwise.
 */
export function isOnTime(args: IsOnTimeArgs): boolean {
  const { status, latenessMs } = args;

  if (status === BookingStatus.OVERDUE) {
    return false;
  }

  if (latenessMs === null) {
    return true;
  }

  return latenessMs <= COMPLIANCE_GRACE_PERIOD_MS;
}

/**
 * Breaks a positive duration in milliseconds into whole days, hours, and
 * minutes for human-readable rendering (e.g., "Overdue by 2d 3h 14m").
 *
 * Returns zeros for `ms <= 0` so callers can safely format "negative" or
 * empty durations without branching.
 *
 * @param ms - A non-negative duration in milliseconds.
 * @returns An object with `days`, `hours`, and `minutes` integer components.
 */
export function formatOverdueDuration(ms: number): {
  days: number;
  hours: number;
  minutes: number;
} {
  if (ms <= 0) {
    return { days: 0, hours: 0, minutes: 0 };
  }

  const ONE_MINUTE = 60 * 1000;
  const ONE_HOUR = 60 * ONE_MINUTE;
  const ONE_DAY = 24 * ONE_HOUR;

  const days = Math.floor(ms / ONE_DAY);
  const hours = Math.floor((ms % ONE_DAY) / ONE_HOUR);
  const minutes = Math.floor((ms % ONE_HOUR) / ONE_MINUTE);

  return { days, hours, minutes };
}
