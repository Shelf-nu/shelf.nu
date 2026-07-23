import { OrganizationRoles } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScimError } from "~/modules/scim/errors.server";
import {
  createScimUser,
  deactivateScimUser,
  getScimUser,
  listScimUsers,
  patchScimUser,
  replaceScimUser,
} from "~/modules/scim/service.server";
import { SCIM_SCHEMA_LIST_RESPONSE } from "~/modules/scim/types";

// why: testing SCIM service business logic without actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    userOrganization: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    // The SCIM resource identity/mapping table. Post-#2 the SCIM id is the
    // per-org external id, so GET/PUT/PATCH/DELETE resolve through here.
    userScimExternalId: {
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    teamMember: {
      updateMany: vi.fn(),
      // Reactivation reuses an already-linked team member instead of creating
      // a duplicate, so the grant path reads and renames through these.
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    // Used by the SSO-domain gate on every provisioning path
    organization: {
      findUnique: vi.fn(),
    },
    // Soft deactivation clears `lastSelectedOrganizationId` via raw SQL
    $executeRaw: vi.fn(),
  },
}));

// why: isolate SCIM service from user module side effects
vi.mock("~/modules/user/service.server", () => ({
  createUser: vi.fn(),
  revokeAccessToOrganization: vi.fn(),
}));

// why: isolate SCIM service from team member creation side effects
vi.mock("~/modules/team-member/service.server", () => ({
  createTeamMember: vi.fn(),
}));

// why: isolate SCIM service from Supabase auth admin API
const mockUpdateUserById = vi.fn();
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { updateUserById: mockUpdateUserById } },
  }),
}));

const mockDb = await import("~/database/db.server");
const mockUserService = await import("~/modules/user/service.server");
const mockTeamMemberService = await import(
  "~/modules/team-member/service.server"
);

const ORG_ID = "org-123";
const ORG_DOMAIN = "example.com";
// The SCIM resource id IS the per-org external id (Entra object id).
const SCIM_ID = "entra-456";

const mockShelfUser = {
  id: "user-abc",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  scimExternalIds: [{ scimExternalId: SCIM_ID }],
  createdAt: new Date("2024-06-01T10:00:00Z"),
  updatedAt: new Date("2024-06-15T12:00:00Z"),
};

/**
 * Builds the result of the mapping lookup (`db.userScimExternalId.findUnique`)
 * that `findScimResourceOrThrow` performs: `{ user }` with the org-scoped
 * membership (drives `active`) and total membership count (shared-identity
 * guard). Pass `userOrganizations: []` to model a deactivated user.
 */
