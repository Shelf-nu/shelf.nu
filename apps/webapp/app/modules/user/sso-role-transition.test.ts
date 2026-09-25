/**
 * SSO role transitions on login.
 *
 * A login whose IdP groups map to a different role runs the same steps as a
 * manual role change (lock the membership, write the role, move what the
 * change moves to the workspace owner, record it in `RoleChangeLog` with
 * `source: SSO`), all in one transaction. A membership holding OWNER is never
 * changed by a group mapping, and the workspace stays the login's landing org.
 *
 * Runs the real `updateUserFromSSO` -> `reconcileSsoGroupMembership` ->
 * `changeUserRole` / `transferOnRoleChange` -> `transferEntitiesToNewOwner`
 * chain against an in-memory database, then replays the booking writes onto
 * rows to check what the demoted user can still write to.
 *
 * @see {@link file://./service.server.ts} reconcileSsoGroupMembership
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeBookingRow } from "@helpers/in-memory-booking-rows";
import { applyUpdateMany } from "@helpers/in-memory-booking-rows";

// @vitest-environment node

/** A Prisma-style `updateMany` / `deleteMany` argument, as far as tests read it. */
type WriteArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

/** Membership lookup argument, by the compound unique or by the plain pair. */
type MembershipWhere = {
  where: {
    userId_organizationId?: { userId: string };
    userId?: string;
  };
};

const { memberships, dbMocks } = vi.hoisted(() => {
  /** Persisted roles per user id; a missing entry is no membership row. */
  const memberships = new Map<string, string[]>();
  const membershipRow = ({ where }: MembershipWhere) => {
    const userId = where.userId_organizationId?.userId ?? where.userId ?? "";
    const roles = memberships.get(userId);
    return Promise.resolve(roles ? { roles } : null);
  };
  const entityWrite = () =>
    vi.fn((_args: WriteArgs) => Promise.resolve({ count: 0 }));
  return {
    memberships,
    dbMocks: {
      userUpdate: vi.fn((_args: unknown) => Promise.resolve({ id: "user-1" })),
      membershipFindUnique: vi.fn(membershipRow),
      membershipFindFirst: vi.fn(membershipRow),
      membershipUpdate: vi.fn((_args: unknown) => Promise.resolve({})),
      membershipDeleteMany: vi.fn((_args: WriteArgs) =>
        Promise.resolve({ count: 1 })
      ),
      roleChangeLogCreate: vi.fn((_args: unknown) => Promise.resolve({})),
      teamMemberFindMany: vi.fn((_args: unknown) =>
        Promise.resolve([{ id: "tm-1" }])
      ),
      teamMemberFindFirst: vi.fn((_args: unknown) =>
        Promise.resolve({ id: "tm-1" })
      ),
      queryRaw: vi.fn((_sql: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve([{ id: "uo-1" }])
      ),
      executeRaw: vi.fn((_sql: TemplateStringsArray, ..._values: unknown[]) =>
        Promise.resolve(1)
      ),
      asset: entityWrite(),
      category: entityWrite(),
      tag: entityWrite(),
      location: entityWrite(),
      customField: entityWrite(),
      invite: entityWrite(),
      booking: entityWrite(),
      image: entityWrite(),
      kit: entityWrite(),
      assetReminder: entityWrite(),
    },
  };
});

// why: the login reads and writes memberships, entity owners, team members and
// the role-change log; an in-memory database lets the test observe every write
// the transition makes without Postgres. `$transaction` runs the callback on
// the same object, which is what a transaction client looks like to the code
// under test.
vi.mock("~/database/db.server", () => {
  const db = {
    user: { update: dbMocks.userUpdate },
    userScimExternalId: { findUnique: vi.fn().mockResolvedValue(null) },
    userOrganization: {
      findUnique: dbMocks.membershipFindUnique,
      findFirst: dbMocks.membershipFindFirst,
      update: dbMocks.membershipUpdate,
      updateMany: vi.fn(),
      deleteMany: dbMocks.membershipDeleteMany,
      upsert: vi.fn(),
    },
    roleChangeLog: { create: dbMocks.roleChangeLogCreate },
    teamMember: {
      findMany: dbMocks.teamMemberFindMany,
      findFirst: dbMocks.teamMemberFindFirst,
      create: vi.fn(),
    },
    $queryRaw: dbMocks.queryRaw,
    $executeRaw: dbMocks.executeRaw,
    asset: { updateMany: dbMocks.asset },
    category: { updateMany: dbMocks.category },
    tag: { updateMany: dbMocks.tag },
    location: { updateMany: dbMocks.location },
    customField: { updateMany: dbMocks.customField },
    invite: { updateMany: dbMocks.invite },
    booking: { updateMany: dbMocks.booking },
    image: { updateMany: dbMocks.image },
    kit: { updateMany: dbMocks.kit },
    assetReminder: { updateMany: dbMocks.assetReminder },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(db))
    ),
  };
  return { db };
});

// why: the SSO org set comes from the organization module; the test decides
// which workspace (and which group mappings) the login reconciles against
vi.mock("../organization/service.server", () => ({
  getOrganizationsBySsoDomain: vi.fn(),
}));

