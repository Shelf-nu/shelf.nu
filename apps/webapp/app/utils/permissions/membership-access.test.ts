/**
 * Tests for resolveMembershipAccess: the access of the membership in the
 * ACTIVE organization, for loaders that do not go through requirePermission.
 *
 * @see {@link file://./membership-access.ts}
 */
import { resolveMembershipAccess } from "./membership-access";

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
