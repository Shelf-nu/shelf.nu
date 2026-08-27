import { loader } from "~/routes/api+/mobile+/barcode.$value";
import { createLoaderArgs } from "@mocks/remix";

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
// why: stub only auth + org-access (out of scope for these route-shape tests);
// load the real MOBILE_ASSET_SELECT / MOBILE_KIT_SELECT projections + the
// shapeMobileAssetResponse / shapeMobileKitResponse helpers so the response-
// shape assertions exercise the actual flattening, not a hand-mirrored stub.
vitest.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vitest.importActual<
    typeof import("~/modules/api/mobile-auth.server")
  >("~/modules/api/mobile-auth.server");
  return {
    ...actual,
    requireMobileAuth: vitest.fn(),
    requireOrganizationAccess: vitest.fn(),
  };
});

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    organization: {
      findUnique: vitest.fn(),
    },
    asset: {
      findUnique: vitest.fn(),
    },
    userOrganization: {
      findMany: vitest.fn(),
    },
    barcode: {
      findMany: vitest.fn(),
    },
  },
}));

// why: external service — we mock the barcode lookup
vitest.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: vitest.fn(),
}));

// why: canUseBarcodes reads the premium env flag, which would make the
// sibling-workspace entitlement cases flip with the test environment; pin it
// to the premium behavior (the flag itself) so they are deterministic.
vitest.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: (org: { barcodesEnabled: boolean }) => org.barcodesEnabled,
}));

vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn(),
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
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { makeShelfError } from "~/utils/error";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

// Post-Phase-4a/4b shape: pivot rows (assetKits/assetLocations/custody) feed
// `shapeMobileAssetResponse`, which flattens them to the legacy `kit`/`kitId`/
// `location`/`custody` shape the in-App-Store companion consumes. Matches the
// exact projection MOBILE_ASSET_SELECT returns from Prisma — keeps the helper
// happy and the response-shape assertions meaningful.
const mockAsset = {
  id: "asset-1",
  title: "Test Laptop",
  status: "AVAILABLE",
  mainImage: null,
  availableToBook: true,
  category: { name: "Electronics" },
  assetKits: [],
  assetLocations: [{ location: { id: "loc-1", name: "Office A" } }],
  custody: [],
};

const mockBarcode = {
  id: "barcode-1",
  value: "BC001234",
  type: "Code128",
  assetId: "asset-1",
  kitId: null,
  organizationId: "org-1",
  asset: mockAsset,
  kit: null,
};

function createBarcodeRequest(value: string, orgId = "org-1") {
  return new Request(
    `http://localhost:3000/api/mobile/barcode/${encodeURIComponent(
      value
    )}?orgId=${orgId}`,
    {
      headers: { Authorization: "Bearer test-token" },
    }
  );
}

