/**
 * Booking Lateness Helper — Unit Tests
 *
 * Pins the pure lateness contract shared by the booking detail page and the
 * Booking Compliance report: which statuses are measurable, how lateness is
 * computed against a caller-resolved deadline, where the grace period falls,
 * and which end/start date `resolvePlannedEnd`/`resolvePlannedStart` pick.
 *
 * @see {@link file://./lateness.ts}
 */

import { BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_GRACE_PERIOD_MS,
  MEASURABLE_BOOKING_STATUSES,
  formatOverdueDuration,
  getLatenessMs,
  isOnTime,
  resolveCheckInAt,
  resolvePlannedEnd,
  resolvePlannedStart,
} from "./lateness";

/**
 * Helper to build deterministic dates from ISO strings.
 */
const d = (iso: string) => new Date(iso);

describe("getLatenessMs", () => {
  it("returns now − scheduledEnd for OVERDUE bookings (ignores checkInAt)", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const now = d("2026-04-01T13:30:00.000Z"); // 90 minutes later
    // checkInAt is set but should be ignored for OVERDUE
    const checkInAt = d("2026-04-05T00:00:00.000Z");

    const result = getLatenessMs({
      status: BookingStatus.OVERDUE,
      scheduledEnd: to,
      checkInAt,
      now,
    });

    expect(result).toBe(90 * 60 * 1000);
  });

  it("uses checkInAt − scheduledEnd for COMPLETE bookings", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const checkInAt = d("2026-04-01T12:30:00.000Z"); // 30 min late

    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      scheduledEnd: to,
      checkInAt,
    });

    expect(result).toBe(30 * 60 * 1000);
  });

  it("uses checkInAt − scheduledEnd for ARCHIVED bookings (not updatedAt)", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const checkInAt = d("2026-04-01T11:50:00.000Z"); // 10 min early → negative

    const result = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      scheduledEnd: to,
      checkInAt,
    });

    // 10 minutes early = -10 minutes lateness
    expect(result).toBe(-10 * 60 * 1000);
  });

  it("returns null for COMPLETE without checkInAt", () => {
    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      scheduledEnd: d("2026-04-01T12:00:00.000Z"),
      checkInAt: null,
    });

    expect(result).toBeNull();
  });

  it("returns null for ARCHIVED without checkInAt", () => {
    const result = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      scheduledEnd: d("2026-04-01T12:00:00.000Z"),
      checkInAt: null,
    });

    expect(result).toBeNull();
  });

  it.each([
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
    BookingStatus.ONGOING,
    BookingStatus.CANCELLED,
  ])("returns null for non-measurable status %s", (status) => {
    const result = getLatenessMs({
      status,
      scheduledEnd: d("2026-04-01T12:00:00.000Z"),
      checkInAt: d("2026-04-01T13:00:00.000Z"),
      now: d("2026-04-01T14:00:00.000Z"),
    });

    expect(result).toBeNull();
  });

  it("returns null when the scheduled end is missing", () => {
    const result = getLatenessMs({
      status: BookingStatus.OVERDUE,
      scheduledEnd: null,
      checkInAt: null,
      now: d("2026-04-01T14:00:00.000Z"),
    });

    expect(result).toBeNull();
  });
});

describe("isOnTime", () => {
  it("returns true when latenessMs is exactly the grace period", () => {
    const result = isOnTime({
      status: BookingStatus.COMPLETE,
      latenessMs: COMPLIANCE_GRACE_PERIOD_MS,
    });

    expect(result).toBe(true);
  });

  it("returns false when latenessMs is grace period + 1ms", () => {
    const result = isOnTime({
      status: BookingStatus.COMPLETE,
      latenessMs: COMPLIANCE_GRACE_PERIOD_MS + 1,
    });

    expect(result).toBe(false);
  });

  it("returns false for OVERDUE regardless of latenessMs", () => {
    // Even with null lateness or values within the grace period,
    // an OVERDUE booking is by definition not on time.
    expect(isOnTime({ status: BookingStatus.OVERDUE, latenessMs: null })).toBe(
      false
    );
    expect(isOnTime({ status: BookingStatus.OVERDUE, latenessMs: 0 })).toBe(
      false
    );
    expect(
      isOnTime({
        status: BookingStatus.OVERDUE,
        latenessMs: COMPLIANCE_GRACE_PERIOD_MS,
      })
    ).toBe(false);
  });

  it("returns true when latenessMs is null (no data, assume on-time)", () => {
    const result = isOnTime({
      status: BookingStatus.COMPLETE,
      latenessMs: null,
    });

    expect(result).toBe(true);
  });

  it("returns true for negative lateness (returned early)", () => {
    const result = isOnTime({
      status: BookingStatus.COMPLETE,
      latenessMs: -5 * 60 * 1000,
    });

    expect(result).toBe(true);
  });
});

