/**
 * Tests for resolveMembershipAccess (the access of the membership in the
 * ACTIVE organization, for loaders that do not go through requirePermission)
 * and the membership rules: who may assign a role, who may receive
 * transferred entities, and what a role change moves. Pins that every answer
 * comes from the effective (highest-rank) role or, for Prisma-filter twins,
 * from "any held role", and never from the array's first element.
 *
 * @see {@link file://./membership-access.ts}
 */
import {
  canAssignRole,
  holdsRoleWhere,
  resolveMembershipAccess,
  roleChangeRequiresOwner,
  roleChangeTransfers,
} from "./membership-access";

const OFF = {
  selfServiceCanSeeBookings: false,
  baseUserCanSeeBookings: false,
  selfServiceCanSeeCustody: false,
  baseUserCanSeeCustody: false,
};

describe("resolveMembershipAccess", () => {
  it("reads the membership of the active organization, not another one", () => {
    const access = resolveMembershipAccess({
      userOrganizations: [
        { organization: { id: "org-a" }, roles: ["ADMIN"] },
        { organization: { id: "org-b" }, roles: ["BASE"] },
      ],
      organizationId: "org-b",
      workspace: OFF,
    });

    expect(access.role).toBe("BASE");
    expect(access.bookings.writeAll).toBe(false);
  });

  it("resolves a mixed membership to its highest role in either order", () => {
    for (const roles of [
      ["SELF_SERVICE", "ADMIN"],
      ["ADMIN", "SELF_SERVICE"],
    ]) {
      const access = resolveMembershipAccess({
        userOrganizations: [{ organization: { id: "org-a" }, roles }],
        organizationId: "org-a",
        workspace: OFF,
      });
      expect(access.role).toBe("ADMIN");
    }
  });

  it("resolves to BASE access when the organization is not a membership", () => {
    const access = resolveMembershipAccess({
      userOrganizations: [{ organization: { id: "org-a" }, roles: ["ADMIN"] }],
      organizationId: "org-z",
      workspace: OFF,
    });

    expect(access.role).toBe("BASE");
    expect(access.bookings.seeAll).toBe(false);
  });

  it("lets a see-toggle widen seeing, never writing", () => {
    const access = resolveMembershipAccess({
      userOrganizations: [
        { organization: { id: "org-a" }, roles: ["SELF_SERVICE"] },
      ],
      organizationId: "org-a",
      workspace: { ...OFF, selfServiceCanSeeBookings: true },
    });

    expect(access.bookings.seeAll).toBe(true);
    expect(access.bookings.writeAll).toBe(false);
  });
});

describe("holdsRoleWhere", () => {
  it("matches when any held role satisfies the predicate, in either order", () => {
    const receives = (roles: string[]) =>
      holdsRoleWhere(roles, (p) => p.membership.canReceiveTransfers);
    expect(receives(["SELF_SERVICE", "ADMIN"])).toBe(true);
    expect(receives(["ADMIN", "SELF_SERVICE"])).toBe(true);
    expect(receives(["BASE", "SELF_SERVICE"])).toBe(false);
  });

  it("denies empty, undefined and unknown memberships", () => {
    const owns = (roles: string[] | undefined) =>
      holdsRoleWhere(roles, (p) => p.membership.ownsWorkspace);
    expect(owns([])).toBe(false);
    expect(owns(undefined)).toBe(false);
    expect(owns(["NOT_A_ROLE"])).toBe(false);
  });
});

describe("roleChangeRequiresOwner / canAssignRole", () => {
  it("only the owner may grant or change an Administrator", () => {
    expect(roleChangeRequiresOwner("ADMIN")).toBe(true);
    expect(roleChangeRequiresOwner("SELF_SERVICE")).toBe(false);
    expect(canAssignRole({ actorOwnsWorkspace: false, role: "ADMIN" })).toBe(
      false
    );
    expect(canAssignRole({ actorOwnsWorkspace: true, role: "ADMIN" })).toBe(
      true
    );
    expect(canAssignRole({ actorOwnsWorkspace: false, role: "BASE" })).toBe(
      true
    );
  });
});

describe("roleChangeTransfers", () => {
  it("reads the FROM side from the effective role, not roles[0]", () => {
    // [SELF_SERVICE, ADMIN] is an admin; demoting it to BASE moves both.
    expect(
      roleChangeTransfers({ fromRoles: ["SELF_SERVICE", "ADMIN"], to: "BASE" })
    ).toEqual({ ownership: true, bookingsCreatedForOthers: true });
  });

  it("SELF_SERVICE <-> BASE moves nothing", () => {
    expect(
      roleChangeTransfers({ fromRoles: ["SELF_SERVICE"], to: "BASE" })
    ).toEqual({ ownership: false, bookingsCreatedForOthers: false });
    expect(
      roleChangeTransfers({ fromRoles: ["BASE"], to: "SELF_SERVICE" })
    ).toEqual({ ownership: false, bookingsCreatedForOthers: false });
  });

  it("a promotion moves nothing", () => {
    expect(roleChangeTransfers({ fromRoles: ["BASE"], to: "ADMIN" })).toEqual({
      ownership: false,
      bookingsCreatedForOthers: false,
    });
  });
});
