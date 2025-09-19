import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/assets.bulk-assign-custody";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

const dbMocks = vi.hoisted(() => {
  return {
    teamMember: {
      findUnique: vi.fn(),
    },
  };
});

vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findUnique: dbMocks.teamMember.findUnique,
    },
  },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/asset/service.server", () => ({
  bulkCheckOutAssets: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("~/utils/http.server", () => ({
  assertIsPost: vi.fn(),
  parseData: vi.fn().mockImplementation((formData) => {
    const assetIds = JSON.parse(formData.get("assetIds") || "[]");
    const custodian = JSON.parse(formData.get("custodian") || "{}");
    return { assetIds, custodian };
  }),
  data: vi.fn((x) => ({ success: true, ...x })),
  error: vi.fn((x) => ({ error: x })),
}));

vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
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
const mockTeamMemberFindUnique = dbMocks.teamMember.findUnique;

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request: new Request("https://example.com/api/assets/bulk-assign-custody", {
      method: "POST",
    }),
    params: {},
    ...overrides,
  } as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTeamMemberFindUnique.mockReset();
  requirePermissionMock.mockReset();
});

describe("api/assets/bulk-assign-custody", () => {
  it("prevents assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Custodian not found due to org filter
    mockTeamMemberFindUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("assetIds", JSON.stringify(["asset-1", "asset-2"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "foreign-team-member-123",
        name: "Foreign Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request(
      "https://example.com/api/assets/bulk-assign-custody",
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

    const formData = new FormData();
    formData.set("assetIds", JSON.stringify(["asset-1", "asset-2"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Valid Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request(
      "https://example.com/api/assets/bulk-assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(200);

    expect(mockTeamMemberFindUnique).toHaveBeenCalledWith({
      where: {
        id: "team-member-123",
        organizationId: "org-1",
      },
      select: { id: true, userId: true },
    });
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
    formData.set("assetIds", JSON.stringify(["asset-1"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-456",
        name: "Other Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request(
      "https://example.com/api/assets/bulk-assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(500); // ShelfError defaults to 500
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

    const formData = new FormData();
    formData.set("assetIds", JSON.stringify(["asset-1"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Self User",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request(
      "https://example.com/api/assets/bulk-assign-custody",
      {
        method: "POST",
        body: formData,
      }
    );

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(200);
  });
});
