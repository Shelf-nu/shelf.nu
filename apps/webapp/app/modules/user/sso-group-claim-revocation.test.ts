/**
 * Regression: an SSO login that drops a workspace's group claim must revoke
 * access the same way the admin "revoke access" UI does.
 *
 * `reconcileSsoGroupMembership` (formerly `handleSCIMTransition`) used to
 * open-code a bare `userOrganization.delete`. That removed the membership but
 * left the `TeamMember` still linked to the `User`, and left
 * `User.lastSelectedOrganizationId` pointing at a workspace the user could no
 * longer open.
 *
 * The surviving `TeamMember.user` link is the part that leaks: the booking
 * notification resolver and the `usersOnly` custodian pickers read straight
 * through it with no membership check, so the revoked person kept receiving
 * that workspace's booking emails and stayed pickable as a recipient. See
 * `~/modules/booking/notification-recipients.server.test.ts` ("revoked SSO
 * member") for the downstream half of this regression.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  teamMemberFindMany: vi.fn(),
  teamMemberFindFirst: vi.fn(),
  userOrganizationDelete: vi.fn(),
  userOrganizationUpdate: vi.fn(),
  userOrganizationUpsert: vi.fn(),
  executeRaw: vi.fn(),
  scimFindUnique: vi.fn(),
}));

// why: the subject is the set of writes the revocation issues, not what a
// database returns
vi.mock("~/database/db.server", () => ({
  db: {
    user: { update: dbMocks.userUpdate },
    teamMember: {
      findMany: dbMocks.teamMemberFindMany,
      findFirst: dbMocks.teamMemberFindFirst,
    },
    userOrganization: {
      delete: dbMocks.userOrganizationDelete,
      update: dbMocks.userOrganizationUpdate,
      upsert: dbMocks.userOrganizationUpsert,
    },
    userScimExternalId: { findUnique: dbMocks.scimFindUnique },
    $executeRaw: dbMocks.executeRaw,
  },
}));

// why: the SSO org set is a DB read; the test controls which workspaces (and
// group mappings) the login reconciles against
vi.mock("../organization/service.server", () => ({
  getOrganizationsBySsoDomain: vi.fn(),
}));

// why: the grant branch creates a team member; isolate that side effect
vi.mock("../team-member/service.server", () => ({
  createTeamMember: vi.fn(),
}));

const mockOrg = await import("../organization/service.server");
const mockTeamMember = await import("../team-member/service.server");

import { updateUserFromSSO } from "./service.server";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const TEAM_MEMBER_ID = "tm-1";
const EMAIL = "jane@university.edu";

/** A domain workspace that maps the `g-staff` group to the BASE role. */
function domainOrg() {
  return {
    id: ORG_ID,
    ssoDetails: {
      adminGroupId: null,
      baseUserGroupId: "g-staff",
      selfServiceGroupId: null,
    },
  };
}

/**
 * Signs the user in with `groups`, against a workspace they already belong to.
 * Passing groups that map to no role is the revocation case: the annual IdP
 * cohort rollover that drops someone out of `g-staff`.
 */
function login(groups: string[]) {
  return updateUserFromSSO(
    { email: EMAIL, userId: USER_ID } as Parameters<
      typeof updateUserFromSSO
    >[0],
    {
      id: USER_ID,
      // Matches userData, so the profile-update `user.update` never fires and
      // every `user.update` call below belongs to the revocation.
      firstName: "Jane",
      lastName: "Doe",
      userOrganizations: [{ organization: { id: ORG_ID }, roles: ["BASE"] }],
    } as unknown as Parameters<typeof updateUserFromSSO>[1],
    { firstName: "Jane", lastName: "Doe", groups }
  );
}

/** The `data` of the single `user.update` the revocation issues. */
function revokeData() {
  return dbMocks.userUpdate.mock.calls[0]?.[0]?.data;
}

