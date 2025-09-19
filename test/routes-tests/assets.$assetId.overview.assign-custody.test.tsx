import { OrganizationRoles } from "@prisma/client";
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
      findUnique: vi.fn(),
    },
  };
});

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: dbMocks.asset.findUnique,
      update: dbMocks.asset.update,
    },
    teamMember: {
      findMany: dbMocks.teamMember.findMany,
      count: dbMocks.teamMember.count,
      findUnique: dbMocks.teamMember.findUnique,
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

vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const mockAssetFindUnique = dbMocks.asset.findUnique;
const mockAssetUpdate = dbMocks.asset.update;
const mockTeamMemberFindMany = dbMocks.teamMember.findMany;
const mockTeamMemberCount = dbMocks.teamMember.count;
const mockTeamMemberFindUnique = dbMocks.teamMember.findUnique;

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
  mockTeamMemberFindUnique.mockReset();

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
      userOrganizations: [{ organizationId: "org-1" }],
    } as any);

    const unauthorizedError = new ShelfError({
      cause: null,
      label: "Assets",
      message: "Asset not found",
      status: 404,
    });

    getAssetMock.mockRejectedValue(unauthorizedError);

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

    expect(getAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-123",
        organizationId: "org-1",
      })
    );
    expect(mockAssetUpdate).not.toHaveBeenCalled();
    expect(createNoteMock).not.toHaveBeenCalled();
  });
});