function scimMapping(
  userOverrides: Record<string, unknown> = {},
  orgCount = 1
): { user: Record<string, unknown> } {
  return {
    user: {
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
      _count: { userOrganizations: orgCount },
      ...userOverrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the calling org has example.com as its verified SSO domain, so the
  // default @example.com test emails pass the domain gate. Individual tests
  // override this to exercise rejection paths.
  // @ts-expect-error - vitest mock type
  mockDb.db.organization.findUnique.mockResolvedValue({
    ssoDetails: { domain: ORG_DOMAIN },
  });
});

// ──────────────────────────────────────────────
// listScimUsers
// ──────────────────────────────────────────────

describe("listScimUsers", () => {
  it("should return a SCIM list keyed off the external id", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([
      { ...mockShelfUser, userOrganizations: [{ id: "uo-1" }] },
    ]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(1);

    const result = await listScimUsers(ORG_ID, {});

    expect(result.schemas).toEqual([SCIM_SCHEMA_LIST_RESPONSE]);
    expect(result.totalResults).toBe(1);
    expect(result.Resources).toHaveLength(1);
    expect(result.Resources[0].id).toBe(SCIM_ID);
    expect(result.Resources[0].userName).toBe("jane@example.com");
    expect(result.Resources[0].active).toBe(true);
  });

  it("should mark a mapped user with no membership as inactive", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([
      { ...mockShelfUser, userOrganizations: [] },
    ]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(1);

    const result = await listScimUsers(ORG_ID, {});

    expect(result.Resources[0].active).toBe(false);
  });

  it("should scope the query to users with a mapping for the org", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, {});

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scimExternalIds: { some: { organizationId: ORG_ID } },
        }),
        skip: 0,
        take: 100,
      })
    );
  });

  it("should respect custom startIndex and count", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { startIndex: 11, count: 10 });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 })
    );
  });

  it("should clamp count to max 100", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { count: 500 });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 })
    );
  });

  it("should apply userName filter to email query", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { filter: 'userName eq "jane@example.com"' });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: "jane@example.com", mode: "insensitive" },
        }),
      })
    );
  });

  it("should apply externalId filter to scimExternalIds relation query", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { filter: `externalId eq "${SCIM_ID}"` });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scimExternalIds: {
            some: { organizationId: ORG_ID, scimExternalId: SCIM_ID },
          },
        }),
      })
    );
  });

  it("should reject an unparseable filter with 400 instead of listing everyone", async () => {
    await expect(
      listScimUsers(ORG_ID, { filter: "not a valid filter" })
    ).rejects.toMatchObject({ status: 400, scimType: "invalidFilter" });

    expect(mockDb.db.user.findMany).not.toHaveBeenCalled();
  });

  it("should reject a filter on an unsupported attribute with 400", async () => {
    await expect(
      listScimUsers(ORG_ID, { filter: 'displayName eq "Jane"' })
    ).rejects.toThrow(ScimError);

    expect(mockDb.db.user.findMany).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// getScimUser
// ──────────────────────────────────────────────

describe("getScimUser", () => {
  it("should return an active user resolved by external id", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());

    const result = await getScimUser(ORG_ID, SCIM_ID);

    expect(result.id).toBe(SCIM_ID);
    expect(result.active).toBe(true);
    expect(result.userName).toBe("jane@example.com");
  });

  it("should return active:false for a deactivated (mapping, no membership) user", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(
      scimMapping({ userOrganizations: [] })
    );

    const result = await getScimUser(ORG_ID, SCIM_ID);

    expect(result.id).toBe(SCIM_ID);
    expect(result.active).toBe(false);
  });

  it("should throw 404 when no mapping exists for the id", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    await expect(getScimUser(ORG_ID, "unknown-id")).rejects.toThrow(
      "User not found"
    );
  });
});

// ──────────────────────────────────────────────
// createScimUser
// ──────────────────────────────────────────────

