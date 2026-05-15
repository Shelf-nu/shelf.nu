import { OrganizationRoles, AssetStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOrganization } from "@factories";
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
      findFirstOrThrow: vi.fn(),
      update: vi.fn(),
    },
    teamMember: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    organization: {
      // why: action reads organization custody-signing settings before assignment
      findUniqueOrThrow: vi.fn(),
    },
    custody: {
      // why: action now clears stale custody before assignment
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
});

const teamMemberServiceMocks = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
}));

const signedCustodyMocks = vi.hoisted(() => ({
  createSignedCustodyRequests: vi.fn(),
  sendSignedCustodyRequestEmails: vi.fn(),
  shouldRequestSignedCustody: vi.fn(),
}));

// why: testing route handler without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: dbMocks.asset.findUnique,
      findFirstOrThrow: dbMocks.asset.findFirstOrThrow,
      update: dbMocks.asset.update,
    },
    teamMember: {
      findMany: dbMocks.teamMember.findMany,
      count: dbMocks.teamMember.count,
    },
    organization: {
      findUniqueOrThrow: dbMocks.organization.findUniqueOrThrow,
    },
    custody: {
      deleteMany: dbMocks.custody.deleteMany,
    },
    // why: action wraps custody cleanup + assignment in a transaction
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      cb({
        custody: { deleteMany: dbMocks.custody.deleteMany },
        asset: {
          findFirstOrThrow: dbMocks.asset.findFirstOrThrow,
          update: dbMocks.asset.update,
        },
      })
    ),
  },
}));

// why: testing authorization logic without executing actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: testing custody assignment without executing actual asset service operations
vi.mock("~/modules/asset/service.server", () => ({
  getAsset: vi.fn(),
}));

// why: testing custody assignment without fetching actual user data
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: testing team member organization validation without database lookups
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
}));

// why: testing signed-custody branching without sending emails or writing request rows
vi.mock("~/modules/custody/signed-custody.server", () => ({
  createSignedCustodyRequests: signedCustodyMocks.createSignedCustodyRequests,
  sendSignedCustodyRequestEmails:
    signedCustodyMocks.sendSignedCustodyRequestEmails,
  shouldRequestSignedCustody: signedCustodyMocks.shouldRequestSignedCustody,
}));

// why: testing custody assignment without creating actual notes
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

// why: testing custody assignment without executing actual activity event recording
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
  recordEvents: vi.fn().mockResolvedValue(undefined),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: mocking redirect, json, and data response helpers for testing route handler status codes
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  const mockResponse = (data: any, init?: { status?: number }) =>
    new Response(JSON.stringify(data), {
      status: init?.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    json: vi.fn(mockResponse),
    data: vi.fn(mockResponse),
  };
});

const mockAssetFindUnique = dbMocks.asset.findUnique;
const mockAssetFindFirstOrThrow = dbMocks.asset.findFirstOrThrow;
const mockAssetUpdate = dbMocks.asset.update;
const mockTeamMemberFindMany = dbMocks.teamMember.findMany;
const mockTeamMemberCount = dbMocks.teamMember.count;
const mockOrganizationFindUniqueOrThrow =
  dbMocks.organization.findUniqueOrThrow;
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
  mockAssetFindFirstOrThrow.mockReset();
  mockAssetUpdate.mockReset();
  mockTeamMemberFindMany.mockReset();
  mockTeamMemberCount.mockReset();
  mockOrganizationFindUniqueOrThrow.mockReset();
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
  signedCustodyMocks.createSignedCustodyRequests.mockResolvedValue([
    {
      token: "signed-request-token",
      asset: { title: "Test Asset" },
    },
  ]);
  signedCustodyMocks.sendSignedCustodyRequestEmails.mockResolvedValue(
    undefined
  );
  signedCustodyMocks.shouldRequestSignedCustody.mockReturnValue(false);
  mockOrganizationFindUniqueOrThrow.mockResolvedValue(
    createOrganization({
      id: "org-1",
      name: "Test Org",
      customEmailFooter: null,
      enableSignedCustodyOnAssignment: false,
      requireCustodySignatureOnAssignment: false,
    })
  );
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

    expect((response as Response).status).toBe(404);

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

    expect((response as Response).status).toBe(404);

    expect(mockGetTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "foreign-team-member-123",
        organizationId: "org-1",
      })
    );

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

    expect((response as Response).status).toBe(302); // Redirect on success

    expect(mockGetTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "team-member-123",
        organizationId: "org-1",
      })
    );

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

  it("creates a pending signed custody request instead of assigning custody immediately when a signature is required", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      name: "Valid Team Member",
      userId: "user-456",
      user: {
        id: "user-456",
        email: "custodian@example.com",
        firstName: "Valid",
        lastName: "Member",
        displayName: "Valid Member",
      },
    });

    mockAssetFindFirstOrThrow.mockResolvedValue({
      id: "asset-123",
      title: "Test Asset",
      status: AssetStatus.AVAILABLE,
    });

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-member-123", name: "Valid Team Member" })
    );
    formData.set("requireSignedCustody", "on");

    const request = new Request(
      "https://example.com/assets/asset-123/overview/assign-custody",
      { method: "POST", body: formData }
    );

    const response = await action(createActionArgs({ request }));

    expect((response as Response).status).toBe(302);
    expect(mockAssetFindFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "asset-123", organizationId: "org-1" },
      select: { id: true, title: true, status: true },
    });
    expect(signedCustodyMocks.createSignedCustodyRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        assets: [
          {
            id: "asset-123",
            title: "Test Asset",
            status: AssetStatus.AVAILABLE,
          },
        ],
        organizationId: "org-1",
        teamMember: expect.objectContaining({
          id: "team-member-123",
          name: "Valid Team Member",
          user: expect.objectContaining({
            email: "custodian@example.com",
          }),
        }),
      })
    );
    expect(
      signedCustodyMocks.sendSignedCustodyRequestEmails
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "custodian@example.com",
        organizationName: "Test Org",
      })
    );
    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(dbMocks.custody.deleteMany).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Custody will be assigned after the custodian signs the agreement.",
      })
    );
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

    expect((response as Response).status).toBe(500); // ShelfError defaults to 500

    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
  });
});
