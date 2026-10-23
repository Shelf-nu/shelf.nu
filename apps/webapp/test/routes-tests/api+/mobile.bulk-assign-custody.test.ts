import { action } from "~/routes/api+/mobile+/bulk-assign-custody";
import { createActionArgs } from "@mocks/remix";
import { accessFor } from "@helpers/role-access";
import { ALL_SELECTED_KEY } from "~/utils/list";

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

// why: the archived pre-check is a database read. These cases are about
// other rules, so no requested asset is archived unless a test says so.
vitest.mock("~/modules/api/mobile-archived.server", () => ({
  findMobileArchivedRefusal: vitest.fn().mockResolvedValue(null),
}));

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  requireMobilePermission: vitest.fn(),
  getMobileUserContext: vitest.fn(),
}));

// why: external service — we mock the custody assignment without hitting the
// database. Resolves the real service's return shape — the route now
// destructures `skippedQuantityTracked` off it.
vitest.mock("~/modules/asset/service.server", () => ({
  bulkCheckOutAssets: vitest
    .fn()
    .mockResolvedValue({ success: true, skippedQuantityTracked: 0 }),
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
import { findMobileArchivedRefusal } from "~/modules/api/mobile-archived.server";

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
      access: accessFor(["ADMIN"]),
      canUseBarcodes: false,
    });

    (getTeamMember as any).mockResolvedValue({
      id: "custodian-1",
      name: "Jane Doe",
    });
  });

  it("rejects the select-all sentinel instead of expanding it org-wide", async () => {
    // Mobile has no select-all control and sends no `currentSearchParams`, so
    // the sentinel would expand against an empty filter — every AVAILABLE asset
    // in the organization. SELF_SERVICE holds `asset:custody`, so this is
    // reachable by a restricted role, not just an admin.
    const request = createBulkAssignRequest({
      assetIds: [ALL_SELECTED_KEY],
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    // 400, not 500: an expected client error must not be reported as a server
    // outage, or it drowns in Sentry alongside real faults.
    expect((result as unknown as Response).status).toBe(400);
    // The write must never be reached
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });

  it("rejects the sentinel even when mixed with real ids", async () => {
    // The service checks `ids.includes(ALL_SELECTED_KEY)`, so one sentinel
    // anywhere switches the whole request to select-all.
    const request = createBulkAssignRequest({
      assetIds: ["asset-1", ALL_SELECTED_KEY],
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
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
    // Additive skip count — 0 for an all-INDIVIDUAL selection
    expect(body.skippedQuantityTracked).toBe(0);

    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        assetIds: ["asset-1", "asset-2"],
        custodianId: "custodian-1",
        custodianName: "Jane Doe",
        organizationId: "org-1",
        custodyAssign: "anyone",
      })
    );
  });

  it("forwards the service's skippedQuantityTracked count to the client", async () => {
    // Mixed selections silently skip QUANTITY_TRACKED assets in the service;
    // the route must forward the count so the app can report it honestly.
    (bulkCheckOutAssets as any).mockResolvedValueOnce({
      success: true,
      skippedQuantityTracked: 2,
    });

    const request = createBulkAssignRequest({
      assetIds: ["asset-1", "qt-asset-1", "qt-asset-2"],
      custodianId: "custodian-1",
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.skippedQuantityTracked).toBe(2);
  });

  it("forwards a SELF_SERVICE caller's `self` custody scope so the service-level guard fires", async () => {
    // `bulkCheckOutAssets` refuses assignments to anyone but the caller when
    // the scope is `self`; the route must forward the scope for that to run.
    (getMobileUserContext as any).mockResolvedValue({
      access: accessFor(["SELF_SERVICE"]),
      canUseBarcodes: false,
    });
    // Assigning to themselves, so the route's own scope check lets it through.
    (getTeamMember as any).mockResolvedValue({
      id: "custodian-1",
      name: "Test User",
      user: { id: mockUser.id },
    });

    const request = createBulkAssignRequest({
      assetIds: ["asset-1"],
      custodianId: "custodian-1",
    });

    await action(createActionArgs({ request }));

    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({ custodyAssign: "self" })
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

  it("names the archived assets and writes nothing when the scan holds one", async () => {
    // The phone marks only the rows the server names, so the ids must reach it.
    const refusal = {
      message:
        "Archived assets are read-only. Reinstate them before making changes.",
      reason: "archived" as const,
      archivedAssetIds: ["asset-2"],
    };
    (findMobileArchivedRefusal as any).mockResolvedValueOnce(refusal);

    const request = createBulkAssignRequest({
      assetIds: ["asset-1", "asset-2"],
      custodianId: "custodian-1",
    });
    const result = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: refusal });
    expect(findMobileArchivedRefusal).toHaveBeenCalledWith({
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
    });
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });

  it("refuses a self-scope caller assigning to someone else before looking at archived rows", async () => {
    // Removing the archived row would not help: the scope refuses the request
    // whatever the list holds, so that is the answer the phone gets first.
    (getMobileUserContext as any).mockResolvedValue({
      access: accessFor(["SELF_SERVICE"]),
      canUseBarcodes: false,
    });
    (getTeamMember as any).mockResolvedValue({
      id: "custodian-1",
      name: "Jane Doe",
      user: { id: "someone-else" },
    });

    const request = createBulkAssignRequest({
      assetIds: ["asset-1", "asset-archived"],
      custodianId: "custodian-1",
    });
    const result = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(result.status).toBe(403);
    expect(findMobileArchivedRefusal).not.toHaveBeenCalled();
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });
});
