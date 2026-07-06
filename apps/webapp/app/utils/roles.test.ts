import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isDemotion } from "./roles";

describe("isDemotion", () => {
  it("returns true when ADMIN is changed to BASE", () => {
    expect(isDemotion(OrganizationRoles.ADMIN, OrganizationRoles.BASE)).toBe(
      true
    );
  });

  it("returns true when ADMIN is changed to SELF_SERVICE", () => {
    expect(
      isDemotion(OrganizationRoles.ADMIN, OrganizationRoles.SELF_SERVICE)
    ).toBe(true);
  });

  it("returns false when SELF_SERVICE is changed to BASE (same rank)", () => {
    expect(
      isDemotion(OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE)
    ).toBe(false);
  });

  it("returns false when BASE is changed to SELF_SERVICE (same rank)", () => {
    expect(
      isDemotion(OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE)
    ).toBe(false);
  });

  it("returns false when BASE is promoted to ADMIN", () => {
    expect(isDemotion(OrganizationRoles.BASE, OrganizationRoles.ADMIN)).toBe(
      false
    );
  });

  it("returns false when SELF_SERVICE is promoted to ADMIN", () => {
    expect(
      isDemotion(OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN)
    ).toBe(false);
  });

  it("returns false when role is unchanged", () => {
    expect(isDemotion(OrganizationRoles.ADMIN, OrganizationRoles.ADMIN)).toBe(
      false
    );
    expect(isDemotion(OrganizationRoles.BASE, OrganizationRoles.BASE)).toBe(
      false
    );
  });

  it("returns true when OWNER is changed to any lower role", () => {
    expect(isDemotion(OrganizationRoles.OWNER, OrganizationRoles.ADMIN)).toBe(
      true
    );
    expect(isDemotion(OrganizationRoles.OWNER, OrganizationRoles.BASE)).toBe(
      true
    );
  });

  it("treats ADMIN -> BOOKING_MANAGER as a demotion (triggers entity transfer)", () => {
    // A booking manager cannot own or manage catalog entities, so the
    // change-role flow must move the demoted admin's created entities.
    expect(
      isDemotion(OrganizationRoles.ADMIN, OrganizationRoles.BOOKING_MANAGER)
    ).toBe(true);
  });

  it("treats BOOKING_MANAGER as a peer of BASE/SELF_SERVICE (lateral moves)", () => {
    expect(
      isDemotion(
        OrganizationRoles.SELF_SERVICE,
        OrganizationRoles.BOOKING_MANAGER
      )
    ).toBe(false);
    expect(
      isDemotion(OrganizationRoles.BOOKING_MANAGER, OrganizationRoles.BASE)
    ).toBe(false);
    expect(
      isDemotion(OrganizationRoles.BOOKING_MANAGER, OrganizationRoles.ADMIN)
    ).toBe(false);
  });
});
