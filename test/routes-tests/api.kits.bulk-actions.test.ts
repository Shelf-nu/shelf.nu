import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/kits.bulk-actions";
import { requirePermission } from "~/utils/roles.server";

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

const teamMemberServiceMocks = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
}));

// why: testing route handler without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    kitCustody: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// why: testing authorization logic without executing actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: testing bulk kit operation validation without executing actual kit service operations
vi.mock("~/modules/kit/service.server", () => ({
  bulkAssignKitCustody: vi.fn().mockResolvedValue(undefined),
  bulkDeleteKits: vi.fn().mockResolvedValue(undefined),
  bulkReleaseKitCustody: vi.fn().mockResolvedValue(undefined),
  bulkUpdateKitLocation: vi.fn().mockResolvedValue(undefined),
}));

// why: testing team member organization validation without database lookups
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: controlling form data parsing for predictable test behavior
vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/http.server")>();
  return {
    ...actual,
    assertIsPost: vi.fn(),
    parseData: vi.fn().mockImplementation((formData) => {
      const intent = formData.get("intent");
      const kitIds = JSON.parse(formData.get("kitIds") || "[]");
      const custodian = formData.get("custodian")
        ? JSON.parse(formData.get("custodian"))
        : undefined;
      return { intent, kitIds, custodian };
    }),
  };
});

// why: mocking response helpers for testing route handler status codes
vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
    data: createDataMock(),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const mockGetTeamMember = teamMemberServiceMocks.getTeamMember;

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request: new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
    }),
    params: {},
    ...overrides,
  } as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTeamMember.mockReset();
  requirePermissionMock.mockReset();
});

describe("api/kits/bulk-actions - bulk-assign-custody", () => {
  it("prevents assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Custodian not found due to org filter
    mockGetTeamMember.mockRejectedValue(new Error("Not found"));

    const formData = new FormData();
    formData.set("intent", "bulk-assign-custody");
    formData.set("kitIds", JSON.stringify(["kit-1", "kit-2"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "foreign-team-member-123",
        name: "Foreign Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
      body: formData,
    });

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(response.status).toBe(404);

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
      select: { id: true, userId: true },
    });
  });

  it("allows assigning custody to team members from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    // Valid team member from same org
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      userId: "user-456",
    });

    const formData = new FormData();
    formData.set("intent", "bulk-assign-custody");
    formData.set("kitIds", JSON.stringify(["kit-1", "kit-2"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Valid Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
      body: formData,
    });

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as any;

    // Success case returns plain object, not Response
    expect(response).toEqual({ error: null, success: true });

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: { id: true, userId: true },
    });
  });

  it("prevents self-service users from assigning custody to other team members", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
    } as any);

    // Valid team member from same org, but different user
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456", // Different from current user
    });

    const formData = new FormData();
    formData.set("intent", "bulk-assign-custody");
    formData.set("kitIds", JSON.stringify(["kit-1"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-456",
        name: "Other Team Member",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
      body: formData,
    });

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(response.status).toBe(500); // ShelfError defaults to 500
  });

  it("allows self-service users to assign custody to themselves", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
    } as any);

    // Valid team member from same org, same user
    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      userId: "user-123", // Same as current user
    });

    const formData = new FormData();
    formData.set("intent", "bulk-assign-custody");
    formData.set("kitIds", JSON.stringify(["kit-1"]));
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Self User",
      })
    );
    formData.set("currentSearchParams", "");

    const request = new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
      body: formData,
    });

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as any;

    // Success case returns plain object, not Response
    expect(response).toEqual({ error: null, success: true });
  });

  it("does not validate custodian for non-custody operations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
    } as any);

    const formData = new FormData();
    formData.set("intent", "bulk-delete");
    formData.set("kitIds", JSON.stringify(["kit-1", "kit-2"]));

    const request = new Request("https://example.com/api/kits/bulk-actions", {
      method: "POST",
      body: formData,
    });

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as any;

    // Success case returns plain object, not Response
    expect(response).toEqual({ error: null, success: true });

    // Should not call teamMember.findUnique for non-custody operations
    expect(mockGetTeamMember).not.toHaveBeenCalled();
  });
});
