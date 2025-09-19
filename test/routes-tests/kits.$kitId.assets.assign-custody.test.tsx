import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/kits.$kitId.assets.assign-custody";
import { requirePermission } from "~/utils/roles.server";
import { getUserByID } from "~/modules/user/service.server";

const dbMocks = vi.hoisted(() => {
  return {
    teamMember: {
      findUnique: vi.fn(),
    },
    kit: {
      update: vi.fn(),
    },
    asset: {
      update: vi.fn(),
    },
    note: {
      createMany: vi.fn(),
    },
  };
});

vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findUnique: dbMocks.teamMember.findUnique,
    },
    kit: {
      update: dbMocks.kit.update,
    },
    asset: {
      update: dbMocks.asset.update,
    },
    note: {
      createMany: dbMocks.note.createMany,
    },
  },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
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

vi.mock("~/utils/http.server", () => ({
  assertIsPost: vi.fn(),
  parseData: vi.fn().mockImplementation((formData) => {
    const custodian = JSON.parse(formData.get("custodian") || "{}");
    return { custodian };
  }),
  getParams: vi.fn().mockImplementation((params) => ({
    kitId: params.kitId || "kit-123",
  })),
  data: vi.fn((x) => ({ success: true, ...x })),
  error: vi.fn((x) => ({ error: x })),
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

const requirePermissionMock = vi.mocked(requirePermission);
const getUserByIDMock = vi.mocked(getUserByID);
const mockTeamMemberFindUnique = dbMocks.teamMember.findUnique;
const mockKitUpdate = dbMocks.kit.update;
const mockAssetUpdate = dbMocks.asset.update;
const mockNoteCreateMany = dbMocks.note.createMany;

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request: new Request(
      "https://example.com/kits/kit-123/assets/assign-custody",
      {
        method: "POST",
      }
    ),
    params: { kitId: "kit-123" },
    ...overrides,
  } as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTeamMemberFindUnique.mockReset();
  mockKitUpdate.mockReset();
  mockAssetUpdate.mockReset();
  mockNoteCreateMany.mockReset();
  requirePermissionMock.mockReset();

  getUserByIDMock.mockResolvedValue({
    id: "user-123",
    firstName: "Test",
    lastName: "User",
  } as any);

  mockAssetUpdate.mockResolvedValue({} as any);
  mockNoteCreateMany.mockResolvedValue({} as any);
});

describe("kits/$kitId/assets/assign-custody", () => {
  it("prevents assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Custodian not found due to org filter
    mockTeamMemberFindUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({
        id: "foreign-team-member-123",
        name: "Foreign Team Member",
      })
    );

    const request = new Request(
      "https://example.com/kits/kit-123/assets/assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(404);

    expect(mockTeamMemberFindUnique).toHaveBeenCalledWith({
      where: {
        id: "foreign-team-member-123",
        organizationId: "org-1",
      },
      select: { id: true, userId: true },
    });

    expect(mockKitUpdate).not.toHaveBeenCalled();
  });

  it("allows assigning custody to team members from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Valid team member from same org
    mockTeamMemberFindUnique.mockResolvedValue({
      id: "team-member-123",
      userId: "user-456",
    });

    mockKitUpdate.mockResolvedValue({
      id: "kit-123",
      name: "Test Kit",
      assets: [],
    } as any);

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Valid Team Member",
      })
    );

    const request = new Request(
      "https://example.com/kits/kit-123/assets/assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302); // Redirect on success

    expect(mockTeamMemberFindUnique).toHaveBeenCalledWith({
      where: {
        id: "team-member-123",
        organizationId: "org-1",
      },
      select: { id: true, userId: true },
    });

    expect(mockKitUpdate).toHaveBeenCalled();
  });

  it("prevents self-service users from assigning custody to other team members", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
    } as any);

    // Valid team member from same org, but different user
    mockTeamMemberFindUnique.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456", // Different from current user
    });

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-456",
        name: "Other Team Member",
      })
    );

    const request = new Request(
      "https://example.com/kits/kit-123/assets/assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(500); // ShelfError defaults to 500

    expect(mockKitUpdate).not.toHaveBeenCalled();
  });

  it("allows self-service users to assign custody to themselves", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
    } as any);

    // Valid team member from same org, same user
    mockTeamMemberFindUnique.mockResolvedValue({
      id: "team-member-123",
      userId: "user-123", // Same as current user
    });

    mockKitUpdate.mockResolvedValue({
      id: "kit-123",
      name: "Test Kit",
      assets: [],
    } as any);

    const formData = new FormData();
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Self User",
      })
    );

    const request = new Request(
      "https://example.com/kits/kit-123/assets/assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302); // Redirect on success

    expect(mockKitUpdate).toHaveBeenCalled();
  });
});
