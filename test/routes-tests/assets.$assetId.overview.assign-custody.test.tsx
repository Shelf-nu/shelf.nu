import { OrganizationRoles, AssetStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  action,
  loader,
} from "~/routes/_layout+/assets.$assetId.overview.assign-custody";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";
import { getAsset } from "~/modules/asset/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { createNote } from "~/modules/note/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";

const dbMocks = vi.hoisted(() => {
  return {
    asset: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    teamMember: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
});

const teamMemberServiceMocks = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: dbMocks.asset.findUnique,
      update: dbMocks.asset.update,
    },
    teamMember: {
      findMany: dbMocks.teamMember.findMany,
      count: dbMocks.teamMember.count,
    },
  },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/asset/service.server", () => ({
  getAsset: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
}));

vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    json: vi.fn(
      (data, init) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

const mockAssetFindUnique = dbMocks.asset.findUnique;
const mockAssetUpdate = dbMocks.asset.update;
const mockTeamMemberFindMany = dbMocks.teamMember.findMany;
const mockTeamMemberCount = dbMocks.teamMember.count;
const mockGetTeamMember = teamMemberServiceMocks.getTeamMember;

const requirePermissionMock = vi.mocked(requirePermission);
const getAssetMock = vi.mocked(getAsset);
const getUserByIdMock = vi.mocked(getUserByID);
const createNoteMock = vi.mocked(createNote);
const sendNotificationMock = vi.mocked(sendNotification);

function createLoaderArgs(
  overrides: Partial<LoaderFunctionArgs> = {}
): LoaderFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    params: { assetId: "asset-123" },
    request: new Request(
      "https://example.com/assets/asset-123/overview/assign-custody"
    ),
    ...overrides,
  } as LoaderFunctionArgs;
}

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    params: { assetId: "asset-123" },
    request: new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST" }
    ),
    ...overrides,
  } as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockAssetFindUnique.mockReset();
  mockAssetUpdate.mockReset();
  mockTeamMemberFindMany.mockReset();
  mockTeamMemberCount.mockReset();
  mockGetTeamMember.mockReset();

  // Reset service mocks
  getAssetMock.mockReset();
  requirePermissionMock.mockReset();

  getUserByIdMock.mockResolvedValue({
    id: "user-123",
    firstName: "Test",
    lastName: "User",
  } as any);
  createNoteMock.mockResolvedValue(undefined as any);
  sendNotificationMock.mockReturnValue(undefined as any);
});

describe("assets.$assetId.overview.assign-custody loader", () => {
  it("rejects when the asset belongs to a different organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    const unauthorizedError = new ShelfError({
      cause: null,
      label: "Assets",
      message: "Asset not found",
      status: 404,
    });

    getAssetMock.mockRejectedValue(unauthorizedError);

    await expect(loader(createLoaderArgs())).rejects.toMatchObject({
      status: 404,
    });

    expect(getAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-123",
        organizationId: "org-1",
      })
    );
    expect(mockAssetFindUnique).not.toHaveBeenCalled();
    expect(mockTeamMemberFindMany).not.toHaveBeenCalled();
  });
});

describe("assets.$assetId.overview.assign-custody action", () => {
  it("does not allow assigning custody for foreign organization assets", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Valid custodian from same org
    mockGetTeamMember.mockResolvedValue({
      id: "team-123",
      userId: "user-456",
    });

    // Mock asset update to fail due to organization mismatch
    const unauthorizedError = new ShelfError({
      cause: null,
      label: "Assets",
      message: "Asset not found",
      status: 404,
    });

    mockAssetUpdate.mockRejectedValue(unauthorizedError);

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-123", name: "Team Member" })
    );

    const request = new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST", body: formData }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(404);

    expect(mockAssetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-123", organizationId: "org-1" },
      data: expect.any(Object),
      select: { id: true, title: true },
    });
    expect(createNoteMock).not.toHaveBeenCalled();
  });

  it("does not allow assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    // Asset validation passes (same org)
    getAssetMock.mockResolvedValue({
      id: "asset-123",
      organizationId: "org-1",
    } as any);

    // Custodian validation fails (different org)
    mockGetTeamMember.mockRejectedValue(new Error("Not found"));

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({
        id: "foreign-team-member-123",
        name: "Foreign Team Member",
      })
    );

    const request = new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST", body: formData }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(404);

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
      select: { id: true, userId: true },
    });

    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
  });

  it("allows assigning custody to team members from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    // Custodian validation passes (same org)
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      userId: "user-456",
    });

    // Asset update succeeds
    mockAssetUpdate.mockResolvedValue({
      id: "asset-123",
      title: "Test Asset",
      status: "IN_CUSTODY",
      user: {
        firstName: "Test",
        lastName: "User",
      },
    } as any);

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-member-123", name: "Valid Team Member" })
    );

    const request = new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST", body: formData }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302); // Redirect on success

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: { id: true, userId: true },
    });

    expect(mockAssetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-123", organizationId: "org-1" },
      data: expect.objectContaining({
        status: AssetStatus.IN_CUSTODY,
        custody: {
          create: {
            custodian: { connect: { id: "team-member-123" } },
          },
        },
      }),
      select: { id: true, title: true },
    });

    expect(createNoteMock).toHaveBeenCalled();
  });

  it("prevents self-service users from assigning custody to other team members", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    getAssetMock.mockResolvedValue({
      id: "asset-123",
      organizationId: "org-1",
    } as any);

    // Valid team member from same org, but different user
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456", // Different from current user
    });

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-member-456", name: "Other Team Member" })
    );

    const request = new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST", body: formData }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(500); // ShelfError defaults to 500

    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
  });
});
