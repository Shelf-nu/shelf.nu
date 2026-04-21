import { OrganizationRoles } from "@prisma/client";
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
    },
    teamMember: {
      updateMany: vi.fn(),
    },
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

const mockShelfUser = {
  id: "user-abc",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  scimExternalId: "entra-456",
  createdAt: new Date("2024-06-01T10:00:00Z"),
  updatedAt: new Date("2024-06-15T12:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────
// listScimUsers
// ──────────────────────────────────────────────

describe("listScimUsers", () => {
  it("should return a SCIM list response with pagination", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([mockShelfUser]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(1);

    const result = await listScimUsers(ORG_ID, {});

    expect(result.schemas).toEqual([SCIM_SCHEMA_LIST_RESPONSE]);
    expect(result.totalResults).toBe(1);
    expect(result.startIndex).toBe(1);
    expect(result.itemsPerPage).toBe(1);
    expect(result.Resources).toHaveLength(1);
    expect(result.Resources[0].userName).toBe("jane@example.com");
  });

  it("should default startIndex to 1 and count to 100", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, {});

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
      expect.objectContaining({
        skip: 10, // 11 - 1 (SCIM is 1-based)
        take: 10,
      })
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

  it("should clamp startIndex minimum to 1", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { startIndex: -5 });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0 })
    );
  });

  it("should apply userName filter to email query", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, {
      filter: 'userName eq "jane@example.com"',
    });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: "jane@example.com", mode: "insensitive" },
        }),
      })
    );
  });

  it("should apply externalId filter to scimExternalId query", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, {
      filter: 'externalId eq "entra-id-789"',
    });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scimExternalId: "entra-id-789",
        }),
      })
    );
  });

  it("should ignore unparseable filter strings", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findMany.mockResolvedValue([]);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.count.mockResolvedValue(0);

    await listScimUsers(ORG_ID, { filter: "not a valid filter" });

    expect(mockDb.db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userOrganizations: { some: { organizationId: ORG_ID } },
        },
      })
    );
  });
});

// ──────────────────────────────────────────────
// getScimUser
// ──────────────────────────────────────────────

describe("getScimUser", () => {
  it("should return a SCIM user when found with active org membership", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });

    const result = await getScimUser(ORG_ID, "user-abc");

    expect(result.id).toBe("user-abc");
    expect(result.active).toBe(true);
    expect(result.userName).toBe("jane@example.com");
  });

  it("should return active=false when user has no org membership", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [],
    });

    const result = await getScimUser(ORG_ID, "user-abc");

    expect(result.active).toBe(false);
  });

  it("should throw ScimError 404 when user does not exist", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);

    await expect(getScimUser(ORG_ID, "nonexistent")).rejects.toThrow(ScimError);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);
    await expect(getScimUser(ORG_ID, "nonexistent")).rejects.toThrow(
      "User not found"
    );
  });
});

// ──────────────────────────────────────────────
// createScimUser
// ──────────────────────────────────────────────