describe("createScimUser", () => {
  it("should throw 400 when no email is provided", async () => {
    await expect(
      createScimUser(ORG_ID, { userName: "", externalId: SCIM_ID })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("should throw 400 when no externalId is provided", async () => {
    await expect(
      createScimUser(ORG_ID, { userName: "jane@example.com" })
    ).rejects.toMatchObject({ status: 400, scimType: "invalidValue" });

    expect(mockUserService.createUser).not.toHaveBeenCalled();
  });

  it("should throw 409 when the user is already mapped in the org", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      scimExternalIds: [{ scimExternalId: SCIM_ID }],
      userOrganizations: [{ id: "uo-1" }],
    });

    await expect(
      createScimUser(ORG_ID, {
        userName: "jane@example.com",
        externalId: SCIM_ID,
      })
    ).rejects.toMatchObject({ status: 409, scimType: "uniqueness" });
  });

  it("should attach + map an existing user who is not yet in the org", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      scimExternalIds: [],
      userOrganizations: [],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
      externalId: SCIM_ID,
    });

    // Membership granted + mapping created
    expect(mockDb.db.userOrganization.create).toHaveBeenCalledWith({
      data: {
        userId: "user-abc",
        organizationId: ORG_ID,
        roles: [OrganizationRoles.SELF_SERVICE],
      },
    });
    expect(mockDb.db.userScimExternalId.create).toHaveBeenCalledWith({
      data: {
        userId: "user-abc",
        organizationId: ORG_ID,
        scimExternalId: SCIM_ID,
      },
    });
    expect(result.id).toBe(SCIM_ID);
  });

  it("should adopt an existing member without re-granting membership", async () => {
    // Existing member (has membership) but no SCIM mapping → adopt: map only.
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      scimExternalIds: [],
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      externalId: SCIM_ID,
    });

    expect(mockDb.db.userOrganization.create).not.toHaveBeenCalled();
    expect(mockDb.db.userScimExternalId.create).toHaveBeenCalled();
  });

  it("should create a new user, mapping and team member", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockUserService.createUser.mockResolvedValue({ id: "new-user-id" });
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      id: "new-user-id",
    });

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
      externalId: SCIM_ID,
    });

    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jane@example.com",
        isSSO: true,
        skipPersonalOrg: true,
        roles: [OrganizationRoles.SELF_SERVICE],
      })
    );
    expect(mockDb.db.userScimExternalId.create).toHaveBeenCalledWith({
      data: {
        userId: "new-user-id",
        organizationId: ORG_ID,
        scimExternalId: SCIM_ID,
      },
    });
    expect(result.id).toBe(SCIM_ID);
  });

  it("should provision a user with active:false without granting access", async () => {
    // An IdP may provision an already-suspended account. Creating it with
    // membership would hand a disabled user working Shelf access.
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockUserService.createUser.mockResolvedValue({ id: "new-user-id" });
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      id: "new-user-id",
    });

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      externalId: SCIM_ID,
      active: false,
    });

    // Empty roles => createUser skips the UserOrganization association.
    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ roles: [] })
    );
    // No team member either — that link is what notification paths read.
    expect(mockTeamMemberService.createTeamMember).not.toHaveBeenCalled();
    // The mapping is still created, so the IdP can address and later enable them.
    expect(mockDb.db.userScimExternalId.create).toHaveBeenCalled();
    expect(result.active).toBe(false);
  });

  it("should not grant membership when adopting an existing user as inactive", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      scimExternalIds: [],
      userOrganizations: [],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      externalId: SCIM_ID,
      active: false,
    });

    expect(mockDb.db.userOrganization.create).not.toHaveBeenCalled();
    expect(mockTeamMemberService.createTeamMember).not.toHaveBeenCalled();
    expect(result.active).toBe(false);
  });

  it("should revoke access when adopting an existing MEMBER as inactive", async () => {
    // Adoption makes SCIM authoritative, so an active:false POST must not return
    // an active user. An existing member is revoked so the state matches the
    // request (otherwise a suspended identity keeps access).
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      scimExternalIds: [],
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      externalId: SCIM_ID,
      active: false,
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
    expect(result.active).toBe(false);
  });

  it("should reject provisioning an email outside the org's SSO domain (400)", async () => {
    await expect(
      createScimUser(ORG_ID, {
        userName: "intruder@attacker.test",
        externalId: SCIM_ID,
      })
    ).rejects.toMatchObject({ status: 400, scimType: "invalidValue" });

    expect(mockDb.db.user.findUnique).not.toHaveBeenCalled();
    expect(mockUserService.createUser).not.toHaveBeenCalled();
  });

  it("should reject provisioning when the org has no verified SSO domain (400)", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.organization.findUnique.mockResolvedValue({ ssoDetails: null });

    await expect(
      createScimUser(ORG_ID, {
        userName: "jane@example.com",
        externalId: SCIM_ID,
      })
    ).rejects.toThrow(ScimError);

    expect(mockUserService.createUser).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// replaceScimUser (PUT)
// ──────────────────────────────────────────────

describe("replaceScimUser", () => {
  it("should throw 404 when no mapping exists", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    await expect(
      replaceScimUser(ORG_ID, "unknown-id", { userName: "a@example.com" })
    ).rejects.toThrow("User not found");
  });

  it("should update attributes and team member name for an active member", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});

    await replaceScimUser(ORG_ID, SCIM_ID, {
      userName: "jane@example.com",
      name: { givenName: "Janet", familyName: "Doe" },
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { firstName: "Janet", lastName: "Doe" },
    });
    expect(mockDb.db.teamMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-abc", organizationId: ORG_ID },
      data: { name: "Janet Doe" },
    });
  });

  it("should deactivate (revoke membership) when active is false", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);

    const result = await replaceScimUser(ORG_ID, SCIM_ID, {
      userName: "jane@example.com",
      active: false,
    });

    // Deactivation must go through the full revoke, which also disconnects the
    // team member. That link is what the notification paths read to decide who
    // receives this org's emails, so leaving it in place would keep sending
    // booking and reminder mail to a deprovisioned user.
    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
    expect(result.active).toBe(false);
  });

  it("should reactivate (re-grant membership) when active is true on an inactive user", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // No team member is linked yet, so the grant provisions a fresh one.
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});

    const result = await replaceScimUser(ORG_ID, SCIM_ID, {
      userName: "jane@example.com",
      active: true,
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalledWith({
      data: {
        userId: "user-abc",
        organizationId: ORG_ID,
        roles: [OrganizationRoles.SELF_SERVICE],
      },
    });
    expect(mockTeamMemberService.createTeamMember).toHaveBeenCalled();
    expect(result.active).toBe(true);
  });

  it("should update email + Supabase auth for a sole-org user", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type: uniqueness check returns no conflict
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    mockUpdateUserById.mockResolvedValue({});

    await replaceScimUser(ORG_ID, SCIM_ID, {
      userName: "NewJane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "newjane@example.com" },
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith("user-abc", {
      email: "newjane@example.com",
    });
  });

  it("should throw 409 when the new email is already taken", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type: uniqueness check finds a conflict
    mockDb.db.user.findUnique.mockResolvedValue({ id: "other-user" });

    await expect(
      replaceScimUser(ORG_ID, SCIM_ID, { userName: "taken@example.com" })
    ).rejects.toThrow("already in use");
  });

  it("should throw 409 when the email is claimed after the uniqueness pre-check", async () => {
    // Lost race: the pre-check sees no conflict, then a concurrent request
    // claims the address before our UPDATE lands. The unique constraint fires,
    // and it must surface as the same 409 — a 500 reads as a transient fault,
    // so the IdP would retry a request that can never succeed.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type: pre-check finds nothing
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockRejectedValue(
      new PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.3",
      })
    );

    await expect(
      replaceScimUser(ORG_ID, SCIM_ID, { userName: "taken@example.com" })
    ).rejects.toMatchObject({
      status: 409,
      scimType: "uniqueness",
      message: expect.stringContaining("already in use"),
    });
  });

  it("should reject an email change outside the org's SSO domain (400)", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());

    await expect(
      replaceScimUser(ORG_ID, SCIM_ID, { userName: "evil@attacker.test" })
    ).rejects.toMatchObject({ status: 400 });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("should NOT mutate the global identity of a user in multiple orgs", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(
      scimMapping({}, 2)
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});

    await replaceScimUser(ORG_ID, SCIM_ID, {
      userName: "newjane@example.com",
      name: { givenName: "Janet", familyName: "Doe" },
    });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    // org-scoped team member name still updated (active → active)
    expect(mockDb.db.teamMember.updateMany).toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// patchScimUser
