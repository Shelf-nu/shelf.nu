/**
 * Tests for the SCIM-deactivation guard inside `updateUserFromSSO`.
 *
 * When a workspace maps SSO groups to roles, an SSO login re-grants org
 * membership from the user's group claims. Without a guard, that would undo a
 * SCIM deactivation: a user the IdP switched off could log in during group
 * propagation lag and regain access, potentially as admin.
 *
 * The guard (`isScimDeactivated`) recognises a deactivated user by the shape
 * SCIM leaves behind — a `UserScimExternalId` mapping with no matching
 * `UserOrganization`. These tests exercise that guard directly; the existing
 * SSO tests in `~/utils/sso.server.test.ts` mock `updateUserFromSSO` and so
 * never reach it.
 *
 * @see {@link file://./service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Writes recorded by the stubbed delegates.
 *
 * `staged` holds what the current transaction callback has written; `committed`
 * holds what a callback that RESOLVED promoted. Asserting that a transaction
 * was merely opened proves nothing about atomicity — the property under test is
 * that a body which throws leaves nothing behind, so the tests read `committed`.
 */
const { staged, committed, txDepth } = vi.hoisted(() => ({
  staged: [] as string[],
  committed: [] as string[],
  txDepth: { value: 0 },
}));

// why: exercise the guard's real DB reads/writes without a database. The
// delegates record what they wrote so the transaction stub below can model
// commit-versus-rollback rather than just counting calls.
vi.mock("~/database/db.server", () => {
  const db = {
    user: { update: vi.fn() },
    // Drives isScimDeactivated: a row here (with no membership) = deactivated.
    userScimExternalId: { findUnique: vi.fn() },
    // createUserOrgAssociation upserts here when a grant proceeds.
    userOrganization: {
      upsert: vi.fn(() => {
        record("userOrganization");
        return Promise.resolve({});
      }),
      delete: vi.fn(),
      update: vi.fn(),
    },
    // A grant writes the org association and the team member together, so the
    // team-member record is reachable only through this delegate now.
    teamMember: {
      findFirst: vi.fn(),
      create: vi.fn(() => {
        record("teamMember");
        return Promise.resolve({ id: "tm-1" });
      }),
    },
    // The repair path locks the membership row before its check-and-create.
    $queryRaw: vi.fn().mockResolvedValue([{ id: "uo-1" }]),
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      txDepth.value += 1;
      staged.length = 0;
      try {
        const result = await cb(db);
        committed.push(...staged);
        return result;
      } finally {
        staged.length = 0;
        txDepth.value -= 1;
      }
    }),
  };

  /**
   * Records a write where it would actually land.
   *
   * Inside a transaction it is staged, and only a callback that resolves
   * promotes it. Outside one it is durable the moment it happens — which is
   * what makes a sequential pair of writes distinguishable from an atomic one.
   */
  function record(table: string) {
    (txDepth.value > 0 ? staged : committed).push(table);
  }

  return { db };
});

// why: the SSO org set is fetched from the organization module; stub it so the
// test controls which orgs (and group mappings) the login reconciles against
vi.mock("../organization/service.server", () => ({
  getOrganizationsBySsoDomain: vi.fn(),
}));

// why: other paths in the module under test reach the team-member service;
// stubbing it keeps them off a database. The SSO grant no longer goes through
// it — it writes the record inside its own transaction.
vi.mock("../team-member/service.server", () => ({
  createTeamMember: vi.fn(),
}));

const mockDb = await import("~/database/db.server");
const mockOrg = await import("../organization/service.server");
const mockTeam = await import("../team-member/service.server");

import { updateUserFromSSO } from "./service.server";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const EMAIL = "jane@corp.com";

/**
 * A domain org whose SSO details map the `g-admin` group to the ADMIN role.
 * `getRoleFromGroupId` (real, pure) turns `groups: ["g-admin"]` into ADMIN.
 */
function domainOrg() {
  return {
    id: ORG_ID,
    ssoDetails: {
      adminGroupId: "g-admin",
      baseUserGroupId: null,
      selfServiceGroupId: null,
    },
  };
}

/**
 * Invokes updateUserFromSSO with a user who has NO existing membership in the
 * matched org, so the login takes the "grant new access" branch — the one the
 * guard protects. firstName/lastName match to skip the profile-update path.
 */
/**
 * Runs an SSO login.
 *
 * @param overrides.userOrganizations - Memberships the user already holds.
 *   Empty (the default) exercises the grant path; a membership for the domain
 *   org exercises the existing-access path instead.
 */
