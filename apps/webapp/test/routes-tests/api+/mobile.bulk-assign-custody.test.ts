import { action } from "~/routes/api+/mobile.bulk-assign-custody";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  requireMobilePermission: vitest.fn(),
  getMobileUserContext: vitest.fn(),
}));

// why: external service — we mock the custody assignment without hitting the database
vitest.mock("~/modules/asset/service.server", () => ({
  bulkAssignCustody: vitest.fn().mockResolvedValue(undefined),
}));

// why: external service — we mock the team member lookup without hitting the database
vitest.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vitest.fn(),
}));

// why: external service — we mock asset index settings without hitting the database
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vitest.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: we need to control error formatting without running real error logic
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { bulkAssignCustody } from "~/modules/asset/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

function createBulkAssignRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/bulk-assign-custody?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/bulk-assign-custody", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    (requireMobilePermission as any).mockResolvedValue(undefined);

    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: false,
    });

    (getTeamMember as any).mockResolvedValue({
      id: "custodian-1",
      name: "Jane Doe",
    });
  });

  it("should bulk assign custody successfully", async () => {
    const request = createBulkAssignRequest({
      assetIds: ["asset-1", "asset-2"],
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);

    expect(bulkAssignCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        assetIds: ["asset-1", "asset-2"],
        custodianId: "custodian-1",
        custodianName: "Jane Doe",
        organizationId: "org-1",
      })
    );
  });

  it("should return 404 when team member is not found", async () => {
    (getTeamMember as any).mockRejectedValue(
      new Error("Team member not found")
    );

    const request = createBulkAssignRequest({
      assetIds: ["asset-1"],
      custodianId: "nonexistent-custodian",
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("could not be found");
  });

  it("should return error when permission is denied", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createBulkAssignRequest({
      assetIds: ["asset-1", "asset-2"],
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");
  });
});