describe("createScimUser", () => {
  it("should throw 400 when no email is provided", async () => {
    await expect(createScimUser(ORG_ID, { userName: "" })).rejects.toThrow(
      ScimError
    );

    try {
      await createScimUser(ORG_ID, { userName: "" });
    } catch (err) {
      expect((err as ScimError).status).toBe(400);
    }
  });

  it("should throw 409 when user already exists in the organization", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });

    await expect(
      createScimUser(ORG_ID, { userName: "jane@example.com" })
    ).rejects.toThrow(ScimError);

    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });

    try {
      await createScimUser(ORG_ID, { userName: "jane@example.com" });
    } catch (err) {
      expect((err as ScimError).status).toBe(409);
      expect((err as ScimError).scimType).toBe("uniqueness");
    }
  });

  it("should attach existing user to org when user exists but not in org", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});

    const result = await createScimUser(ORG_ID, {
      userName: "jane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
      externalId: "entra-456",
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalledWith({
      data: {
        userId: "user-abc",
        organizationId: ORG_ID,
        roles: [OrganizationRoles.SELF_SERVICE],
      },
    });
    expect(mockTeamMemberService.createTeamMember).toHaveBeenCalledWith({
      name: "Jane Doe",
      organizationId: ORG_ID,
      userId: "user-abc",
    });
    expect(result.userName).toBe("jane@example.com");
  });

  it("should create a new user when user does not exist", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockUserService.createUser.mockResolvedValue({ id: "new-user-id" });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
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
      externalId: "entra-456",
    });

    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "jane@example.com",
        username: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        organizationId: ORG_ID,
        roles: [OrganizationRoles.SELF_SERVICE],
        isSSO: true,
        skipPersonalOrg: true,
      })
    );
    expect(result.id).toBe("new-user-id");
  });

  it("should use email from emails array when userName is missing", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);
    // @ts-expect-error - vitest mock type
    mockUserService.createUser.mockResolvedValue({ id: "new-user-id" });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      id: "new-user-id",
      email: "alt@example.com",
    });

    await createScimUser(ORG_ID, {
      userName: "",
      emails: [{ value: "alt@example.com", primary: true }],
    });

    expect(mockUserService.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alt@example.com" })
    );
  });

  it("should use email as team member name when no name is provided", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await createScimUser(ORG_ID, { userName: "jane@example.com" });

    expect(mockTeamMemberService.createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({ name: "jane@example.com" })
    );
  });

  it("should skip updating scimExternalId when not provided", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await createScimUser(ORG_ID, { userName: "jane@example.com" });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
// replaceScimUser
// ──────────────────────────────────────────────

describe("replaceScimUser", () => {
  it("should throw 404 when user does not exist", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);

    await expect(
      replaceScimUser(ORG_ID, "nonexistent", { userName: "a@b.com" })
    ).rejects.toThrow("User not found");
  });

  it("should update user attributes and team member name", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      firstName: "Janet",
    });

    await replaceScimUser(ORG_ID, "user-abc", {
      userName: "jane@example.com",
      name: { givenName: "Janet", familyName: "Doe" },
      externalId: "new-ext-id",
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: {
        firstName: "Janet",
        lastName: "Doe",
        scimExternalId: "new-ext-id",
      },
    });
    expect(mockDb.db.teamMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-abc", organizationId: ORG_ID },
      data: { name: "Janet Doe" },
    });
  });

  it("should deactivate user when active is false", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await replaceScimUser(ORG_ID, "user-abc", {
      userName: "jane@example.com",
      active: false,
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
  });

  it("should return 404 when user is not a member of the calling organization", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [], // not a member of ORG_ID
    });

    await expect(
      replaceScimUser(ORG_ID, "user-abc", {
        userName: "jane@example.com",
        active: true,
        name: { givenName: "Jane", familyName: "Doe" },
      })
    ).rejects.toThrow("User not found");

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockDb.db.userOrganization.create).not.toHaveBeenCalled();
  });

  it("should not change activation when already in desired state", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }], // already active
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await replaceScimUser(ORG_ID, "user-abc", {
      userName: "jane@example.com",
      active: true,
    });

    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
    expect(mockDb.db.userOrganization.create).not.toHaveBeenCalled();
  });

  it("should update email when userName changes", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValueOnce({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type: uniqueness check returns no conflict
    mockDb.db.user.findUnique.mockResolvedValueOnce(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    mockUpdateUserById.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      email: "newjane@example.com",
    });

    await replaceScimUser(ORG_ID, "user-abc", {
      userName: "NewJane@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
    });

    // Email update via helper
    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "newjane@example.com" },
    });
    // Supabase auth sync
    expect(mockUpdateUserById).toHaveBeenCalledWith("user-abc", {
      email: "newjane@example.com",
    });
  });

  it("should throw 409 when new email is already taken", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValueOnce({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type: uniqueness check finds a conflict
    mockDb.db.user.findUnique.mockResolvedValueOnce({ id: "other-user" });

    await expect(
      replaceScimUser(ORG_ID, "user-abc", {
        userName: "taken@example.com",
      })
    ).rejects.toThrow("already in use");
  });

  it("should skip Supabase auth update for users without auth account", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValueOnce({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type: uniqueness check returns no conflict
    mockDb.db.user.findUnique.mockResolvedValueOnce(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    mockUpdateUserById.mockRejectedValue(new Error("User not found"));
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      email: "new@example.com",
    });

    // Should not throw despite Supabase error
    await replaceScimUser(ORG_ID, "user-abc", {
      userName: "new@example.com",
      name: { givenName: "Jane", familyName: "Doe" },
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "new@example.com" },
    });
  });
});

// ──────────────────────────────────────────────
// patchScimUser
// ──────────────────────────────────────────────