const { getOrganizationsBySsoDomain } = await import(
  "../organization/service.server"
);
import { updateUserFromSSO } from "./service.server";

const USER = "user-1";
const OWNER = "owner-1";
const ORG = "org-1";

const org = {
  id: ORG,
  userId: OWNER,
  ssoDetails: {
    adminGroupId: "g-admin",
    selfServiceGroupId: "g-ss",
    baseUserGroupId: "g-base",
  },
};

/**
 * Logs the user in with `groups`. `currentRoles` is the login's snapshot;
 * `persistedRoles` is what the membership row holds when the transition locks
 * it (defaults to the snapshot; `null` for no row).
 */
function login(
  currentRoles: string[],
  groups: string[],
  persistedRoles: string[] | null = currentRoles
) {
  memberships.set(OWNER, ["OWNER"]);
  if (persistedRoles) memberships.set(USER, persistedRoles);
  else memberships.delete(USER);
  return updateUserFromSSO(
    { email: "jane@corp.com", userId: USER } as Parameters<
      typeof updateUserFromSSO
    >[0],
    {
      id: USER,
      firstName: "Jane",
      lastName: "Doe",
      userOrganizations: [{ organization: { id: ORG }, roles: currentRoles }],
    } as unknown as Parameters<typeof updateUserFromSSO>[1],
    { firstName: "Jane", lastName: "Doe", groups }
  );
}

const bookingRows = (): FakeBookingRow[] => [
  {
    id: "for-registered",
    status: "RESERVED",
    organizationId: ORG,
    creatorId: USER,
    custodianUserId: "colleague",
    custodianTeamMemberId: "tm-c",
  },
  {
    id: "for-nrm",
    status: "RESERVED",
    organizationId: ORG,
    creatorId: USER,
    custodianUserId: null,
    custodianTeamMemberId: "tm-nrm",
  },
  {
    id: "own",
    status: "DRAFT",
    organizationId: ORG,
    creatorId: USER,
    custodianUserId: USER,
    custodianTeamMemberId: "tm-self",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  memberships.clear();
  vi.mocked(getOrganizationsBySsoDomain).mockResolvedValue([org] as never);
});

describe("SSO role transition: the same transfers as a manual change", () => {
  it("ADMIN mapped to SELF_SERVICE hands bookings made for registered custodians to the owner", async () => {
    await login(["ADMIN"], ["g-ss"]);

    const rows = bookingRows();
    for (const [call] of dbMocks.booking.mock.calls)
      applyUpdateMany(rows, call);
    // Write access to a booking is creator OR custodian; the demoted user is
    // now neither on the booking they made for a colleague.
    const writable = rows.filter(
      (r) => r.creatorId === USER || r.custodianUserId === USER
    );
    expect(writable.map((r) => r.id)).toEqual(["for-nrm", "own"]);
    expect(rows.find((r) => r.id === "for-registered")?.creatorId).toBe(OWNER);
  });

  it("moves ownership columns to the owner and records the change as SSO", async () => {
    await login(["ADMIN"], ["g-ss"]);

    expect(dbMocks.asset).toHaveBeenCalledWith({
      where: { userId: USER, organizationId: ORG },
      data: { userId: OWNER },
    });
    expect(dbMocks.membershipUpdate).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: USER, organizationId: ORG } },
      data: { roles: { set: ["SELF_SERVICE"] } },
    });
    expect(dbMocks.roleChangeLogCreate).toHaveBeenCalledWith({
      data: {
        userId: USER,
        changedById: USER,
        source: "SSO",
        organizationId: ORG,
        previousRole: "ADMIN",
        newRole: "SELF_SERVICE",
      },
    });
  });

  it("locks the membership first, then writes the role, then moves entities, then records the change", async () => {
    await login(["ADMIN"], ["g-ss"]);

    // The transition's lock is the FIRST $queryRaw of the login: any later one
    // (the team-member repair) comes after the transition has committed.
    const lockSql = dbMocks.queryRaw.mock.calls[0][0];
    expect(lockSql.join("?")).toContain("FOR UPDATE");
    expect(lockSql.join("?")).toContain('"UserOrganization"');

    const lock = dbMocks.queryRaw.mock.invocationCallOrder[0];
    const reread = dbMocks.membershipFindUnique.mock.invocationCallOrder[0];
    const roleWrite = dbMocks.membershipUpdate.mock.invocationCallOrder[0];
    const entityWrite = dbMocks.asset.mock.invocationCallOrder[0];
    const bookingWrite = dbMocks.booking.mock.invocationCallOrder[0];
    const log = dbMocks.roleChangeLogCreate.mock.invocationCallOrder[0];
    expect(lock).toBeLessThan(reread);
    expect(reread).toBeLessThan(roleWrite);
    expect(roleWrite).toBeLessThan(entityWrite);
    expect(roleWrite).toBeLessThan(bookingWrite);
    expect(entityWrite).toBeLessThan(log);
    expect(bookingWrite).toBeLessThan(log);
  });

  it("SELF_SERVICE mapped to BASE moves nothing but still records the change", async () => {
    await login(["SELF_SERVICE"], ["g-base"]);

    expect(dbMocks.booking).not.toHaveBeenCalled();
    expect(dbMocks.asset).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).toHaveBeenCalledTimes(1);
  });

  it("an unchanged role moves nothing and records nothing", async () => {
    await login(["ADMIN"], ["g-admin"]);

    expect(dbMocks.booking).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
  });

  it("[SELF_SERVICE, ADMIN] is read as ADMIN, so mapping it to BASE transfers", async () => {
    await login(["SELF_SERVICE", "ADMIN"], ["g-base"]);

    expect(dbMocks.booking).toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ previousRole: "ADMIN", newRole: "BASE" }),
    });
  });

  it("[BASE, ADMIN] mapped to ADMIN collapses the membership but records nothing", async () => {
    await login(["BASE", "ADMIN"], ["g-admin"]);

    expect(dbMocks.membershipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roles: { set: ["ADMIN"] } } })
    );
    expect(dbMocks.booking).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
  });
});

