/**
 * Invite Roles
 *
 * Pins that OWNER can never be granted by an invite, and that the
 * policy-derived list still covers every other role. The invite dialog, the
 * CSV import and resend all read this list, so this test is the single place
 * that failure mode is caught for every path.
 *
 * @see {@link file://./roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { INVITABLE_ROLES, isInvitableRole, parseInvitableRole } from "./roles";

// @vitest-environment node

describe("INVITABLE_ROLES", () => {
  it("never includes OWNER", () => {
    expect(INVITABLE_ROLES).not.toContain(OrganizationRoles.OWNER);
  });

  it("covers every non-OWNER organization role", () => {
    // If a new role is added to the schema, this fails so someone has to decide
    // whether it is invitable rather than silently leaving it out.
    const nonOwnerRoles = Object.values(OrganizationRoles).filter(
      (role) => role !== OrganizationRoles.OWNER
    );

    expect([...INVITABLE_ROLES].sort()).toEqual(nonOwnerRoles.sort());
  });
});

describe("isInvitableRole", () => {
  it("rejects OWNER", () => {
    expect(isInvitableRole(OrganizationRoles.OWNER)).toBe(false);
  });

  it.each(INVITABLE_ROLES)("accepts %s", (role) => {
    expect(isInvitableRole(role)).toBe(true);
  });

  it.each([
    ["unknown role", "SUPERUSER"],
    ["lowercase owner", "owner"],
    ["empty string", ""],
    ["undefined", undefined],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(isInvitableRole(value)).toBe(false);
  });
});

describe("parseInvitableRole", () => {
  it.each([
    ["the key", "MANAGER", "MANAGER"],
    ["the key in lower case", "self_service", "SELF_SERVICE"],
    ["the label", "Manager", "MANAGER"],
    ["a label with a space", "Self service", "SELF_SERVICE"],
    ["a label that differs from the key", "Administrator", "ADMIN"],
    ["surrounding spaces", "  base  ", "BASE"],
  ])("reads %s", (_label, value, expected) => {
    expect(parseInvitableRole(value)).toBe(expected);
  });

  it.each([
    ["the owner key", "OWNER"],
    ["the owner label", "Owner"],
    ["an unknown role", "Superuser"],
    ["an empty cell", ""],
  ])("refuses %s", (_label, value) => {
    expect(parseInvitableRole(value)).toBeNull();
  });
});
