/**
 * Test suite for POST /api/mobile/custody/release-quantity.
 *
 * Mobile twin of the web's `/api/assets/release-quantity-custody`: releases
 * N units of a QUANTITY_TRACKED asset from a team member back to the pool
 * via `releaseQuantity`. Pins the SELF_SERVICE own-custody-only guard, the
 * service error passthroughs (over-release 400, no-custody-row 404), the
 * deliberate ABSENCE of a low-stock check on release (web parity), and the
 * refreshed viewer-shaped asset in the success envelope.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/custody.release-quantity.ts}
 */
import { action } from "~/routes/api+/mobile+/custody.release-quantity";
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
  getMobileAssetForViewer: vitest.fn(),
}));

// why: external service — we mock the quantity release without hitting the
// database (whole-module mock also keeps the heavy component import graph out)
vitest.mock("~/modules/asset/service.server", () => ({
  releaseQuantity: vitest.fn().mockResolvedValue({ id: "asset-1" }),
}));

// why: external service — we mock the team member lookup without hitting the database
vitest.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vitest.fn(),
}));

// why: external service — we mock the actor lookup for the audit note without hitting the database
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn(),
}));

// why: external service — we mock note creation without hitting the database
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn(),
}));

// why: the release route must NOT run the low-stock check (release adds
// stock back; the web release route has none either). The route doesn't
// import this module — mocking it lets the happy-path test pin that with
// an explicit zero-calls assertion.
vitest.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vitest.fn(),
}));

// why: keep pino/Sentry out of the test graph; the note-failure test asserts
// the route logs instead of failing
vitest.mock("~/utils/logger", () => ({
  Logger: { error: vitest.fn() },
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
  getMobileAssetForViewer,
} from "~/modules/api/mobile-auth.server";
import { releaseQuantity } from "~/modules/asset/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { createNote } from "~/modules/note/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { Logger } from "~/utils/logger";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

/** The viewer-shaped asset the route returns in its success envelope */
const mockShapedAsset = {
  id: "asset-1",
  title: "Bolts",
  status: "AVAILABLE",
  type: "QUANTITY_TRACKED",
  quantity: 10,
  custody: null,
  custodyList: [],
  custodyListOthersCount: 0,
};

function createReleaseQuantityRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/custody/release-quantity?orgId=${orgId}`,
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

describe("POST /api/mobile/custody/release-quantity", () => {
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
      canUseAudits: false,
      canSeeAllCustody: true,
    });

    (getTeamMember as any).mockResolvedValue({
      id: "tm-1",
      name: "Jane Doe",
      userId: "user-2",
      user: { id: "user-2", firstName: "Jane", lastName: "Doe" },
    });

    (getUserByID as any).mockResolvedValue({
      id: "user-1",
      firstName: "Test",
      lastName: "User",
    });

    (createNote as any).mockResolvedValue(undefined);

    (releaseQuantity as any).mockResolvedValue({ id: "asset-1" });

    (getMobileAssetForViewer as any).mockResolvedValue(mockShapedAsset);
  });

  it("releases quantity custody successfully and returns the refreshed asset", async () => {
    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 3,
    });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.asset).toEqual(mockShapedAsset);

    expect(releaseQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 3,
        userId: "user-1",
        organizationId: "org-1",
      })
    );

    // Best-effort audit note is written on success
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
        organizationId: "org-1",
      })
    );

    // Web parity: NO low-stock check on release (release adds stock back;
    // the web release route never calls checkAndNotifyLowStock)
    expect(checkAndNotifyLowStock).not.toHaveBeenCalled();

    // Refreshed asset is shaped for THIS viewer (visibility filter applied)
    expect(getMobileAssetForViewer).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        organizationId: "org-1",
        viewerUserId: "user-1",
        canSeeAllCustody: true,
      })
    );
  });

  it("surfaces the service's 400 when releasing more than the custodian holds", async () => {
    (releaseQuantity as any).mockRejectedValue({
      message: "Cannot release 5 units. The custodian only holds 2 units.",
      status: 400,
    });

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 5,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("only holds 2 units");
  });

  it("surfaces the service's 404 when no custody record exists", async () => {
    (releaseQuantity as any).mockRejectedValue({
      message: "No custody record found for this team member and asset.",
      status: 404,
    });

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 1,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("No custody record found");
  });

  it("returns 403 when a SELF_SERVICE user releases someone else's custody", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
    });
    (getTeamMember as any).mockResolvedValue({
      id: "tm-1",
      name: "Jane Doe",
      userId: "someone-else",
      user: { id: "someone-else", firstName: "Jane", lastName: "Doe" },
    });

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 1,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toBe(
      "Self-service users can only release their own custody."
    );
    expect(releaseQuantity).not.toHaveBeenCalled();
  });

  it("allows a SELF_SERVICE user to release their own custody", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
    });
    (getTeamMember as any).mockResolvedValue({
      id: "tm-1",
      name: "Test User",
      // The team member row IS the caller's own record
      userId: "user-1",
      user: { id: "user-1", firstName: "Test", lastName: "User" },
    });

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 1,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(releaseQuantity).toHaveBeenCalled();
  });

  it("returns 404 when the team member is not found in the org", async () => {
    (getTeamMember as any).mockRejectedValue(new Error("not found"));

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "cross-org-tm",
      quantity: 1,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("could not be found");
    expect(releaseQuantity).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body (quantity must be a positive integer)", async () => {
    // Pins the safeParse wrap: siblings' raw `.parse` would surface this as
    // a 500 — this route must keep the web's 400 validation contract.
    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: -2,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toBe("Invalid request body");
    expect(releaseQuantity).not.toHaveBeenCalled();
  });

  it("still succeeds when the audit note fails (best-effort contract)", async () => {
    (createNote as any).mockRejectedValue(new Error("notes table on fire"));

    const request = createReleaseQuantityRequest({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 1,
    });

    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    // The failure is logged, not thrown
    expect(Logger.error).toHaveBeenCalled();
  });
});
