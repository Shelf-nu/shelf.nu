import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  bulkCheckOutAssets,
  checkOutQuantity,
} from "~/modules/asset/service.server";
import { QUANTITY_CUSTODIAN_SELECT } from "~/modules/custody/quantity-custody.server";
import { action } from "~/routes/api+/assets.bulk-assign-custody";
import { ShelfError } from "~/utils/error";
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
  // It reports a source with nothing to name, as for a pool at one location.
  checkOutQuantity: vi.fn().mockResolvedValue({
    source: {
      locationId: null,
      locationName: null,
      explicit: false,
      multiSource: false,
    },
  }),
}));

// why: the availability pre-flight lives in the dependency-free leaf, so it is
// mocked separately from the service module.
vi.mock("~/modules/asset/availability-primitives.server", () => ({
  computeCustodyAvailability: vi.fn().mockResolvedValue({
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    available: 100,
  }),
}));

// why: testing team member organization validation without database lookups
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
  // why: the custodian-filter narrowing has its own suite; here it only needs
  // to not hit the database. "all" keeps the route's select-all behaviour
  // unchanged for these role-forwarding assertions.
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
}));

// why: the per-unit path writes an audit note and runs the low-stock check
// after each assignment. Their content is pinned in the shared module's own
// suite; here they only need to not reach a database.
vi.mock("~/modules/note/service.server", () => ({ createNote: vi.fn() }));
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-123",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  }),
}));
vi.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vi.fn(),
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
      // Same for `AssetSourceLocationsSchema`: an absent field parses to {}.
      const sourceLocations = JSON.parse(
        formData.get("sourceLocations") || "{}"
      );
      return {
        assetIds,
        custodian,
        currentSearchParams,
        quantities,
        sourceLocations,
      };
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
    inKits: 0,
    checkedOut: 0,
    available: 100,
  });
  dbMocks.assetFindFirst.mockResolvedValue({
    title: "USB-C Cables",
    quantity: 100,
    type: "QUANTITY_TRACKED",
  });
});

describe("api/assets/bulk-assign-custody", () => {
  it("prevents assigning custody to team members from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      access: accessFor(["ADMIN"]),
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);

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

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(response.status).toBe(404);

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
      select: QUANTITY_CUSTODIAN_SELECT,
    });
  });

  it("allows assigning custody to team members from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      access: accessFor(["ADMIN"]),
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);

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

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    // Success case returns Response wrapping the payload
    expect(response instanceof Response).toBe(true);
    const responseData = await response.json();
    expect(responseData).toEqual({ error: null, success: true });

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: QUANTITY_CUSTODIAN_SELECT,
    });
  });

  // The "assign only to yourself" guard lives inside `bulkCheckOutAssets`,
  // shared by web and mobile callers. The route forwards the caller's custody
  // scope; enforcement is unit-tested at the service layer
  // (see service.server.test.ts).
  it("forwards a `self` custody scope to bulkCheckOutAssets so the service-level guard can fire", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      access: accessFor(["SELF_SERVICE"]),
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);

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

    // bulkCheckOutAssets enforces the scope (unit-tested in
    // asset/service.server.test.ts); the route's job is to forward it.
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        custodyAssign: "self",
        custodianId: "team-member-456",
        userId: "user-123",
      })
    );
  });

  it("forwards an ADMIN's `anyone` custody scope (the service-level guard does not fire)", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      access: accessFor(["ADMIN"]),
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);

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

    const response = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(response instanceof Response).toBe(true);
    const responseData = await response.json();
    expect(responseData).toEqual({ error: null, success: true });
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({ custodyAssign: "anyone" })
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
        access: accessFor(["SELF_SERVICE"]),
        canUseBarcodes: false,
      } as Awaited<ReturnType<typeof requirePermission>>);
      // The caller's own team member: the shape QUANTITY_CUSTODIAN_SELECT reads.
      mockGetTeamMember.mockResolvedValue({
        id: "team-member-123",
        name: "Valid Team Member",
        user: {
          id: "user-123",
          firstName: null,
          lastName: null,
          displayName: null,
        },
      });
    });

    it("refuses a self-service hand-over to someone else before any write", async () => {
      mockGetTeamMember.mockResolvedValue({
        id: "team-member-123",
        name: "Valid Team Member",
        user: {
          id: "someone-else",
          firstName: null,
          lastName: null,
          displayName: null,
        },
      });

      const response = (await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 7 }) })
      )) as unknown as Response;

      // Refused per asset by checkOutQuantity, this would come back as a 409
      // saying everything else was assigned, when nothing was.
      expect(response.status).toBe(403);
      expect(mockCheckOutQuantity).not.toHaveBeenCalled();
      expect(bulkCheckOutAssets).not.toHaveBeenCalled();
    });

    it("hands a named asset to checkOutQuantity and forwards the caller's custody scope", async () => {
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
          // The service owns the "assign only to yourself" restriction for
          // this path, so a route that drops the scope silently disables it.
          custodyAssign: "self",
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

    it("assigns once for an asset scanned under two codes", async () => {
      const formData = new FormData();
      // The scanner keys rows by code, so one asset scanned by QR and by
      // barcode arrives twice. Assigning per occurrence would hand over double,
      // and `checkOutQuantity` increments rather than sets.
      formData.set("assetIds", JSON.stringify(["asset-qty", "asset-qty"]));
      formData.set(
        "custodian",
        JSON.stringify({ id: "team-member-123", name: "Valid Team Member" })
      );
      formData.set("currentSearchParams", "");
      formData.set("quantities", JSON.stringify({ "asset-qty": 4 }));

      await action(
        createActionArgs({
          request: new Request(
            "https://example.com/api/assets/bulk-assign-custody",
            { method: "POST", body: formData }
          ),
        })
      );

      expect(mockCheckOutQuantity).toHaveBeenCalledTimes(1);
      expect(mockCheckOutQuantity).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "asset-qty", quantity: 4 })
      );
    });

    it("writes nothing when one scan asks for more units than are free", async () => {
      mockComputeCustodyAvailability.mockResolvedValue({
        inCustody: 96,
        inKits: 0,
        checkedOut: 0,
        available: 4,
      });

      const response = (await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 7 }) })
      )) as unknown as Response;

      // Each checkOutQuantity commits its own transaction, so a refusal
      // discovered mid-loop would strand the assets already written, and a
      // retry would add them a second time, because the call increments.
      expect(response.status).toBe(400);
      expect(mockCheckOutQuantity).not.toHaveBeenCalled();
      expect(bulkCheckOutAssets).not.toHaveBeenCalled();
    });

    it("runs the whole-asset call before any per-unit write", async () => {
      await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 2 }) })
      );

      // The bulk call validates and writes in one transaction, so if it
      // refuses, no units have been handed over yet.
      expect(
        vi.mocked(bulkCheckOutAssets).mock.invocationCallOrder[0]
      ).toBeLessThan(mockCheckOutQuantity.mock.invocationCallOrder[0]);
    });

    it("says what landed when a per-unit write is refused after the check", async () => {
      mockCheckOutQuantity.mockRejectedValueOnce(
        new ShelfError({
          cause: null,
          label: "Assets",
          status: 400,
          message: "Only 1 units are available.",
        })
      );

      const response = (await action(
        createActionArgs({ request: quantityRequest({ "asset-qty": 2 }) })
      )) as unknown as Response;

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.message).toMatch(/^Everything else was assigned\. /);
    });
  });
});
