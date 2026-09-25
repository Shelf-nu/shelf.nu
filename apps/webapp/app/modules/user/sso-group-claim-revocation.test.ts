/**
 * SSO group-claim reconciliation: an SSO login whose group claims no longer map
 * to a role in a workspace revokes access the same way the admin "revoke
 * access" UI does, through `revokeAccessToOrganization`.
 *
 * That means the `TeamMember` is disconnected from the `User`, not just the
 * membership deleted. A linked `TeamMember.user` is what the booking
 * notification resolver and the `usersOnly` custodian pickers read through
 * with no membership check, so a revoked person whose row stays linked keeps
 * receiving that workspace's booking emails and stays pickable as a recipient.
 * See `~/modules/booking/notification-recipients.server.test.ts` ("revoked SSO
 * member") for the downstream half.
 *
 * The workspace owner is the exception: a login never revokes the owner, since
 * that would strand the workspace and lock the owner out on the way in.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  userUpdate: vi.fn(),
  teamMemberFindMany: vi.fn(),
  teamMemberFindFirst: vi.fn(),
  teamMemberCreate: vi.fn(),
  userOrganizationFindFirst: vi.fn(),
  userOrganizationDeleteMany: vi.fn(),
  userOrganizationUpdate: vi.fn(),
  userOrganizationUpsert: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  scimFindUnique: vi.fn(),
}));

// why: the subject is the set of writes the reconciliation issues, not what a
// database returns
vi.mock("~/database/db.server", () => {
  const db = {
    user: { update: dbMocks.userUpdate },
    teamMember: {
      findMany: dbMocks.teamMemberFindMany,
      findFirst: dbMocks.teamMemberFindFirst,
      create: dbMocks.teamMemberCreate,
    },
    userOrganization: {
      findFirst: dbMocks.userOrganizationFindFirst,
      deleteMany: dbMocks.userOrganizationDeleteMany,
      update: dbMocks.userOrganizationUpdate,
      upsert: dbMocks.userOrganizationUpsert,
    },
    userScimExternalId: { findUnique: dbMocks.scimFindUnique },
    $executeRaw: dbMocks.executeRaw,
    $queryRaw: dbMocks.queryRaw,
    $transaction: dbMocks.transaction,
  };
  // Transaction callbacks run against the same mock client
  dbMocks.transaction.mockImplementation(
    (callback: (tx: typeof db) => unknown) => callback(db)
  );
  return { db };
});

// why: the SSO org set is a DB read; the test controls which workspaces (and
// group mappings) the login reconciles against
vi.mock("../organization/service.server", () => ({
  getOrganizationsBySsoDomain: vi.fn(),
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
 * Signs the user in with `groups`. `roles` are the ones they hold in the
 * workspace, or `null` for no membership at all. Groups that map to no role
 * are the revocation case: the annual IdP cohort rollover that drops someone
 * out of `g-staff`.
 */
