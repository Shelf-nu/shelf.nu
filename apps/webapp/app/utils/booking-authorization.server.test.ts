// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import {
  assertBookingProcessAccess,
  assertBookingVisibility,
} from "./booking-authorization.server";

const CUSTODIAN = "user-custodian";
const OTHER = "user-other";

describe("assertBookingProcessAccess", () => {
  const booking = { custodianUserId: CUSTODIAN };

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "allows %s on any booking",
    (role) => {
      expect(() =>
        assertBookingProcessAccess({
          booking,
          userId: OTHER,
          role,
          action: "check out",
        })
      ).not.toThrow();
    }
  );

  it("allows BOOKING_MANAGER on any booking (the role's whole purpose)", () => {
    expect(() =>
      assertBookingProcessAccess({
        booking,
        userId: OTHER,
        role: OrganizationRoles.BOOKING_MANAGER,
        action: "check in",
      })
    ).not.toThrow();
  });

  it("allows SELF_SERVICE only as custodian", () => {
    expect(() =>
      assertBookingProcessAccess({
        booking,
        userId: CUSTODIAN,
        role: OrganizationRoles.SELF_SERVICE,
        action: "check out",
      })
    ).not.toThrow();

    expect(() =>
      assertBookingProcessAccess({
        booking,
        userId: OTHER,
        role: OrganizationRoles.SELF_SERVICE,
        action: "check out",
      })
    ).toThrow("You are not authorized to check out this booking.");
  });

  it("never allows BASE, even as custodian (defense in depth)", () => {
    expect(() =>
      assertBookingProcessAccess({
        booking,
        userId: CUSTODIAN,
        role: OrganizationRoles.BASE,
        action: "check in",
      })
    ).toThrow("You are not authorized to check in this booking.");
  });
});

describe("assertBookingVisibility", () => {
  const booking = { custodianUserId: CUSTODIAN };

  it("allows anyone with see-all rights", () => {
    expect(() =>
      assertBookingVisibility({
        booking,
        userId: OTHER,
        canSeeAllBookings: true,
      })
    ).not.toThrow();
  });

  it("allows the custodian without see-all rights", () => {
    expect(() =>
      assertBookingVisibility({
        booking,
        userId: CUSTODIAN,
        canSeeAllBookings: false,
      })
    ).not.toThrow();
  });

  it("blocks non-custodians without see-all rights (mirrors the overview loader)", () => {
    expect(() =>
      assertBookingVisibility({
        booking,
        userId: OTHER,
        canSeeAllBookings: false,
      })
    ).toThrow("You are not authorized to view this booking");
  });
});
