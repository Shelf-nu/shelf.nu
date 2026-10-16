/**
 * Announcement audience: the unread count in the layout and the updates list
 * must target the same role for a membership, and the admin form's checkboxes
 * parse to roles without naming them.
 *
 * @see {@link file://./audience.ts}
 */
import { describe, expect, it } from "vitest";
import type { OrganizationRole } from "~/utils/permissions/role-access";
import {
  announcementRole,
  parseTargetRoles,
  targetRoleField,
} from "./audience";

// @vitest-environment node

describe("announcementRole", () => {
  it("reads the effective role, not the first role in the array", () => {
    expect(announcementRole(["SELF_SERVICE", "ADMIN"])).toBe("ADMIN");
    expect(announcementRole(["ADMIN", "SELF_SERVICE"])).toBe("ADMIN");
    expect(announcementRole(["BASE", "SELF_SERVICE"])).toBe("SELF_SERVICE");
  });

  it("targets nothing for a membership with no roles", () => {
    expect(announcementRole([])).toBeNull();
    expect(announcementRole(undefined)).toBeNull();
  });
});

describe("targetRoleField", () => {
  it("derives the existing field names from the role", () => {
    const roles: OrganizationRole[] = [
      "OWNER",
      "ADMIN",
      "SELF_SERVICE",
      "BASE",
    ];
    expect(roles.map((role) => targetRoleField(role))).toEqual([
      "targetOwner",
      "targetAdmin",
      "targetSelfService",
      "targetBase",
    ]);
  });
});

describe("parseTargetRoles", () => {
  it("reads the existing field names and returns the checked roles in rank order", () => {
    const form = new FormData();
    form.append("targetBase", "on");
    form.append("targetOwner", "on");
    form.append("targetSuperuser", "on");
    expect(parseTargetRoles(form)).toEqual(["OWNER", "BASE"]);
  });

  it("returns [] when nothing is checked (visible to everyone)", () => {
    expect(parseTargetRoles(new FormData())).toEqual([]);
  });
});
