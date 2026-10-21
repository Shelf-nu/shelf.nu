import { action } from "~/routes/api+/mobile+/asset.reinstate";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
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

// why: external auth, we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: the reinstate service writes to the database; its own rules (not
// archived, kit in use, race) are covered by the asset service tests
vi.mock("~/modules/asset/service.server", () => ({
  unarchiveAsset: vi.fn(),
}));

// why: rate limiting is infra, not the behaviour under test
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: error utility, mocked to control error formatting in tests
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
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
} from "~/modules/api/mobile-auth.server";
import { unarchiveAsset } from "~/modules/asset/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(body: Record<string, unknown>) {
  return new Request(
    "http://localhost/api/mobile/asset/reinstate?orgId=org-1",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/asset/reinstate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
  });

  it("reinstates the asset for the caller's workspace and says it is active", async () => {
    (unarchiveAsset as any).mockResolvedValue({ id: "asset-1" });

    const result = (await action(
      createActionArgs({ request: createRequest({ assetId: "asset-1" }) })
    )) as unknown as Response;

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({
      asset: { id: "asset-1", archivedAt: null },
    });
    expect(unarchiveAsset).toHaveBeenCalledWith({
      id: "asset-1",
      organizationId: "org-1",
      // Attributes the ASSET_UNARCHIVED event to the phone user.
      actorUserId: "user-1",
    });
  });

  it("asks for the same grant as the web's Reinstate (asset: archive)", async () => {
    (unarchiveAsset as any).mockResolvedValue({ id: "asset-1" });

    await action(
      createActionArgs({ request: createRequest({ assetId: "asset-1" }) })
    );

    expect(requireMobilePermission).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      entity: "asset",
      action: "archive",
    });
  });

  it("refuses a member without the grant and reinstates nothing", async () => {
    const permError = new Error("You have no permission");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const result = (await action(
      createActionArgs({ request: createRequest({ assetId: "asset-1" }) })
    )) as unknown as Response;

    expect(result.status).toBe(403);
    expect(unarchiveAsset).not.toHaveBeenCalled();
  });

  it("passes the service's refusal through, with its status", async () => {
    // e.g. the asset's kit is out: the app shows this message as is.
    const kitInUse = new Error(
      "This asset belongs to a kit that is in custody or checked out. Release or check in the kit first, then reinstate the asset."
    );
    (kitInUse as any).status = 400;
    (unarchiveAsset as any).mockRejectedValue(kitInUse);

    const result = (await action(
      createActionArgs({ request: createRequest({ assetId: "asset-1" }) })
    )) as unknown as Response;

    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({
      error: { message: kitInUse.message },
    });
  });

  it("refuses a body without an asset id", async () => {
    const result = (await action(
      createActionArgs({ request: createRequest({}) })
    )) as unknown as Response;

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(unarchiveAsset).not.toHaveBeenCalled();
  });
});
