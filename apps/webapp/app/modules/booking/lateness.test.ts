import { BookingStatus } from "@prisma/client";
import { describe, it, expect } from "vitest";
import {
  COMPLIANCE_GRACE_PERIOD_MS,
  MEASURABLE_BOOKING_STATUSES,
  formatOverdueDuration,
  getLatenessMs,
  isOnTime,
} from "./lateness";

/**
 * Helper to build deterministic dates from ISO strings.
 */
const d = (iso: string) => new Date(iso);

describe("getLatenessMs", () => {
  it("returns now − to for OVERDUE bookings (ignores checkInAt)", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const now = d("2026-04-01T13:30:00.000Z"); // 90 minutes later
    // checkInAt is set but should be ignored for OVERDUE
    const checkInAt = d("2026-04-05T00:00:00.000Z");

    const result = getLatenessMs({
      status: BookingStatus.OVERDUE,
      to,
      checkInAt,
      now,
    });

    expect(result).toBe(90 * 60 * 1000);
  });

  it("uses checkInAt − to for COMPLETE bookings", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const checkInAt = d("2026-04-01T12:30:00.000Z"); // 30 min late

    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      to,
      checkInAt,
    });

    expect(result).toBe(30 * 60 * 1000);
  });

  it("uses checkInAt − to for ARCHIVED bookings (not updatedAt)", () => {
    const to = d("2026-04-01T12:00:00.000Z");
    const checkInAt = d("2026-04-01T11:50:00.000Z"); // 10 min early → negative

    const result = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      to,
      checkInAt,
    });

    // 10 minutes early = -10 minutes lateness
    expect(result).toBe(-10 * 60 * 1000);
  });

  it("returns null for COMPLETE without checkInAt", () => {
    const result = getLatenessMs({
      status: BookingStatus.COMPLETE,
      to: d("2026-04-01T12:00:00.000Z"),
      checkInAt: null,
    });

    expect(result).toBeNull();
  });

  it("returns null for ARCHIVED without checkInAt", () => {
    const result = getLatenessMs({
      status: BookingStatus.ARCHIVED,
      to: d("2026-04-01T12:00:00.000Z"),
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
      to: d("2026-04-01T12:00:00.000Z"),
      checkInAt: d("2026-04-01T13:00:00.000Z"),
      now: d("2026-04-01T14:00:00.000Z"),
    });

    expect(result).toBeNull();
  });

  it("returns null when `to` is missing", () => {
    const result = getLatenessMs({
      status: BookingStatus.OVERDUE,
      to: null,
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
