import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";
import { loader } from "~/routes/api+/assets";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("@remix-run/node", async () => {
  const actual = await vitest.importActual("@remix-run/node");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// Mock dependencies
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vitest.fn(),
    },
  },
}));

vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));

vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn(),
}));

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  appVersion: "test",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

const mockAssets = [
  {
    id: "asset-1",
    title: "Laptop Dell",
    mainImage: "https://example.com/laptop.jpg",
  },
  {
    id: "asset-2",
    title: "Mouse Logitech",
    mainImage: "https://example.com/mouse.jpg",
  },
];

describe("/api/assets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (requirePermission as any).mockResolvedValue({
      organizationId: "org-1",
    });
  });

  describe("loader", () => {
    it("should return assets for valid IDs", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1,asset-2"
      );

      (db.asset.findMany as any).mockResolvedValue(mockAssets);

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(requirePermission).toHaveBeenCalledWith({
        request: mockRequest,
        userId: "user-1",
        entity: "asset",
        action: "read",
      });

      expect(db.asset.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["asset-1", "asset-2"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          title: true,
          mainImage: true,
        },
        orderBy: {
          title: "asc",
        },
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        assets: mockAssets,
      });
    });

    it("should return empty array when no ids parameter provided", async () => {
      const mockRequest = new Request("http://localhost:3000/api/assets");

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        assets: [],
      });

      expect(db.asset.findMany).not.toHaveBeenCalled();
    });

    it("should return empty array when ids parameter is empty", async () => {
      const mockRequest = new Request("http://localhost:3000/api/assets?ids=");

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        assets: [],
      });

      expect(db.asset.findMany).not.toHaveBeenCalled();
    });

    it("should filter out empty strings from ids", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1,,asset-2,"
      );

      (db.asset.findMany as any).mockResolvedValue(mockAssets);

      await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(db.asset.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["asset-1", "asset-2"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          title: true,
          mainImage: true,
        },
        orderBy: {
          title: "asc",
        },
      });
    });

    it("should handle single asset ID", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1"
      );

      const singleAsset = [mockAssets[0]];
      (db.asset.findMany as any).mockResolvedValue(singleAsset);

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(db.asset.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["asset-1"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          title: true,
          mainImage: true,
        },
        orderBy: {
          title: "asc",
        },
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        assets: singleAsset,
      });
    });

    it("should enforce organization-level security", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1,asset-2"
      );

      await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(db.asset.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["asset-1", "asset-2"] },
          organizationId: "org-1", // Should filter by organization
        },
        select: {
          id: true,
          title: true,
          mainImage: true,
        },
        orderBy: {
          title: "asc",
        },
      });
    });

    it("should handle permission errors", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1"
      );

      const permissionError = new Error("Permission denied");
      (requirePermission as any).mockRejectedValue(permissionError);

      const shelfError = { status: 403, message: "Permission denied" };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(makeShelfError).toHaveBeenCalledWith(permissionError, {
        userId: "user-1",
      });

      // Error case returns Response
      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(403);
      const responseData = await (result as unknown as Response).json();
      expect(responseData).toEqual({
        error: expect.objectContaining({
          message: "Permission denied",
        }),
      });
    });

    it("should handle database errors", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1"
      );

      const dbError = new Error("Database connection failed");
      (db.asset.findMany as any).mockRejectedValue(dbError);

      const shelfError = { status: 500, message: "Database error" };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(makeShelfError).toHaveBeenCalledWith(dbError, {
        userId: "user-1",
      });

      // Error case returns Response
      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(500);
      const responseData = await (result as unknown as Response).json();
      expect(responseData).toEqual({
        error: expect.objectContaining({
          message: "Database error",
        }),
      });
    });

    it("should return assets ordered by title", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1,asset-2"
      );

      (db.asset.findMany as any).mockResolvedValue(mockAssets);

      await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(db.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            title: "asc",
          },
        })
      );
    });

    it("should only select required fields", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/assets?ids=asset-1"
      );

      (db.asset.findMany as any).mockResolvedValue([mockAssets[0]]);

      await loader(
        createLoaderArgs({
          request: mockRequest,
          context: mockContext,
          params: {},
        })
      );

      expect(db.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            title: true,
            mainImage: true,
          },
        })
      );
    });
  });
});