function login(overrides: { userOrganizations?: unknown[] } = {}) {
  // Only the fields the function reads are supplied; cast to satisfy the
  // Prisma-derived parameter types without building a full user payload.
  return updateUserFromSSO(
    { email: EMAIL, userId: USER_ID } as Parameters<
      typeof updateUserFromSSO
    >[0],
    {
      id: USER_ID,
      firstName: "Jane",
      lastName: "Doe",
      userOrganizations: overrides.userOrganizations ?? [],
    } as unknown as Parameters<typeof updateUserFromSSO>[1],
    { firstName: "Jane", lastName: "Doe", groups: ["g-admin"] }
  );
}

describe("updateUserFromSSO — SCIM deactivation guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - vitest mock type
    mockOrg.getOrganizationsBySsoDomain.mockResolvedValue([domainOrg()]);
    // @ts-expect-error - vitest mock type
    mockTeam.createTeamMember.mockResolvedValue({});
    // Default: no team-member record yet, so a grant writes one.
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    staged.length = 0;
    committed.length = 0;
    txDepth.value = 0;
  });

  it("blocks the group-driven grant for a SCIM-deactivated user", async () => {
    // Mapping present, no membership → deactivated. The grant must be skipped.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue({ id: "map-1" });

    const result = await login();

    expect(mockDb.db.userOrganization.upsert).not.toHaveBeenCalled();
    expect(mockTeam.createTeamMember).not.toHaveBeenCalled();
    // And the blocked org must NOT be returned as the landing org, or the
    // callback sends the user to a 403 instead of /sso-pending-assignment.
    expect(result.org).toBeNull();
  });

  it("grants access on a normal SSO login for an unmanaged user", async () => {
    // No SCIM mapping → the user was never SCIM-provisioned here, so ordinary
    // group-driven provisioning proceeds untouched.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    const result = await login();

    expect(mockDb.db.userOrganization.upsert).toHaveBeenCalled();
    expect(mockDb.db.teamMember.create).toHaveBeenCalled();
    expect(result.org?.id).toBe(ORG_ID);
  });

  it("keeps both writes of a successful grant", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    await login();

    expect(committed).toEqual(["userOrganization", "teamMember"]);
  });

  it("keeps neither write when the team member cannot be created", async () => {
    // The state this change exists to prevent: access granted with no
    // team-member record. The next login would find that access and take the
    // branch that assumes the pair is intact, so it must never be reachable.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.create.mockRejectedValueOnce(
      new Error("constraint violation")
    );

    await expect(login()).rejects.toThrow();

    // Not "the transaction was opened" — nothing survived it.
    expect(committed).toEqual([]);
  });

  it("creates a missing team member for a user who already has access", async () => {
    // The repair path: an account left half-provisioned reaches the
    // existing-access branch on every later login, so that branch is the only
    // place it can be fixed.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);

    await login({
      userOrganizations: [
        { organization: { id: ORG_ID }, roles: [OrganizationRoles.ADMIN] },
      ],
    });

    expect(mockDb.db.teamMember.create).toHaveBeenCalled();
  });

  it("locks the membership row before repairing", async () => {
    // `TeamMember` has no uniqueness on (userId, organizationId), so two
    // logins arriving together would both find nothing and both insert. The
    // membership row does have it, so the lock is what serialises them.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);

    await login({
      userOrganizations: [
        { organization: { id: ORG_ID }, roles: [OrganizationRoles.ADMIN] },
      ],
    });

    const sql = (mockDb.db.$queryRaw as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as TemplateStringsArray;

    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(sql.join("?")).toContain('"UserOrganization"');
  });

  it("creates nothing when the membership disappeared under the lock", async () => {
    // The membership is read before the transition runs, so a concurrent
    // callback whose claims revoke access can delete the row in between. The
    // lock then finds nothing, and creating the record anyway would attach a
    // custodian to a workspace its user is no longer in.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.$queryRaw.mockResolvedValue([]);

    await login({
      userOrganizations: [
        { organization: { id: ORG_ID }, roles: [OrganizationRoles.ADMIN] },
      ],
    });

    expect(mockDb.db.teamMember.create).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });

  it("does not duplicate a team member that already exists", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue({ id: "tm-1" });

    await login({
      userOrganizations: [
        { organization: { id: ORG_ID }, roles: [OrganizationRoles.ADMIN] },
      ],
    });

    expect(mockDb.db.teamMember.create).not.toHaveBeenCalled();
  });

  // The guard recognises only SOFT deactivation (active:false), where the
  // mapping survives. A hard SCIM DELETE removes the mapping, so this same
  // login would look "unmanaged" and re-grant access. Closing that needs a
  // deletion tombstone / explicit lifecycle state — tracked in the SCIM polish
  // backlog — so it is deliberately left as a known gap here rather than a
  // passing assertion of insecure behaviour.
  it.todo(
    "blocks the group-driven grant after a hard SCIM DELETE (needs lifecycle tombstone)"
  );
});