describe("SSO group-claim revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - vitest mock type
    mockOrg.getOrganizationsBySsoDomain.mockResolvedValue([domainOrg()]);
    dbMocks.teamMemberFindMany.mockResolvedValue([{ id: TEAM_MEMBER_ID }]);
    dbMocks.userUpdate.mockResolvedValue({ id: USER_ID });
    dbMocks.userOrganizationUpdate.mockResolvedValue({});
    dbMocks.executeRaw.mockResolvedValue(1);
  });

  it("unlinks the team member as well as deleting the membership", async () => {
    await login(["g-alumni"]);

    // The leak: without the disconnect, `TeamMember.user` still resolves, and
    // every notification path reads through it with no membership check.
    expect(revokeData().teamMembers).toEqual({
      disconnect: [{ id: TEAM_MEMBER_ID }],
    });
    expect(revokeData().userOrganizations).toEqual({
      delete: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
      },
    });
    // The narrow open-coded delete this path used to take must be gone.
    expect(dbMocks.userOrganizationDelete).not.toHaveBeenCalled();
  });

  it("unlinks every team member linked to the user in the workspace", async () => {
    // The pre-fix revoke left the row linked, so a later re-grant created a
    // second one. Unlinking only the first would keep the other leaking.
    dbMocks.teamMemberFindMany.mockResolvedValue([
      { id: TEAM_MEMBER_ID },
      { id: "tm-2" },
    ]);

    await login(["g-alumni"]);

    expect(dbMocks.teamMemberFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, organizationId: ORG_ID },
      select: { id: true },
    });
    expect(revokeData().teamMembers).toEqual({
      disconnect: [{ id: TEAM_MEMBER_ID }, { id: "tm-2" }],
    });
  });

  it("clears lastSelectedOrganizationId so the login cannot land on the revoked org", async () => {
    await login(["g-alumni"]);

    expect(dbMocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("reports the revocation and returns no landing org", async () => {
    const result = await login(["g-alumni"]);

    expect(result.transitions).toEqual([
      {
        userId: USER_ID,
        organizationId: ORG_ID,
        previousRoles: ["BASE"],
        newRole: null,
        transitionType: "ACCESS_REVOKED",
      },
    ]);
    expect(result.org).toBeNull();
  });

  it("still revokes when no team member row is linked", async () => {
    // NRM-less membership (invite accepted, team member already detached).
    // The disconnect is skipped; the membership delete must still happen.
    dbMocks.teamMemberFindMany.mockResolvedValue([]);

    await login(["g-alumni"]);

    expect(revokeData().teamMembers).toBeUndefined();
    expect(revokeData().userOrganizations).toEqual({
      delete: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
      },
    });
  });

  it("fails the login closed when the revocation cannot be applied", async () => {
    // Deliberate: swallowing this per workspace would leave the user signed in
    // still holding the access this call exists to remove.
    dbMocks.userUpdate.mockRejectedValue(new Error("connection lost"));

    await expect(login(["g-alumni"])).rejects.toThrow();
  });

  it("leaves a still-claimed workspace on the role-update path", async () => {
    await login(["g-staff"]);

    expect(dbMocks.userUpdate).not.toHaveBeenCalled();
    expect(dbMocks.userOrganizationUpdate).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
      },
      data: { roles: { set: ["BASE"] } },
    });
  });

  describe("re-granting a workspace the user has no membership in", () => {
    /** Same login, but the user holds no membership in the workspace yet. */
    function loginWithoutMembership(groups: string[]) {
      return updateUserFromSSO(
        { email: EMAIL, userId: USER_ID } as Parameters<
          typeof updateUserFromSSO
        >[0],
        {
          id: USER_ID,
          firstName: "Jane",
          lastName: "Doe",
          userOrganizations: [],
        } as unknown as Parameters<typeof updateUserFromSSO>[1],
        { firstName: "Jane", lastName: "Doe", groups }
      );
    }

    beforeEach(() => {
      dbMocks.scimFindUnique.mockResolvedValue(null);
      dbMocks.userOrganizationUpsert.mockResolvedValue({});
    });

    it("re-uses a team member still linked from an earlier revoke", async () => {
      // Pre-fix revokes left the team member linked; creating another here is
      // how one user ended up with four in the same workspace.
      dbMocks.teamMemberFindFirst.mockResolvedValue({ id: TEAM_MEMBER_ID });

      const result = await loginWithoutMembership(["g-staff"]);

      expect(dbMocks.teamMemberFindFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, organizationId: ORG_ID, deletedAt: null },
        select: { id: true },
      });
      expect(mockTeamMember.createTeamMember).not.toHaveBeenCalled();
      expect(dbMocks.userOrganizationUpsert).toHaveBeenCalledTimes(1);
      expect(result.transitions[0]?.transitionType).toBe("ACCESS_GRANTED");
    });

    it("creates a team member when none is linked", async () => {
      dbMocks.teamMemberFindFirst.mockResolvedValue(null);

      await loginWithoutMembership(["g-staff"]);

      expect(mockTeamMember.createTeamMember).toHaveBeenCalledWith({
        name: "Jane Doe",
        organizationId: ORG_ID,
        userId: USER_ID,
      });
    });
  });
});