describe("patchScimUser", () => {
  it("should throw 404 when user does not exist", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);

    await expect(
      patchScimUser(ORG_ID, "nonexistent", {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [],
      })
    ).rejects.toThrow("User not found");
  });

  it("should deactivate user via path-based active=false", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
  });

  it("should handle Entra ID format: value object with active field", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", value: { active: false } }],
    });

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalled();
  });

  it("should update name.givenName", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValueOnce({
      firstName: "Janet",
      lastName: "Doe",
      email: "jane@example.com",
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValueOnce(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "name.givenName", value: "Janet" }],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: expect.objectContaining({ firstName: "Janet" }),
    });
  });

  it("should update externalId", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "externalId", value: "new-ext-id" }],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: expect.objectContaining({ scimExternalId: "new-ext-id" }),
    });
  });

  it("should skip non-replace operations", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "add", path: "name.givenName", value: "Janet" },
        { op: "remove", path: "externalId" },
      ],
    });

    expect(mockDb.db.user.update).not.toHaveBeenCalled();
    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
  });

  it("should sync team member name after name change", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValueOnce({
      firstName: "Janet",
      lastName: "Smith",
      email: "jane@example.com",
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.teamMember.updateMany.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValueOnce({
      ...mockShelfUser,
      firstName: "Janet",
      lastName: "Smith",
    });

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "replace", path: "name.givenName", value: "Janet" },
        { op: "replace", path: "name.familyName", value: "Smith" },
      ],
    });

    expect(mockDb.db.teamMember.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-abc", organizationId: ORG_ID },
      data: { name: "Janet Smith" },
    });
  });

  it("should reactivate user via active=true when currently inactive", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [], // inactive
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: true }],
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalled();
    expect(mockTeamMemberService.createTeamMember).toHaveBeenCalled();
  });

  it("should handle active='True' string (Entra ID format)", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      ...mockShelfUser,
      userOrganizations: [], // inactive
    });
    // @ts-expect-error - vitest mock type
    mockDb.db.userOrganization.create.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockTeamMemberService.createTeamMember.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue(mockShelfUser);

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: "True" }],
    });

    expect(mockDb.db.userOrganization.create).toHaveBeenCalled();
  });

  it("should update email via userName path", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValueOnce({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type: uniqueness check
    mockDb.db.user.findUnique.mockResolvedValueOnce(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    mockUpdateUserById.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      email: "newemail@example.com",
    });

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "replace", path: "userName", value: "NewEmail@example.com" },
      ],
    });

    // Email update via helper (lowercased)
    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "newemail@example.com" },
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith("user-abc", {
      email: "newemail@example.com",
    });
  });

  it("should update email via unpathed value object with userName", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValueOnce({
      ...mockShelfUser,
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type: uniqueness check
    mockDb.db.user.findUnique.mockResolvedValueOnce(null);
    // @ts-expect-error - vitest mock type
    mockDb.db.user.update.mockResolvedValue({});
    mockUpdateUserById.mockResolvedValue({});
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUniqueOrThrow.mockResolvedValue({
      ...mockShelfUser,
      email: "updated@example.com",
    });

    await patchScimUser(ORG_ID, "user-abc", {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        {
          op: "replace",
          value: { userName: "Updated@example.com" },
        },
      ],
    });

    expect(mockDb.db.user.update).toHaveBeenCalledWith({
      where: { id: "user-abc" },
      data: { email: "updated@example.com" },
    });
    expect(mockUpdateUserById).toHaveBeenCalledWith("user-abc", {
      email: "updated@example.com",
    });
  });
});

// ──────────────────────────────────────────────
// deactivateScimUser
// ──────────────────────────────────────────────

describe("deactivateScimUser", () => {
  it("should throw 404 when user does not exist", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue(null);

    await expect(deactivateScimUser(ORG_ID, "nonexistent")).rejects.toThrow(
      "User not found"
    );
  });

  it("should revoke access when user has active membership", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      userOrganizations: [{ id: "uo-1" }],
    });
    // @ts-expect-error - vitest mock type
    mockUserService.revokeAccessToOrganization.mockResolvedValue(undefined);

    await deactivateScimUser(ORG_ID, "user-abc");

    expect(mockUserService.revokeAccessToOrganization).toHaveBeenCalledWith({
      userId: "user-abc",
      organizationId: ORG_ID,
    });
  });

  it("should be idempotent when user is already deactivated", async () => {
    // @ts-expect-error - vitest mock type
    mockDb.db.user.findUnique.mockResolvedValue({
      userOrganizations: [],
    });

    await deactivateScimUser(ORG_ID, "user-abc");

    expect(mockUserService.revokeAccessToOrganization).not.toHaveBeenCalled();
  });
});