describe("GET /api/mobile/barcode/:value", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    (db.organization.findUnique as any).mockResolvedValue({
      barcodesEnabled: true,
    });

    (getBarcodeByValue as any).mockResolvedValue(mockBarcode);

    // No sibling memberships unless a test sets them up — keeps the
    // cross-workspace lookup out of every current-workspace case.
    (db.userOrganization.findMany as any).mockResolvedValue([]);
    (db.barcode.findMany as any).mockResolvedValue([]);
  });

  it("should resolve a barcode to its linked asset", async () => {
    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.barcode).toBeDefined();
    expect(body.barcode.id).toBe("barcode-1");
    expect(body.barcode.value).toBe("BC001234");
    expect(body.barcode.asset.id).toBe("asset-1");
    expect(body.barcode.asset.title).toBe("Test Laptop");
  });

  it("should return 403 when barcodesEnabled is false", async () => {
    (db.organization.findUnique as any).mockResolvedValue({
      barcodesEnabled: false,
    });

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not enabled");
  });

  it("should return 404 when barcode is not found", async () => {
    (getBarcodeByValue as any).mockResolvedValue(null);

    const request = createBarcodeRequest("UNKNOWN");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "UNKNOWN" },
      })
    );

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not found");
  });

  it("resolves a sibling workspace's barcode and names the owning workspace", async () => {
    // Miss in the current workspace, unique hit in the one entitled sibling.
    (getBarcodeByValue as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...mockBarcode, organizationId: "org-2" });
    (db.userOrganization.findMany as any).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: true } },
    ]);
    // Phase 1 answers "which of my workspaces hold this value" in one query.
    (db.barcode.findMany as any).mockResolvedValue([
      { organizationId: "org-2" },
    ]);

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({ request, params: { value: "BC001234" } })
    );

    const body = await (result as unknown as Response).json();
    // The OWNING workspace id drives the app's switch-and-view card.
    expect(body.barcode.organizationId).toBe("org-2");
    expect(body.barcode.asset.id).toBe("asset-1");

    // One query to locate the workspace, then ONE heavy fetch for the winner —
    // not one per membership. `getBarcodeByValue` runs twice in total: the
    // current workspace, then the resolved sibling.
    expect(db.barcode.findMany).toHaveBeenCalledTimes(1);
    expect(getBarcodeByValue).toHaveBeenCalledTimes(2);
  });

  it("refuses an ambiguous barcode that exists in several sibling workspaces", async () => {
    (getBarcodeByValue as any).mockResolvedValueOnce(null);
    (db.userOrganization.findMany as any).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: true } },
      { organizationId: "org-3", organization: { barcodesEnabled: true } },
    ]);
    (db.barcode.findMany as any).mockResolvedValue([
      { organizationId: "org-2" },
      { organizationId: "org-3" },
    ]);

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({ request, params: { value: "BC001234" } })
    );

    // 409, not 404: the code exists and the caller may see it — what fails is
    // choosing between workspaces.
    expect((result as unknown as Response).status).toBe(409);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("more than one of your workspaces");
    // Ambiguity is decided before any heavy payload is built.
    expect(getBarcodeByValue).toHaveBeenCalledTimes(1);
  });

  it("never reaches beyond the caller's own memberships", async () => {
    // The property the cross-workspace lookup rests on. A barcode living in a
    // workspace the caller does not belong to must be indistinguishable from a
    // barcode that does not exist — no name, no workspace, no 4xx that differs.
    (getBarcodeByValue as any).mockResolvedValue(null);
    (db.userOrganization.findMany as any).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: true } },
    ]);
    // Phase 1 is scoped to the membership list, so a stranger workspace holding
    // this value can never match.
    (db.barcode.findMany as any).mockResolvedValue([]);

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({ request, params: { value: "BC001234" } })
    );

    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not found");

    // The membership query is what bounds the blast radius: scoped to THIS
    // user, and excluding the workspace already searched.
    expect(db.userOrganization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", organizationId: { not: "org-1" } },
      })
    );
    // …and the candidate scan may only ever look inside that list.
    expect(db.barcode.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: { in: ["org-2"] },
        }),
      })
    );
  });

  it("never resolves through a sibling workspace without the barcode capability", async () => {
    (getBarcodeByValue as any).mockResolvedValue(null);
    (db.userOrganization.findMany as any).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: false } },
    ]);

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({ request, params: { value: "BC001234" } })
    );

    expect((result as unknown as Response).status).toBe(404);
    // The lookup must not even run against the unentitled sibling.
    expect(getBarcodeByValue as any).toHaveBeenCalledTimes(1);
    expect(db.barcode.findMany).not.toHaveBeenCalled();
  });

  it("should return 422 when barcode is not linked to any asset or kit", async () => {
    (getBarcodeByValue as any).mockResolvedValue({
      ...mockBarcode,
      assetId: null,
      kitId: null,
      asset: null,
    });

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(422);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not linked");
  });

  it("should correctly decode URL-encoded barcode values", async () => {
    const specialValue = "ABC/DEF+GHI";
    const request = createBarcodeRequest(specialValue);
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: encodeURIComponent(specialValue) },
      })
    );

    expect(getBarcodeByValue).toHaveBeenCalledWith(
      expect.objectContaining({
        value: specialValue,
        organizationId: "org-1",
      })
    );

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.barcode).toBeDefined();
  });

  it("should pass the correct organizationId from requireOrganizationAccess", async () => {
    (requireOrganizationAccess as any).mockResolvedValue("org-42");
    (db.organization.findUnique as any).mockResolvedValue({
      barcodesEnabled: true,
    });

    const request = createBarcodeRequest("BC001234", "org-42");
    await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(requireOrganizationAccess).toHaveBeenCalledWith(
      expect.any(Request),
      "user-1"
    );
    expect(db.organization.findUnique).toHaveBeenCalledWith({
      where: { id: "org-42" },
      select: { barcodesEnabled: true },
    });
    expect(getBarcodeByValue).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "BC001234",
        organizationId: "org-42",
      })
    );
  });

  it("should handle auth errors from requireMobileAuth", async () => {
    const authError = new Error("Invalid or expired token");
    (authError as any).status = 401;
    (requireMobileAuth as any).mockRejectedValue(authError);
    (makeShelfError as any).mockReturnValue({
      message: "Invalid or expired token",
      status: 401,
    });

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(401);
  });

  it("should return barcode with kit linkage when no asset", async () => {
    (getBarcodeByValue as any).mockResolvedValue({
      ...mockBarcode,
      assetId: null,
      kitId: "kit-1",
      asset: null,
    });

    const request = createBarcodeRequest("BC001234");
    const result = await loader(
      createLoaderArgs({
        request,
        params: { value: "BC001234" },
      })
    );

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.barcode.kitId).toBe("kit-1");
    expect(body.barcode.asset).toBeNull();
  });
});
