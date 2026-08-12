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
    teamMember: { findFirst: dbMocks.teamMemberFindFirst },
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
    dbMocks.teamMemberFindFirst.mockResolvedValue({ id: TEAM_MEMBER_ID });
    dbMocks.userUpdate.mockResolvedValue({ id: USER_ID });
    dbMocks.userOrganizationUpdate.mockResolvedValue({});
    dbMocks.executeRaw.mockResolvedValue(1);
  });

  it("unlinks the team member as well as deleting the membership", async () => {
    await login(["g-alumni"]);

    // The leak: without the disconnect, `TeamMember.user` still resolves, and
    // every notification path reads through it with no membership check.
    expect(revokeData().teamMembers).toEqual({
      disconnect: { id: TEAM_MEMBER_ID },
    });
    expect(revokeData().userOrganizations).toEqual({
      delete: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
      },
    });
    // The narrow open-coded delete this path used to take must be gone.
    expect(dbMocks.userOrganizationDelete).not.toHaveBeenCalled();
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
    dbMocks.teamMemberFindFirst.mockResolvedValue(null);

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
});
