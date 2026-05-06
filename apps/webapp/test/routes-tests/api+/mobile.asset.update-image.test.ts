import { action } from "~/routes/api+/mobile+/asset.update-image";
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

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: external database — we don't want to hit the real database in tests
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: vi.fn(),
    },
  },
}));

// why: external service — we don't want to actually process images
vi.mock("~/modules/asset/service.server", () => ({
  updateAssetMainImage: vi.fn(),
}));

// why: error utility — we mock to control error formatting in tests
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
import { db } from "~/database/db.server";
import { updateAssetMainImage } from "~/modules/asset/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(assetId?: string) {
  const url = assetId
    ? `http://localhost/api/mobile/asset/update-image?orgId=org-1&assetId=${assetId}`
    : "http://localhost/api/mobile/asset/update-image?orgId=org-1";
  return new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
  });
}

describe("POST /api/mobile/asset/update-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
  });

  it("should update asset image and return updated asset", async () => {
    // First findUnique: verify asset exists
    (db.asset.findUnique as any).mockResolvedValueOnce({
      id: "asset-1",
      title: "Test Laptop",
    });
    (updateAssetMainImage as any).mockResolvedValue(undefined);
    // Second findUnique: fetch updated asset
    (db.asset.findUnique as any).mockResolvedValueOnce({
      id: "asset-1",
      title: "Test Laptop",
      mainImage: "https://storage.example.com/image.jpg",
      thumbnailImage: "https://storage.example.com/thumb.jpg",
    });

    const request = createRequest("asset-1");
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.mainImage).toBe("https://storage.example.com/image.jpg");

    expect(updateAssetMainImage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
      })
    );
  });

  it("should return 400 when assetId query param is missing", async () => {
    const request = createRequest(); // no assetId
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Missing assetId");
  });

  it("should return 404 when asset is not found", async () => {
    (db.asset.findUnique as any).mockResolvedValue(null);

    const request = createRequest("nonexistent");
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not found");
  });

  it("should return 403 when permission is denied", async () => {
    const permError = new Error("Forbidden");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createRequest("asset-1");
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });
});