describe("formatOverdueDuration", () => {
  it("formats 26d 14h 11m correctly", () => {
    const ms = 26 * 24 * 60 * 60 * 1000 + 14 * 60 * 60 * 1000 + 11 * 60 * 1000;

    const result = formatOverdueDuration(ms);

    expect(result).toEqual({ days: 26, hours: 14, minutes: 11 });
  });

  it("returns zeros for 0 input", () => {
    const result = formatOverdueDuration(0);

    expect(result).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it("returns zeros for negative input", () => {
    const result = formatOverdueDuration(-1000);

    expect(result).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe("MEASURABLE_BOOKING_STATUSES", () => {
  it("includes COMPLETE, OVERDUE, and ARCHIVED with length 3", () => {
    expect(MEASURABLE_BOOKING_STATUSES).toHaveLength(3);
    expect(MEASURABLE_BOOKING_STATUSES).toContain(BookingStatus.COMPLETE);
    expect(MEASURABLE_BOOKING_STATUSES).toContain(BookingStatus.OVERDUE);
    expect(MEASURABLE_BOOKING_STATUSES).toContain(BookingStatus.ARCHIVED);
  });
});

describe("resolveCheckInAt", () => {
  const updatedAt = d("2026-04-10T12:00:00.000Z");
  const fromEvent = d("2026-04-09T10:00:00.000Z");

  it("prefers the canonical event timestamp when present", () => {
    const result = resolveCheckInAt({
      status: BookingStatus.COMPLETE,
      updatedAt,
      fromEvent,
    });

    expect(result).toBe(fromEvent);
  });

  it("falls back to updatedAt for COMPLETE bookings without an event", () => {
    const result = resolveCheckInAt({
      status: BookingStatus.COMPLETE,
      updatedAt,
      fromEvent: null,
    });

    expect(result).toBe(updatedAt);
  });

  it("returns null for ARCHIVED without an event (updatedAt is unreliable)", () => {
    const result = resolveCheckInAt({
      status: BookingStatus.ARCHIVED,
      updatedAt,
      fromEvent: null,
    });

    expect(result).toBeNull();
  });

  it("uses event timestamp for ARCHIVED when present", () => {
    const result = resolveCheckInAt({
      status: BookingStatus.ARCHIVED,
      updatedAt,
      fromEvent,
    });

    expect(result).toBe(fromEvent);
  });

  it("returns null for non-measurable statuses without an event", () => {
    for (const status of [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.CANCELLED,
    ] as const) {
      expect(
        resolveCheckInAt({ status, updatedAt, fromEvent: null })
      ).toBeNull();
    }
  });
});

describe("resolvePlannedEnd / resolvePlannedStart", () => {
  it("prefers the planned columns over the live ones", () => {
    const plannedEnd = d("2026-04-15T12:00:00.000Z");
    const returnMoment = d("2026-04-18T12:00:00.000Z");
    const plannedStart = d("2026-04-10T09:00:00.000Z");
    const checkoutMoment = d("2026-04-11T09:00:00.000Z");

    expect(
      resolvePlannedEnd({ originalTo: plannedEnd, to: returnMoment })
    ).toBe(plannedEnd);
    expect(
      resolvePlannedStart({ originalFrom: plannedStart, from: checkoutMoment })
    ).toBe(plannedStart);
  });

  it("falls back to the live columns on rows predating them", () => {
    const to = d("2026-04-15T12:00:00.000Z");
    const from = d("2026-04-10T09:00:00.000Z");

    expect(resolvePlannedEnd({ originalTo: null, to })).toBe(to);
    expect(resolvePlannedStart({ originalFrom: null, from })).toBe(from);
  });

  it("returns null when neither column is set", () => {
    expect(resolvePlannedEnd({ originalTo: null, to: null })).toBeNull();
    expect(resolvePlannedStart({ originalFrom: null, from: null })).toBeNull();
  });
});

describe("getLatenessMs — measuring against the planned end", () => {
  it("reads a late return as late once check-in has rewritten `to`", () => {
    // Checking in an OVERDUE booking rewrites `to` to the check-in moment and
    // leaves the planned end in `originalTo`. A compliance caller resolves the
    // planned end, or every resolved late return reads as on-time.
    const plannedEnd = d("2026-04-15T12:00:00.000Z");
    const returnMoment = d("2026-04-18T12:00:00.000Z"); // 3 days late

    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      scheduledEnd: resolvePlannedEnd({
        originalTo: plannedEnd,
        to: returnMoment,
      }),
      checkInAt: returnMoment,
    });

    expect(result).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("reads an early-adjusted check-in as early, not exactly on time", () => {
    // Early check-in with the adjust-date intent also rewrites `to` to the
    // return moment. Against the planned end the return is early (negative).
    const plannedEnd = d("2026-04-15T12:00:00.000Z");
    const returnMoment = d("2026-04-14T10:00:00.000Z"); // 26h early

    const result = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      scheduledEnd: resolvePlannedEnd({
        originalTo: plannedEnd,
        to: returnMoment,
      }),
      checkInAt: returnMoment,
    });

    expect(result).toBe(-26 * 60 * 60 * 1000);
  });

  it("keeps an extended booking measured against the deadline it agreed to", () => {
    // Extension moves `to` and leaves `originalTo` alone, so an extended
    // booking returned on its new date is still late against the plan. This is
    // what stops the metric from being reset by extending a late booking.
    const plannedEnd = d("2026-04-10T12:00:00.000Z");
    const extendedTo = d("2026-04-20T12:00:00.000Z");

    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      scheduledEnd: resolvePlannedEnd({
        originalTo: plannedEnd,
        to: extendedTo,
      }),
      checkInAt: extendedTo,
    });

    expect(result).toBe(10 * 24 * 60 * 60 * 1000);
  });

  it("measures an OVERDUE booking against whichever end the caller resolves", () => {
    // The helper never picks the reference itself: a live surface passes `to`
    // (how far past the current deadline), compliance passes the planned end.
    const plannedEnd = d("2026-04-10T12:00:00.000Z");
    const extendedTo = d("2026-04-15T12:00:00.000Z");
    const now = d("2026-04-15T14:00:00.000Z");

    const liveView = getLatenessMs({
      status: BookingStatus.OVERDUE,
      scheduledEnd: extendedTo,
      checkInAt: null,
      now,
    });
    const complianceView = getLatenessMs({
      status: BookingStatus.OVERDUE,
      scheduledEnd: resolvePlannedEnd({
        originalTo: plannedEnd,
        to: extendedTo,
      }),
      checkInAt: null,
      now,
    });

    expect(liveView).toBe(2 * 60 * 60 * 1000);
    expect(complianceView).toBe(5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000);
  });
});
