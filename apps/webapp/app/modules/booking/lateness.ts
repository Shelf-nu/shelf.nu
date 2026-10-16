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
 * ## The two date pairs on a booking
 *
 * `originalFrom` / `originalTo` hold the **planned** period — what was agreed
 * when the booking was planned. `from` / `to` hold the **live** period, which
 * later flows rewrite: extension moves `to` forward, and check-out/check-in
 * with the adjust-date intent move `from`/`to` to the actual moment. The
 * planned pair is frozen once the booking starts.
 *
 * Measuring lateness therefore requires the caller to say WHICH deadline it is
 * asking about, which is why {@link getLatenessMs} takes a resolved
 * `scheduledEnd` rather than the raw columns:
 *
 * - Compliance reporting asks "was the agreed plan honoured?" → pass
 *   {@link resolvePlannedEnd}.
 * - Live operational surfaces ask "how far past the current deadline is this
 *   right now?" → pass `booking.to`.
 *
 * @see {@link file://./../../components/booking/time-remaining.tsx}
 * @see {@link file://./../reports/helpers.server.ts}
 */

import { BookingStatus } from "@prisma/client";

/**
 * Grace period (in ms) within which a return is still considered "on time".
 *
 * A booking returned up to 15 minutes after its scheduled end counts as
 * compliant. This absorbs realistic check-in delays (walking back to the
 * counter, scanning the QR code, etc.) without flagging users as late.
 */
export const COMPLIANCE_GRACE_PERIOD_MS = 15 * 60 * 1000;

/**
 * Booking statuses for which a lateness measurement is meaningful.
 *
 * - `COMPLETE` and `ARCHIVED` represent finished bookings — we compare their
 *   actual check-in time against the scheduled end.
 * - `OVERDUE` is in-flight but has already passed its end date — we compare
 *   "now" against the scheduled end.
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

/** The planned/live date columns {@link resolvePlannedEnd} reads. */
export interface BookingPlannedEndFields {
  /** Planned end date (`Booking.originalTo`). Null on rows predating the column. */
  originalTo: Date | null;
  /** Live end date (`Booking.to`). */
  to: Date | null;
}

/**
 * Returns the end date the booking was **planned** to have.
 *
 * `originalTo` is written while the booking is being planned (create, DRAFT
 * edit, reserve) and frozen once it starts, so it survives the rewrites that
 * extension and check-in apply to `to`. It is null only on rows created before
 * the column existed, where `to` is still the planned end.
 *
 * @param booking - A booking row with `originalTo` and `to` selected.
 * @returns The planned end date, or `null` when neither column is set.
 */
export function resolvePlannedEnd(
  booking: BookingPlannedEndFields
): Date | null {
  return booking.originalTo ?? booking.to;
}

/** The planned/live date columns {@link resolvePlannedStart} reads. */
export interface BookingPlannedStartFields {
  /** Planned start date (`Booking.originalFrom`). Null on rows predating the column. */
  originalFrom: Date | null;
  /** Live start date (`Booking.from`). */
  from: Date | null;
}

/**
 * Returns the start date the booking was **planned** to have.
 *
 * The mirror of {@link resolvePlannedEnd}: an early check-out with the
 * adjust-date intent rewrites `from` to the actual check-out moment and leaves
 * the planned start in `originalFrom`.
 *
 * @param booking - A booking row with `originalFrom` and `from` selected.
 * @returns The planned start date, or `null` when neither column is set.
 */
export function resolvePlannedStart(
  booking: BookingPlannedStartFields
): Date | null {
  return booking.originalFrom ?? booking.from;
}

/** Arguments for {@link getLatenessMs}. */
export interface GetLatenessMsArgs {
  /** The booking's current status. */
  status: BookingStatus;
  /**
   * The deadline to measure against.
   *
   * Which date this should be is the caller's decision, because the two
   * surfaces ask different questions: compliance reporting measures against
   * the planned end ({@link resolvePlannedEnd}), while live operational
   * surfaces measure against the current deadline (`booking.to`). Passing the
   * raw columns and letting this helper choose would force one answer on both.
   *
   * `null` (no end date at all) makes the measurement unavailable.
   */
  scheduledEnd: Date | null;
  /**
   * Resolved check-in timestamp for COMPLETE/ARCHIVED bookings. Not a column
   * on the `Booking` model — callers obtain it via {@link resolveCheckInAt}
   * (which prefers the canonical `BOOKING_STATUS_CHANGED → COMPLETE`
   * `ActivityEvent` and falls back to `Booking.updatedAt` for COMPLETE only).
   * Pass `null` when no signal is available; ignored for OVERDUE.
   */
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
 * - For `OVERDUE`: returns `now − scheduledEnd`. `checkInAt` is ignored (by
 *   definition the booking has not been checked in yet).
 * - For `COMPLETE` / `ARCHIVED` with a `checkInAt`: returns
 *   `checkInAt − scheduledEnd`. A negative result means the booking was
 *   returned early.
 * - For `COMPLETE` / `ARCHIVED` without a `checkInAt`: returns `null`. We
 *   deliberately do **not** fall back to `updatedAt` — many fields can move
 *   `updatedAt` after the actual check-in, leading to false "very late"
 *   readings.
 * - For any other status, or when `scheduledEnd` is missing: returns `null`.
 *
 * @param args - Booking status, the deadline to measure against, actual
 *   check-in, and optional now.
 * @returns Lateness in ms, or `null` if not measurable.
 */
export function getLatenessMs(args: GetLatenessMsArgs): number | null {
  const { status, scheduledEnd, checkInAt, now = new Date() } = args;

  // Without a deadline, there is no reference point.
  if (!scheduledEnd) {
    return null;
  }

  if (status === BookingStatus.OVERDUE) {
    // The booking is currently overdue; lateness is measured against now.
    return now.getTime() - scheduledEnd.getTime();
  }

  if (status === BookingStatus.COMPLETE || status === BookingStatus.ARCHIVED) {
    // We need an actual check-in timestamp to know when the booking returned.
    if (!checkInAt) {
      return null;
    }
    return checkInAt.getTime() - scheduledEnd.getTime();
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
 * 2. `null` lateness (status was not measurable, or the scheduled end /
 *    `checkInAt` was missing) is treated as on-time so absent data does not
 *    skew compliance rates downward. Callers that need a stricter view should
 *    pre-filter.
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

/** Arguments for {@link resolveCheckInAt}. */
export interface ResolveCheckInAtArgs {
  /** The booking's current status. */
  status: BookingStatus;
  /**
   * `Booking.updatedAt` — last row mutation timestamp. Used as a COMPLETE-only
   * fallback when no canonical event exists.
   */
  updatedAt: Date | null;
  /**
   * Timestamp from the canonical `BOOKING_STATUS_CHANGED → COMPLETE`
   * `ActivityEvent` (resolved by `resolveCheckInTimes`). Pass `null` when no
   * event was recorded.
   */
  fromEvent: Date | null;
}

/**
 * Resolves the best-available check-in timestamp for a booking, applying the
 * fallback policy that compliance reports rely on:
 *
 * 1. Prefer the canonical `BOOKING_STATUS_CHANGED → COMPLETE` event timestamp
 *    when one exists. This is the most accurate signal — written as part of
 *    the booking status mutation.
 * 2. For `COMPLETE` bookings without an event, fall back to `updatedAt`.
 *    This covers bookings completed before the `ActivityEvent` layer existed
 *    (pre-2026-04-21), and the rare event-write failure (the event is
 *    recorded best-effort).
 * 3. For `ARCHIVED` (or any other) status without an event, return `null`.
 *    `Booking.updatedAt` is unreliable for ARCHIVED — the auto-archive job
 *    shifts it well after the actual check-in moment.
 *
 * Callers should pass the result to {@link getLatenessMs} as `checkInAt`.
 *
 * @param args - Booking status, raw `updatedAt`, and the resolved event timestamp.
 * @returns The best-available check-in timestamp, or `null` when no reliable
 *   signal is available (caller should treat as on-time per {@link isOnTime}).
 */
export function resolveCheckInAt(args: ResolveCheckInAtArgs): Date | null {
  const { status, updatedAt, fromEvent } = args;
  if (fromEvent) return fromEvent;
  if (status === BookingStatus.COMPLETE) return updatedAt;
  return null;
}
