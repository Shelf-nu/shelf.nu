import { OrganizationRoles, AssetStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
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
      // why: the status guard now rides on the UPDATE itself
      // (`status: { not: CHECKED_OUT }`), so the action claims the asset with
      // `updateMany` and branches on the returned count. Default to a hit.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      // why: the action reads the asset's live status inside the tx and
      // refuses the assignment when it is CHECKED_OUT, so a custody claim can
      // never overwrite the "off the shelf" signal. Default to AVAILABLE so
      // the pre-existing cases still exercise the happy path.
      findFirst: vi.fn().mockResolvedValue({
        status: "AVAILABLE",
        title: "Test Asset",
      }),
    },
    teamMember: {
      findMany: vi.fn(),
      count: vi.fn(),
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

// why: testing route handler without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: dbMocks.asset.findUnique,
      update: dbMocks.asset.update,
      findFirst: dbMocks.asset.findFirst,
      updateMany: dbMocks.asset.updateMany,
    },
    teamMember: {
      findMany: dbMocks.teamMember.findMany,
      count: dbMocks.teamMember.count,
    },
    custody: {
      deleteMany: dbMocks.custody.deleteMany,
    },
    // why: action wraps custody cleanup + assignment in a transaction
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      cb({
        custody: { deleteMany: dbMocks.custody.deleteMany },
        asset: {
          update: dbMocks.asset.update,
          // why: `findFirst` runs only on the rejection path, to name the
          // asset in the conflict message.
          findFirst: dbMocks.asset.findFirst,
          updateMany: dbMocks.asset.updateMany,
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

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
      select: {
        id: true,
        name: true,
        userId: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
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

    expect((response as Response).status).toBe(302); // Redirect on success

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: {
        id: true,
        name: true,
        userId: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    });

    // The status write moved onto its own guarded `updateMany`
    // (`status: { not: CHECKED_OUT }`) so it is atomic against a concurrent
    // checkout; the `update` below now only creates the custody row.
    // Asserting both keeps that split visible to the next reader.
    expect(dbMocks.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-123",
        organizationId: "org-1",
        status: { not: AssetStatus.CHECKED_OUT },
      },
      data: { status: AssetStatus.IN_CUSTODY },
    });

    expect(mockAssetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-123", organizationId: "org-1" },
      data: expect.objectContaining({
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

    expect((response as Response).status).toBe(500); // ShelfError defaults to 500

    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
  });
});

/**
 * A custody claim must never overwrite `CHECKED_OUT`, and when it is refused the
 * operator must be told why.
 *
 * The guard rides on the UPDATE (`status: { not: CHECKED_OUT }`) rather than a
 * preceding `findFirst`: Postgres runs at READ COMMITTED, so a plain SELECT
 * takes no row lock and a checkout committing between read and write would be
 * silently overwritten — the exact bug this PR closes. These tests therefore
 * drive the `updateMany` count, which is what the database would actually
 * return, instead of stubbing a status read.
 */
describe("assign-custody — CHECKED_OUT conflict", () => {
  beforeEach(() => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      userId: "user-456",
    });
    mockAssetUpdate.mockResolvedValue({
      id: "asset-123",
      title: "Test Asset",
    } as any);
  });

  it("refuses the claim and keeps the specific message when the row is filtered out", async () => {
    // count === 0 is what Postgres returns when the `not: CHECKED_OUT`
    // predicate excludes the row.
    dbMocks.asset.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.asset.findFirst.mockResolvedValue({ title: "Drill" });

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-member-123", name: "Test Team Member" })
    );

    const response = await action(
      createActionArgs({
        request: new Request(
          "https://example.com/assets/asset-123/overview/assign-custody",
          { method: "POST", body: formData }
        ),
      })
    );

    expect((response as Response).status).toBe(400);

    // The `.catch` around the transaction must re-throw ShelfError causes
    // unchanged. ShelfError never inherits `message`, so wrapping would swap
    // this for the generic "Something went wrong" text the form renders.
    const body = await (response as Response).json();
    expect(body.error.message).toContain("currently checked out on a booking");

    // No custody row is written when the claim is refused.
    expect(dbMocks.asset.update).not.toHaveBeenCalled();
  });

  it("claims the asset atomically rather than reading its status first", async () => {
    dbMocks.asset.updateMany.mockResolvedValue({ count: 1 });

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({ id: "team-member-123", name: "Test Team Member" })
    );

    await action(
      createActionArgs({
        request: new Request(
          "https://example.com/assets/asset-123/overview/assign-custody",
          { method: "POST", body: formData }
        ),
      })
    );

    expect(dbMocks.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-123",
        organizationId: "org-1",
        status: { not: "CHECKED_OUT" },
      },
      data: { status: "IN_CUSTODY" },
    });

    // The happy path must not pay for a status read — it only runs when the
    // claim is refused.
    expect(dbMocks.asset.findFirst).not.toHaveBeenCalled();
  });
});