// ──────────────────────────────────────────────

const PATCH_SCHEMA = ["urn:ietf:params:scim:api:messages:2.0:PatchOp"] as [
  "urn:ietf:params:scim:api:messages:2.0:PatchOp",
];

describe("patchScimUser", () => {
  it("should throw 404 when no mapping exists", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    await expect(
      patchScimUser(ORG_ID, "unknown-id", {
        schemas: PATCH_SCHEMA,
        Operations: [],
      })
    ).rejects.toThrow("User not found");
  });

  it("should deactivate via path-based active=false", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);

    const result = await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "active", value: false }],
    });

    // Full revoke, so the team member is disconnected and the deprovisioned
    // user stops receiving this org's notification emails.
    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
    expect(result.active).toBe(false);
  });

  it("should deactivate when Entra sends a title-cased 'Replace' op", async () => {
    // Regression: the op check must be case-insensitive (Entra's default).
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "Replace", path: "active", value: false }],
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalled();
  });

  it("should deactivate via Entra value-object form", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", value: { active: false } }],
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalled();
  });

  it("should reactivate a deactivated user via active=true", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});

    const result = await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "active", value: true }],
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalledWith({
      data: {
        userId: "user-abc",
        organizationId: ORG_ID,
        roles: [OrganizationRoles.SELF_SERVICE],
      },
    });
    expect(result.active).toBe(true);
  });

  it("should reuse a team member that is still linked rather than duplicating it", async () => {
    // Idempotency guard on the grant path: when a linked team member already
    // exists, rename it instead of adding a second row.
    //
    // NOTE: this does NOT cover deactivate → reactivate. Deactivation performs a
    // full revoke, which disconnects the team member (required so notification
    // paths stop emailing a deprovisioned user), and an orphaned row cannot be
    // found by userId. Reactivation therefore provisions a NEW team member — an
    // accepted limitation until the mapping records its team member id. See the
    // test below.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue({ id: "tm-1" });
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.update.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "active", value: true }],
    });

    expect(mockDb.db.teamMember.update).toHaveBeenCalledWith({
      where: { id: "tm-1", organizationId: ORG_ID },
      data: { name: "Jane Doe" },
    });
    expect(mockTeamMemberService.createTeamMember).not.toHaveBeenCalled();
  });

  it("should provision a new team member when reactivating an orphaned one", async () => {
    // Documents the accepted trade: deactivation disconnects the team member so
    // the deprovisioned user stops receiving this org's emails, which means the
    // row can no longer be found by userId on reactivation. The person's prior
    // custody/booking history stays on the orphan until the SCIM mapping records
    // its team member id.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // Orphaned row: userId is null, so the org-scoped lookup finds nothing.
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "active", value: true }],
    });

    expect(mockTeamMemberService.createTeamMember).toHaveBeenCalled();
    expect(mockDb.db.teamMember.update).not.toHaveBeenCalled();
  });

  it("should activate on a lowercase 'true' string rather than deactivating", async () => {
    // Regression: `active` arrives as a boolean (Okta), "True" (Entra) or
    // "true" (others). Matching only one spelling resolved the rest to false,
    // so an ACTIVATION request silently deactivated the user.
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValueOnce(
      scimMapping()
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.findFirst.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});

    const result = await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "Replace", path: "active", value: "true" }],
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalled();
    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
    expect(result.active).toBe(true);
  });

  it("should leave the active state untouched when the value is unrecognised", async () => {
    // An absent or junk `value` must not be read as "deactivate".
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());

    const result = await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "active" }],
    });

    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
    expect(result.active).toBe(true);
  });

  it("should update name.givenName", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "name.givenName", value: "Janet" }],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: expect.objectContaining({ firstName: "Janet" }),
    });
  });

  it("should apply Add ops for attributes and ignore remove/unknown ops", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [
        { op: "Add", path: "name.givenName", value: "Janet" },
        { op: "remove", path: "displayName" },
      ],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: expect.objectContaining({ firstName: "Janet" }),
    });
  });

  it("should ignore an externalId op (the SCIM id is immutable)", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [{ op: "replace", path: "externalId", value: "new-ext-id" }],
    });

    expect(mockDb.db.userScimExternalId.create).not.toHaveBeenCalled();
    expect(mockDb.db.user.update).not.toHaveBeenCalled();
  });

  it("should update email via userName path for a sole-org user", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type: uniqueness check
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    mockUpdateUserById.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [
        { op: "replace", path: "userName", value: "NewEmail@example.com" },
      ],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "newemail@example.com" },
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith("user-abc", {
      email: "newemail@example.com",
    });
  });

  it("should reject an email change outside the org's SSO domain (400)", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());

    await expect(
      patchScimUser(ORG_ID, SCIM_ID, {
        schemas: PATCH_SCHEMA,
        Operations: [
          { op: "replace", path: "userName", value: "evil@attacker.test" },
        ],
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  it("should NOT mutate the global identity of a user in multiple orgs", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(
      scimMapping({}, 2)
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});

    await patchScimUser(ORG_ID, SCIM_ID, {
      schemas: PATCH_SCHEMA,
      Operations: [
        { op: "replace", path: "userName", value: "newjane@example.com" },
        { op: "replace", path: "name.givenName", value: "Janet" },
      ],
    });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockDb.db.teamMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-abc", organizationId: ORG_ID },
      data: { name: "Janet Doe" },
    });
  });
});

// ──────────────────────────────────────────────
// deactivateScimUser (DELETE)
// ──────────────────────────────────────────────

describe("deactivateScimUser", () => {
  it("should throw 404 when no mapping exists", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(null);

    await expect(deactivateScimUser(ORG_ID, "unknown-id")).rejects.toThrow(
      "User not found"
    );
  });

  it("should revoke access and remove the mapping for an active member", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(scimMapping());
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.deleteMany.mockResolvedValue({});

    await deactivateScimUser(ORG_ID, SCIM_ID);

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
    expect(mockDb.db.userScimExternalId.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, scimExternalId: SCIM_ID },
    });
  });

  it("should remove the mapping without revoking when already deactivated", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.findUnique.mockResolvedValue(
      scimMapping({ userOrganizations: [] })
    );
    // @ts-expect-error - vitest mock type
    mockDb.db.userScimExternalId.deleteMany.mockResolvedValue({});

    await deactivateScimUser(ORG_ID, SCIM_ID);

    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
    expect(mockDb.db.userScimExternalId.deleteMany).toHaveBeenCalled();
  });
});