describe("SSO role transition: the owner's membership is never changed", () => {
  it.each([
    ["a lower mapping (ADMIN)", ["g-admin"]],
    ["a lower mapping (SELF_SERVICE)", ["g-ss"]],
    ["no matching group", ["unrelated"]],
  ])(
    "an owner logging in with %s stays OWNER, with no transfer, and lands on the workspace",
    async (_label, groups) => {
      const result = await login(["OWNER"], groups);

      expect(dbMocks.membershipUpdate).not.toHaveBeenCalled();
      expect(dbMocks.membershipDeleteMany).not.toHaveBeenCalled();
      expect(dbMocks.asset).not.toHaveBeenCalled();
      expect(dbMocks.booking).not.toHaveBeenCalled();
      expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
      expect(result.org?.id).toBe(ORG);
      expect(result.transitions[0]).toMatchObject({
        hasAccess: true,
        newRole: "OWNER",
      });
    }
  );

  it("a mixed membership holding OWNER is preserved as-is", async () => {
    const result = await login(["ADMIN", "OWNER"], ["g-ss"]);

    expect(dbMocks.membershipUpdate).not.toHaveBeenCalled();
    expect(result.transitions[0].previousRoles).toEqual(["ADMIN", "OWNER"]);
    expect(result.transitions[0].newRole).toBe("OWNER");
  });

  it("decides from the persisted membership: a login snapshot of ADMIN over a row that is now OWNER changes nothing", async () => {
    // Ownership was transferred to this user after the login read its roles.
    const result = await login(["ADMIN"], ["g-ss"], ["OWNER"]);

    expect(dbMocks.queryRaw).toHaveBeenCalled(); // the row was locked before deciding
    expect(dbMocks.membershipUpdate).not.toHaveBeenCalled();
    expect(dbMocks.asset).not.toHaveBeenCalled();
    expect(dbMocks.booking).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      hasAccess: true,
      newRole: "OWNER",
    });
  });

  it("no matching group, snapshot ADMIN but persisted OWNER: stays OWNER and is the landing org", async () => {
    const result = await login(["ADMIN"], ["unrelated"], ["OWNER"]);

    expect(dbMocks.membershipDeleteMany).not.toHaveBeenCalled();
    expect(dbMocks.membershipUpdate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      transitionType: "ROLE_CHANGE",
      hasAccess: true,
      newRole: "OWNER",
    });
    expect(result.org?.id).toBe(ORG);
  });
});

describe("SSO role transition: a membership that is gone or revoked", () => {
  it("no matching group, membership deleted concurrently: reported revoked and not the landing org", async () => {
    const result = await login(["ADMIN"], ["unrelated"], null);

    expect(dbMocks.membershipDeleteMany).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      transitionType: "ACCESS_REVOKED",
      hasAccess: false,
    });
    expect(result.org).toBeNull();
  });

  it("no matching group for a plain member: revoked the same way the admin path revokes", async () => {
    const result = await login(["SELF_SERVICE"], ["unrelated"]);

    // revokeMembershipInTx: owner-safe delete and every linked team member
    // disconnected
    expect(dbMocks.membershipDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER,
        organizationId: ORG,
        NOT: { roles: { has: "OWNER" } },
      },
    });
    expect(dbMocks.userUpdate).toHaveBeenCalledWith({
      where: { id: USER },
      data: { teamMembers: { disconnect: [{ id: "tm-1" }] } },
    });
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({
      transitionType: "ACCESS_REVOKED",
      hasAccess: false,
    });
    expect(result.org).toBeNull();
  });

  it("a membership revoked between the snapshot and the lock is reported as revoked, with nothing written", async () => {
    const result = await login(["ADMIN"], ["g-ss"], null);

    expect(dbMocks.membershipUpdate).not.toHaveBeenCalled();
    expect(dbMocks.asset).not.toHaveBeenCalled();
    expect(dbMocks.roleChangeLogCreate).not.toHaveBeenCalled();
    expect(result.transitions[0]).toMatchObject({ hasAccess: false });
    expect(result.org).toBeNull();
  });
});
