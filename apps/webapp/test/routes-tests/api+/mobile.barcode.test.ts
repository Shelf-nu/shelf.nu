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
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
}));

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    organization: {
      findUnique: vitest.fn(),
    },
    asset: {
      findUnique: vitest.fn(),
    },
  },
}));

// why: external service — we mock the barcode lookup
vitest.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: vitest.fn(),
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

const mockAsset = {
  id: "asset-1",
  title: "Test Laptop",
  status: "AVAILABLE",
  mainImage: null,
  category: { name: "Electronics" },
  location: { name: "Office A" },
};

const mockBarcode = {
  id: "barcode-1",
  value: "BC001234",
  type: "Code128",
  assetId: "asset-1",
  kitId: null,
  organizationId: "org-1",
  asset: mockAsset,
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
