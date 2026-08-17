import { action } from "~/routes/api+/mobile+/custody.assign";
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
  bulkCheckOutAssets: vitest.fn().mockResolvedValue(undefined),
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
import { bulkCheckOutAssets } from "~/modules/asset/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

function createCustodyAssignRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/custody/assign?orgId=${orgId}`,
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

describe("POST /api/mobile/custody/assign", () => {
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

  it("should assign custody successfully", async () => {
    const request = createCustodyAssignRequest({
      assetId: "asset-1",
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);

    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        assetIds: ["asset-1"],
        custodianId: "custodian-1",
        custodianName: "Jane Doe",
        organizationId: "org-1",
      })
    );
  });

  it("should return error when permission is denied", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createCustodyAssignRequest({
      assetId: "asset-1",
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");
  });

  /**
   * The SCALAR field is the one that looks safe and is not. The route wraps it
   * as `assetIds: [assetId]`, and `["all-selected"]` satisfies
   * `bulkCheckOutAssets`'s `includes(ALL_SELECTED_KEY)` check exactly as a
   * longer list does. Mobile hardcodes `currentSearchParams: ""`, so it expands
   * against an EMPTY filter — every available asset in the organization.
   *
   * SELF_SERVICE holds `asset:custody`, so a restricted role can reach it.
   *
   * The bulk siblings were fixed first; this one was missed because a single-id
   * field does not read as a bulk operation.
   */
  it("rejects the select-all sentinel in the scalar assetId field", async () => {
    const request = createCustodyAssignRequest({
      assetId: "all-selected",
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    // The assertion that matters: the org-wide write is never reached.
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });

  it("rejects an empty assetId", async () => {
    const request = createCustodyAssignRequest({
      assetId: "",
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });
});
