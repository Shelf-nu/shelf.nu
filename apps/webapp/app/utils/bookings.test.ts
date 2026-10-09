/**
 * Tests for the booking permission helpers in `./bookings`.
 *
 * These helpers look interchangeable and are not. Adding items and removing
 * them have deliberately different rules, and role is a separate axis again —
 * all three are easy to mix up at a call site, so the differences are pinned here.
 *
 * @see {@link file://./bookings.ts}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { accessFor } from "@helpers/role-access";
import {
  bookingCustodianIsSelf,
  canUserRemoveBookingAssets,
  mayRemoveBookingItems,
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

const R = OrganizationRoles;

describe("mayRemoveBookingItems", () => {
  it("needs the booking:update grant as well as the status rule", () => {
    expect(
      mayRemoveBookingItems({
        canUpdateBooking: false,
        access: accessFor([R.ADMIN]),
        bookingStatus: "DRAFT",
      })
    ).toBe(false);
  });

  it("stops BASE at DRAFT and SELF_SERVICE at RESERVED", () => {
    const may = (
      role: OrganizationRoles,
      bookingStatus: "DRAFT" | "RESERVED" | "ONGOING"
    ) =>
      mayRemoveBookingItems({
        canUpdateBooking: true,
        access: accessFor([role]),
        bookingStatus,
      });

    expect([may(R.BASE, "DRAFT"), may(R.BASE, "RESERVED")]).toEqual([
      true,
      false,
    ]);
    expect([
      may(R.SELF_SERVICE, "RESERVED"),
      may(R.SELF_SERVICE, "ONGOING"),
    ]).toEqual([true, false]);
    expect(may(R.ADMIN, "ONGOING")).toBe(true);
  });

  it("lets MANAGER remove items in every open status, like ADMIN", () => {
    for (const bookingStatus of OPEN_STATUSES) {
      expect(
        mayRemoveBookingItems({
          canUpdateBooking: true,
          access: accessFor([R.MANAGER]),
          bookingStatus,
        })
      ).toBe(
        mayRemoveBookingItems({
          canUpdateBooking: true,
          access: accessFor([R.ADMIN]),
          bookingStatus,
        })
      );
    }
    expect(
      mayRemoveBookingItems({
        canUpdateBooking: true,
        access: accessFor([R.MANAGER]),
        bookingStatus: "OVERDUE",
      })
    ).toBe(true);
  });
});

describe("bookingCustodianIsSelf", () => {
  it("fixes the custodian for SELF_SERVICE and BASE only", () => {
    expect(
      [R.OWNER, R.ADMIN, R.MANAGER, R.SELF_SERVICE, R.BASE].map((r) =>
        bookingCustodianIsSelf(accessFor([r]))
      )
    ).toEqual([false, false, false, true, true]);
  });
});
