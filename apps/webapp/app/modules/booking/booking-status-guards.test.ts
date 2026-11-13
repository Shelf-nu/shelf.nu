/**
 * Booking-status immutability guards.
 *
 * A closed booking (COMPLETE / ARCHIVED / CANCELLED) is a historical record —
 * once it is closed, nothing about it may change, or the audit trail stops
 * describing what actually happened. And a booking that was never checked out
 * cannot be checked in.
 *
 * Both rules existed in the product but were enforced only where someone
 * remembered to write them: in route actions, in loaders that merely decided
 * what to render, or not at all. These tests pin the service-layer assertions
 * that now enforce them for every caller.
 *
 * detail.dev findings D055, D084, D097.
 *
 * @see {@link file://./utils.server.ts}
 */

import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { isBookingPendingApproval } from "~/utils/bookings";
import {
  assertBookingIsApproved,
  assertBookingIsCheckinable,
  assertBookingIsOpen,
  CLOSED_BOOKING_STATUSES,
  IN_FLIGHT_BOOKING_STATUSES,
} from "./utils.server";

// @vitest-environment node

const BOOKING_ID = "booking-1";

/** Every status the enum defines, so a new one cannot be silently unhandled. */
const ALL_STATUSES = Object.values(BookingStatus);

describe("assertBookingIsOpen", () => {
  it.each(CLOSED_BOOKING_STATUSES)("refuses a %s booking", (status) => {
    expect(() =>
      assertBookingIsOpen({
        status,
        operation: "change the items on",
        bookingId: BOOKING_ID,
      })
    ).toThrow(/closed records/);
  });

  it.each(ALL_STATUSES.filter((s) => !CLOSED_BOOKING_STATUSES.includes(s)))(
    "allows a %s booking",
    (status) => {
      expect(() =>
        assertBookingIsOpen({
          status,
          operation: "change the items on",
          bookingId: BOOKING_ID,
        })
      ).not.toThrow();
    }
  );

  it("throws a 400 that is not reported as a server fault", () => {
    // A stale tab whose booking was completed elsewhere lands here
    // legitimately, so this must not page anyone.
    try {
      assertBookingIsOpen({
        status: BookingStatus.COMPLETE,
        operation: "check out",
        bookingId: BOOKING_ID,
      });
      throw new Error("expected assertBookingIsOpen to throw");
    } catch (cause) {
      const err = cause as { status?: number; shouldBeCaptured?: boolean };
      expect(err.status).toBe(400);
      expect(err.shouldBeCaptured).toBe(false);
    }
  });

  it("names the operation, so the four call sites do not share one message", () => {
    const message = (operation: string) => {
      try {
        assertBookingIsOpen({
          status: BookingStatus.CANCELLED,
          operation,
          bookingId: BOOKING_ID,
        });
        return "";
      } catch (cause) {
        return (cause as Error).message;
      }
    };

    expect(message("add scanned items to")).toContain("add scanned items to");
    expect(message("check out")).toContain("check out");
  });
});

describe("assertBookingIsCheckinable", () => {
  it.each(IN_FLIGHT_BOOKING_STATUSES)("allows a %s booking", (status) => {
    expect(() =>
      assertBookingIsCheckinable({ status, bookingId: BOOKING_ID })
    ).not.toThrow();
  });

  it.each(ALL_STATUSES.filter((s) => !IN_FLIGHT_BOOKING_STATUSES.includes(s)))(
    "refuses a %s booking",
    (status) => {
      expect(() =>
        assertBookingIsCheckinable({ status, bookingId: BOOKING_ID })
      ).toThrow(/ongoing or overdue/);
    }
  );

  it("refuses DRAFT and RESERVED specifically", () => {
    // The reported bug: these two marked the booking COMPLETE while checking
    // in nothing, because the asset filter keeps only CHECKED_OUT assets and
    // on these statuses there are none.
    for (const status of [BookingStatus.DRAFT, BookingStatus.RESERVED]) {
      expect(() =>
        assertBookingIsCheckinable({ status, bookingId: BOOKING_ID })
      ).toThrow();
    }
  });
});

describe("isBookingPendingApproval", () => {
  it("is pending only for RESERVED + no approvedAt + org requires approval", () => {
    expect(
      isBookingPendingApproval({
        status: BookingStatus.RESERVED,
        approvedAt: null,
        requireBookingApproval: true,
      })
    ).toBe(true);
  });

  it("is not pending when the org does not require approval", () => {
    expect(
      isBookingPendingApproval({
        status: BookingStatus.RESERVED,
        approvedAt: null,
        requireBookingApproval: false,
      })
    ).toBe(false);
  });

  it("is not pending once approved", () => {
    expect(
      isBookingPendingApproval({
        status: BookingStatus.RESERVED,
        approvedAt: new Date(),
        requireBookingApproval: true,
      })
    ).toBe(false);
  });

  it("is not pending in any non-RESERVED status", () => {
    for (const status of Object.values(BookingStatus)) {
      if (status === BookingStatus.RESERVED) continue;
      expect(
        isBookingPendingApproval({
          status,
          approvedAt: null,
          requireBookingApproval: true,
        })
      ).toBe(false);
    }
  });
});

describe("assertBookingIsApproved", () => {
  it("throws a 400 for a pending reservation request", () => {
    expect(() =>
      assertBookingIsApproved({
        status: BookingStatus.RESERVED,
        approvedAt: null,
        requireBookingApproval: true,
        bookingId: "b1",
      })
    ).toThrowError(/not been approved yet/);
  });

  it("passes an approved reservation", () => {
    expect(() =>
      assertBookingIsApproved({
        status: BookingStatus.RESERVED,
        approvedAt: new Date(),
        requireBookingApproval: true,
        bookingId: "b1",
      })
    ).not.toThrow();
  });

  it("passes everything when the org does not require approval", () => {
    expect(() =>
      assertBookingIsApproved({
        status: BookingStatus.RESERVED,
        approvedAt: null,
        requireBookingApproval: false,
        bookingId: "b1",
      })
    ).not.toThrow();
  });
});

describe("the two status sets", () => {
  it("do not overlap", () => {
    // A booking cannot be both closed and in flight. If this ever fails, one
    // of the two guards is contradicting the other.
    const overlap = CLOSED_BOOKING_STATUSES.filter((s) =>
      IN_FLIGHT_BOOKING_STATUSES.includes(s)
    );
    expect(overlap).toEqual([]);
  });

  it("leave DRAFT and RESERVED open but not checkinable", () => {
    // The distinction the whole fix rests on: a planned booking may still be
    // edited, but it may not be completed.
    for (const status of [BookingStatus.DRAFT, BookingStatus.RESERVED]) {
      expect(CLOSED_BOOKING_STATUSES).not.toContain(status);
      expect(IN_FLIGHT_BOOKING_STATUSES).not.toContain(status);
    }
  });
});
