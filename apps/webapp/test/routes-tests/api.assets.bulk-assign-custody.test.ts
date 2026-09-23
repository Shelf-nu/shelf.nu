import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkCheckOutAssets,
  checkOutQuantity,
  computeCustodyAvailability,
} from "~/modules/asset/service.server";
import { action } from "~/routes/api+/assets.bulk-assign-custody";
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

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

const teamMemberServiceMocks = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
}));

// why: testing route handler without executing actual database operations.
// `asset.findFirst` backs the pre-flight availability pass over the
// quantity-tracked scans.
const dbMocks = vi.hoisted(() => ({
  assetFindFirst: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: { asset: { findFirst: dbMocks.assetFindFirst } },
}));

// why: the route resolves the acting user's timezone via
// resolveUserFormatPrefsById to forward it to bulkCheckOutAssets (select-all
// date filters truncate in the user's tz). Stub it so the route test doesn't
// need a db.user.findFirst mock.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "MM_DD_YYYY",
    timeFormat: "H12",
    weekStartsOn: 0,
    timeZone: "UTC",
  }),
}));

// why: testing authorization logic without executing actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: testing custody assignment validation without executing actual bulk checkout operations
vi.mock("~/modules/asset/service.server", () => ({
  bulkCheckOutAssets: vi
    .fn()
    .mockResolvedValue({ success: true, skippedQuantityTracked: 0 }),
  // why: the per-unit path is what the scanner submits; the route's job is to
  // split the submission and forward role, which is what these assert.
  checkOutQuantity: vi.fn().mockResolvedValue({}),
  computeCustodyAvailability: vi
    .fn()
    .mockResolvedValue({ inCustody: 0, checkedOut: 0, available: 100 }),
}));

// why: testing team member organization validation without database lookups
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
  // why: the custodian-filter narrowing has its own suite; here it only needs
  // to not hit the database. "all" keeps the route's select-all behaviour
  // unchanged for these role-forwarding assertions.
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
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
      const assetIds = JSON.parse(formData.get("assetIds") || "[]");
      const custodian = JSON.parse(formData.get("custodian") || "{}");
      const currentSearchParams = formData.get("currentSearchParams") || null;
      // `AssetQuantitiesSchema` is `.optional().default("{}")`, so the real
      // parse never yields `undefined` here. Mirror that: a mock that omits
      // the field tests a shape the route can't actually receive.
      const quantities = JSON.parse(formData.get("quantities") || "{}");
      return { assetIds, custodian, currentSearchParams, quantities };
    }),
  };
});

// why: mocking asset index settings without database lookups
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({
    mode: "SIMPLE",
  }),
}));

const requirePermissionMock = vi.mocked(requirePermission);
const mockGetTeamMember = teamMemberServiceMocks.getTeamMember;
const mockCheckOutQuantity = vi.mocked(checkOutQuantity);
const mockComputeCustodyAvailability = vi.mocked(computeCustodyAvailability);

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
  mockGetTeamMember.mockReset();
  requirePermissionMock.mockReset();
  // why: `clearAllMocks` drops call history but not implementations, and the
  // availability pre-flight must answer for every test that reaches it.
  mockComputeCustodyAvailability.mockResolvedValue({
    inCustody: 0,
    checkedOut: 0,
    available: 100,
  });
  dbMocks.assetFindFirst.mockResolvedValue({
    title: "USB-C Cables",
    quantity: 100,
  });
});

