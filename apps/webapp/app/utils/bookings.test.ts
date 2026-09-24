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
  canRoleRemoveBookingAssets,
  canScanAddBookingItems,
  canUserManageBookingAssets,
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

describe("canRoleRemoveBookingAssets", () => {
  const removalsFor = (roles: OrganizationRoles[] | undefined) =>
    [...OPEN_STATUSES, ...CLOSED_STATUSES].filter((status) =>
      canRoleRemoveBookingAssets({ roles, booking: { status } })
    );

  it("lets ADMIN and OWNER remove in every open status", () => {
    expect(removalsFor([OrganizationRoles.ADMIN])).toEqual(OPEN_STATUSES);
    expect(removalsFor([OrganizationRoles.OWNER])).toEqual(OPEN_STATUSES);
  });

  /**
   * BASE holds `booking:update`, which every remove intent checks, so status
   * is the only thing bounding it. It stops at DRAFT because removing from a
   * live booking resets the asset to available, and that is a check-in — an
   * action BASE does not hold.
   */
  it("stops BASE at DRAFT", () => {
    expect(removalsFor([OrganizationRoles.BASE])).toEqual([
      BookingStatus.DRAFT,
    ]);
  });

  it("lets SELF_SERVICE remove from its own RESERVED booking, not a live one", () => {
    expect(removalsFor([OrganizationRoles.SELF_SERVICE])).toEqual([
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
    ]);
  });

  it("never allows removal from a closed booking, whatever the role", () => {
    for (const status of CLOSED_STATUSES) {
      for (const role of Object.values(OrganizationRoles)) {
        expect(
          canRoleRemoveBookingAssets({ roles: [role], booking: { status } })
        ).toBe(false);
      }
    }
  });

  /**
   * A membership carries a role ARRAY. Reading `roles[0]` for an
   * authorization decision resolves `[SELF_SERVICE, ADMIN]` to the restricted
   * answer and refuses an actual admin, so the resolution is by `.some()` —
   * matching `roleHasPermission` in `@shelf/permissions`.
   */
  it("resolves a multi-role membership to its most permissive role", () => {
    expect(
      canRoleRemoveBookingAssets({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
        booking: { status: BookingStatus.ONGOING },
      })
    ).toBe(true);
  });

  it("denies when roles are missing or empty", () => {
    expect(removalsFor(undefined)).toEqual([]);
    expect(removalsFor([])).toEqual([]);
  });
});

const CLOSED = ["COMPLETE", "ARCHIVED", "CANCELLED"] as const;
const R = OrganizationRoles;

describe("canScanAddBookingItems", () => {
  it("lets BASE scan-add to a live booking, unlike SELF_SERVICE", () => {
    expect(
      canScanAddBookingItems({
        access: accessFor([R.BASE]),
        bookingStatus: "RESERVED",
      })
    ).toBe(true);
    expect(
      canScanAddBookingItems({
        access: accessFor([R.SELF_SERVICE]),
        bookingStatus: "RESERVED",
      })
    ).toBe(false);
    expect(
      canScanAddBookingItems({
        access: accessFor([R.SELF_SERVICE]),
        bookingStatus: "DRAFT",
      })
    ).toBe(true);
  });

  it("refuses a closed booking for every role", () => {
    for (const role of [R.OWNER, R.ADMIN, R.SELF_SERVICE, R.BASE]) {
      for (const bookingStatus of CLOSED) {
        expect(
          canScanAddBookingItems({ access: accessFor([role]), bookingStatus })
        ).toBe(false);
      }
    }
  });
});

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
});

describe("bookingCustodianIsSelf", () => {
  it("fixes the custodian for SELF_SERVICE and BASE only", () => {
    expect(
      [R.OWNER, R.ADMIN, R.SELF_SERVICE, R.BASE].map((r) =>
        bookingCustodianIsSelf(accessFor([r]))
      )
    ).toEqual([false, false, true, true]);
  });
});
