/**
 * Tests for the booking permission helpers in `./bookings`.
 *
 * These two helpers look interchangeable and are not. Adding items and
 * removing them have deliberately different rules, and the pair is easy to
 * mix up at a call site — so the difference is pinned here.
 *
 * @see {@link file://./bookings.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  canUserManageBookingAssets,
  canUserRemoveBookingAssets,
} from "./bookings";

/** The statuses in which a booking is a closed record. */
const CLOSED_STATUSES = [
  BookingStatus.COMPLETE,
  BookingStatus.ARCHIVED,
  BookingStatus.CANCELLED,
];

/** The statuses in which a booking is still live. */
const OPEN_STATUSES = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

describe("canUserRemoveBookingAssets", () => {
  it.each(CLOSED_STATUSES)("blocks removal on a %s booking", (status) => {
    expect(canUserRemoveBookingAssets({ status })).toBe(false);
  });

  it.each(OPEN_STATUSES)("allows removal on a %s booking", (status) => {
    expect(canUserRemoveBookingAssets({ status })).toBe(true);
  });

  it("does not consider role — ownership is the caller's job", () => {
    // The product rule this encodes: a self-service custodian may remove items
    // from their own RESERVED booking. A role-aware check can't express that,
    // because it has no way to know the user is the custodian. Callers pair
    // this with their own ownership gate (the web UI's `canSeeActions`, the
    // mobile endpoint's own-booking 403).
    expect(canUserRemoveBookingAssets({ status: BookingStatus.RESERVED })).toBe(
      true
    );
  });
});

describe("canUserManageBookingAssets", () => {
  // Guards the distinction: the ADD path stays stricter than the remove path.
  // If these ever converge, the self-service remove-from-own-reserved-booking
  // behaviour silently disappears.
  it("keeps self-service restricted to DRAFT, unlike the remove helper", () => {
    const reserved = {
      status: BookingStatus.RESERVED,
      from: new Date(),
      to: new Date(),
    };

    expect(canUserManageBookingAssets(reserved, true)).toBe(false);
    expect(canUserRemoveBookingAssets(reserved)).toBe(true);
  });

  it("allows non-self-service on a live booking", () => {
    expect(
      canUserManageBookingAssets(
        { status: BookingStatus.ONGOING, from: new Date(), to: new Date() },
        false
      )
    ).toBe(true);
  });
});