describe("api/assets/bulk-assign-custody", () => {
  it("prevents assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      canUseBarcodes: false,
    } as any);

    // Custodian not found due to org filter
    mockGetTeamMember.mockRejectedValue(new Error("Not found"));

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

    const response = (await action(createActionArgs({ request }))) as any;

    expect(response.status).toBe(404);

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
      select: { id: true },
    });
  });

  it("allows assigning custody to team members from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      canUseBarcodes: false,
    } as any);

    // Valid team member from same org
    mockGetTeamMember.mockResolvedValue({
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

    const response = (await action(createActionArgs({ request }))) as any;

    // Success case returns Response wrapping the payload
    expect(response instanceof Response).toBe(true);
    const responseData = await (response as unknown as Response).json();
    expect(responseData).toEqual({ error: null, success: true });

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: { id: true },
    });
  });

  // why: the SELF_SERVICE "assign-to-self" guard now lives inside
  // `bulkCheckOutAssets` (centralised so web + mobile callers share one
  // source of truth — the mobile route was missing this check pre-fix,
  // hex-security r3202162994). The route's responsibility shrinks to
  // "pass `role` through". Behavioural enforcement is unit-tested at
  // the service layer (see service.server.test.ts).
  it("forwards role through to bulkCheckOutAssets so the service-level SELF_SERVICE guard can fire", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      canUseBarcodes: false,
    } as any);

    mockGetTeamMember.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456",
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
      { method: "POST", body: formData }
    );

    await action(createActionArgs({ request }));

    // Enforcement of the SELF_SERVICE self-restriction now lives inside
    // bulkCheckOutAssets (unit-tested in asset/service.server.test.ts) so web
    // and mobile share one implementation. The route's job is to forward role.
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        role: OrganizationRoles.SELF_SERVICE,
        custodianId: "team-member-456",
        userId: "user-123",
      })
    );
  });

  it("forwards ADMIN role transparently (service-level guard is no-op for non-SELF_SERVICE)", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      canUseBarcodes: false,
    } as any);

    mockGetTeamMember.mockResolvedValue({
      id: "team-member-123",
      userId: "user-123",
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
      { method: "POST", body: formData }
    );

    const response = (await action(createActionArgs({ request }))) as any;

    expect(response instanceof Response).toBe(true);
    const responseData = await (response as unknown as Response).json();
    expect(responseData).toEqual({ error: null, success: true });
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({ role: OrganizationRoles.ADMIN })
    );
  });
  /**
   * The scanner submits a `quantities` map; the assets index submits none.
   * That single field is what decides whether an asset is handed over unit by
   * unit or as a whole, so both directions are pinned here.
   */
  describe("quantity-tracked scans", () => {
    function quantityRequest(quantities: Record<string, number>) {
      const formData = new FormData();
      formData.set("assetIds", JSON.stringify(["asset-qty", "asset-plain"]));
      formData.set(
        "custodian",
        JSON.stringify({ id: "team-member-123", name: "Valid Team Member" })
      );
      formData.set("currentSearchParams", "");
      formData.set("quantities", JSON.stringify(quantities));

      return new Request("https://example.com/api/assets/bulk-assign-custody", {
        method: "POST",
        body: formData,
      });
    }

    beforeEach(() => {
      requirePermissionMock.mockResolvedValue({
        organizationId: "org-1",
        role: OrganizationRoles.SELF_SERVICE,
        canUseBarcodes: false,
      } as any);
      mockGetTeamMember.mockResolvedValue({
        id: "team-member-123",
        userId: "user-123",
      });
    });

    it("hands a named asset to checkOutQuantity and forwards the acting role", async () => {
      await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 7 }) })
      );

      expect(mockCheckOutQuantity).toHaveBeenCalledWith(
        expect.objectContaining({
          assetId: "asset-qty",
          quantity: 7,
          teamMemberId: "team-member-123",
          userId: "user-123",
          organizationId: "org-1",
          // The service owns the SELF_SERVICE self-restriction for this path,
          // so a route that drops `role` silently disables it.
          role: OrganizationRoles.SELF_SERVICE,
        })
      );
    });

    it("leaves assets without a quantity on the bulk path", async () => {
      await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 7 }) })
      );

      // This is what keeps the assets-index behaviour unchanged: it sends no
      // quantities, so every one of its ids lands here and quantity-tracked
      // ones keep being skipped by the bulk service.
      expect(bulkCheckOutAssets).toHaveBeenCalledWith(
        expect.objectContaining({ assetIds: ["asset-plain"] })
      );
      expect(mockCheckOutQuantity).toHaveBeenCalledTimes(1);
    });

    it("skips the bulk call entirely when every scan carries a quantity", async () => {
      const formData = new FormData();
      formData.set("assetIds", JSON.stringify(["asset-qty"]));
      formData.set(
        "custodian",
        JSON.stringify({ id: "team-member-123", name: "Valid Team Member" })
      );
      formData.set("currentSearchParams", "");
      formData.set("quantities", JSON.stringify({ "asset-qty": 3 }));

      await action(
        createActionArgs({
          request: new Request(
            "https://example.com/api/assets/bulk-assign-custody",
            { method: "POST", body: formData }
          ),
        })
      );

      // Calling it with an empty list would trip its own "all selected assets
      // are quantity-tracked" 400 and fail a scan that is entirely valid.
      expect(bulkCheckOutAssets).not.toHaveBeenCalled();
    });

    it("writes nothing when one scan asks for more units than are free", async () => {
      mockComputeCustodyAvailability.mockResolvedValue({
        inCustody: 96,
        checkedOut: 0,
        available: 4,
      });

      const response = (await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 7 }) })
      )) as any;

      // Each checkOutQuantity commits its own transaction, so a refusal
      // discovered mid-loop would strand the assets already written — and a
      // retry would add them a second time, because the call increments.
      expect(response.status).toBe(400);
      expect(mockCheckOutQuantity).not.toHaveBeenCalled();
      expect(bulkCheckOutAssets).not.toHaveBeenCalled();
    });
  });
});