function login(groups: string[], roles: string[] | null = ["BASE"]) {
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
      userOrganizations: roles ? [{ organization: { id: ORG_ID }, roles }] : [],
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
    dbMocks.userOrganizationFindFirst.mockResolvedValue({ roles: ["BASE"] });
    dbMocks.userOrganizationDeleteMany.mockResolvedValue({ count: 1 });
    dbMocks.teamMemberFindMany.mockResolvedValue([{ id: TEAM_MEMBER_ID }]);
    dbMocks.userUpdate.mockResolvedValue({ id: USER_ID });
    dbMocks.userOrganizationUpdate.mockResolvedValue({});
    dbMocks.executeRaw.mockResolvedValue(1);
  });

  it("unlinks the team member as well as deleting the membership", async () => {
    await login(["g-alumni"]);

    // Without the disconnect, `TeamMember.user` still resolves, and every
    // notification path reads through it with no membership check.
    expect(revokeData().teamMembers).toEqual({
      disconnect: [{ id: TEAM_MEMBER_ID }],
    });
    expect(dbMocks.userOrganizationDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        organizationId: ORG_ID,
        NOT: { roles: { has: "OWNER" } },
      },
    });
  });

  it("unlinks every team member linked to the user in the workspace", async () => {
    // The schema allows several linked rows per (user, org); unlinking only
    // one would leave the rest routing notifications to the revoked user.
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
    // Membership with no linked team member: the disconnect is skipped, the
    // membership delete still happens.
    dbMocks.teamMemberFindMany.mockResolvedValue([]);

    await login(["g-alumni"]);

    expect(revokeData().teamMembers).toBeUndefined();
    expect(dbMocks.userOrganizationDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("fails the login closed when the revocation cannot be applied", async () => {
    // Swallowing this per workspace would leave the user signed in still
    // holding the access this call exists to remove.
    dbMocks.userUpdate.mockRejectedValue(new Error("connection lost"));

    await expect(login(["g-alumni"])).rejects.toThrow();
  });

  it("keeps the workspace owner's access", async () => {
    const result = await login(["g-alumni"], ["OWNER"]);

    expect(dbMocks.userOrganizationDeleteMany).not.toHaveBeenCalled();
    expect(dbMocks.userUpdate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      transitionType: "ROLE_CHANGE",
      newRole: "OWNER",
    });
  });

  it("lands the owner in the workspace they kept and repairs their team member", async () => {
    // The owner keeps access although no group claim maps, so this workspace
    // is still a valid landing org, and a missing team member is re-created
    // as for any login that keeps access.
    dbMocks.queryRaw.mockResolvedValue([{ id: "uo-1" }]);
    dbMocks.teamMemberFindFirst.mockResolvedValue(null);

    const result = await login(["g-alumni"], ["OWNER"]);

    expect(result.org).toMatchObject({ id: ORG_ID });
    expect(dbMocks.teamMemberCreate).toHaveBeenCalledWith({
      data: { name: "Jane Doe", organizationId: ORG_ID, userId: USER_ID },
      select: { id: true },
    });
  });

  it("keeps access when ownership was transferred to the user mid-login", async () => {
    // `currentRoles` still says BASE, but the owner guard inside
    // `revokeAccessToOrganization` sees OWNER and refuses. That refusal must
    // not fail the owner's login.
    dbMocks.userOrganizationFindFirst.mockResolvedValue({ roles: ["OWNER"] });

    const result = await login(["g-alumni"]);

    expect(dbMocks.userOrganizationDeleteMany).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      transitionType: "ROLE_CHANGE",
      newRole: "BASE",
    });
  });

  it("leaves a still-claimed workspace on the role-update path", async () => {
    dbMocks.queryRaw.mockResolvedValue([{ id: "uo-1" }]);
    dbMocks.teamMemberFindFirst.mockResolvedValue({ id: TEAM_MEMBER_ID });

    await login(["g-staff"]);

    expect(dbMocks.userUpdate).not.toHaveBeenCalled();
    expect(dbMocks.userOrganizationDeleteMany).not.toHaveBeenCalled();
    expect(dbMocks.userOrganizationUpdate).toHaveBeenCalledWith({
      where: {
        userId_organizationId: { userId: USER_ID, organizationId: ORG_ID },
      },
      data: { roles: { set: ["BASE"] } },
    });
  });

  describe("granting a workspace the user has no membership in", () => {
    beforeEach(() => {
      dbMocks.scimFindUnique.mockResolvedValue(null);
      dbMocks.userOrganizationUpsert.mockResolvedValue({});
    });

    it("re-uses a team member that is still linked", async () => {
      // A linked row can outlive the membership (created by another path, or
      // left by a revoke that did not unlink it); a second one would duplicate
      // the user as a custodian.
      dbMocks.teamMemberFindFirst.mockResolvedValue({ id: TEAM_MEMBER_ID });

      const result = await login(["g-staff"], null);

      expect(dbMocks.teamMemberFindFirst).toHaveBeenCalledWith({
        where: { userId: USER_ID, organizationId: ORG_ID, deletedAt: null },
        select: { id: true },
      });
      expect(dbMocks.teamMemberCreate).not.toHaveBeenCalled();
      expect(dbMocks.userOrganizationUpsert).toHaveBeenCalledTimes(1);
      expect(result.transitions[0]?.transitionType).toBe("ACCESS_GRANTED");
    });

    it("creates a team member when none is linked", async () => {
      dbMocks.teamMemberFindFirst.mockResolvedValue(null);

      await login(["g-staff"], null);

      expect(dbMocks.teamMemberCreate).toHaveBeenCalledWith({
        data: { name: "Jane Doe", organizationId: ORG_ID, userId: USER_ID },
        select: { id: true },
      });
    });
  });
});
