/**
 * Invite Roles
 *
 * Pins that OWNER can never be granted by an invite. Both the invite dialog's
 * Zod enum and the CSV import's runtime check read this list, so this test is
 * the single place that failure mode is caught for both paths.
 *
 * @see {@link file://./roles.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { INVITABLE_ROLES, isInvitableRole } from "./roles";

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
