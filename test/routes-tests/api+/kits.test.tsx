import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";
import { loader } from "~/routes/api+/kits";

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
    kit: {
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

const mockKits = [
  {
    id: "kit-1",
    name: "Photography Kit",
    image: "kit-image-1.jpg",
    imageExpiration: "2024-12-31T23:59:59Z",
    assets: [
      {
        id: "asset-1",
        title: "Canon Camera",
        mainImage: "camera.jpg",
        mainImageExpiration: "2024-12-31T23:59:59Z",
        category: {
          name: "Cameras",
        },
      },
      {
        id: "asset-2",
        title: "Tripod",
        mainImage: "tripod.jpg",
        mainImageExpiration: "2024-12-31T23:59:59Z",
        category: {
          name: "Accessories",
        },
      },
    ],
    _count: {
      assets: 2,
    },
  },
  {
    id: "kit-2",
    name: "Video Production Kit",
    image: "kit-image-2.jpg",
    imageExpiration: "2024-12-31T23:59:59Z",
    assets: [
      {
        id: "asset-3",
        title: "Video Camera",
        mainImage: "video-camera.jpg",
        mainImageExpiration: "2024-12-31T23:59:59Z",
        category: {
          name: "Cameras",
        },
      },
    ],
    _count: {
      assets: 1,
    },
  },
];

describe("/api/kits", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (requirePermission as any).mockResolvedValue({
      organizationId: "org-1",
    });
  });

  describe("loader", () => {
    it("should return kits for valid IDs", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1,kit-2"
      );

      (db.kit.findMany as any).mockResolvedValue(mockKits);

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(requirePermission).toHaveBeenCalledWith({
        request: mockRequest,
        userId: "user-1",
        entity: "kit",
        action: "read",
      });

      expect(db.kit.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["kit-1", "kit-2"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          name: true,
          image: true,
          imageExpiration: true,
          assets: {
            select: {
              id: true,
              title: true,
              mainImage: true,
              mainImageExpiration: true,
              category: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              title: "asc",
            },
          },
          _count: {
            select: {
              assets: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        kits: mockKits,
      });
    });

    it("should return empty array when no ids parameter provided", async () => {
      const mockRequest = new Request("http://localhost:3000/api/kits");

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        kits: [],
      });

      expect(db.kit.findMany).not.toHaveBeenCalled();
    });

    it("should return empty array when ids parameter is empty", async () => {
      const mockRequest = new Request("http://localhost:3000/api/kits?ids=");

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        kits: [],
      });

      expect(db.kit.findMany).not.toHaveBeenCalled();
    });

    it("should filter out empty strings from ids", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1,,kit-2,"
      );

      (db.kit.findMany as any).mockResolvedValue(mockKits);

      await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(db.kit.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["kit-1", "kit-2"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          name: true,
          image: true,
          imageExpiration: true,
          assets: {
            select: {
              id: true,
              title: true,
              mainImage: true,
              mainImageExpiration: true,
              category: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              title: "asc",
            },
          },
          _count: {
            select: {
              assets: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });
    });

    it("should handle single kit ID", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1"
      );

      const singleKit = [mockKits[0]];
      (db.kit.findMany as any).mockResolvedValue(singleKit);

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(db.kit.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["kit-1"] },
          organizationId: "org-1",
        },
        select: {
          id: true,
          name: true,
          image: true,
          imageExpiration: true,
          assets: {
            select: {
              id: true,
              title: true,
              mainImage: true,
              mainImageExpiration: true,
              category: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              title: "asc",
            },
          },
          _count: {
            select: {
              assets: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });

      // Success case returns plain object, not Response
      expect(result).toEqual({
        error: null,
        kits: singleKit,
      });
    });

    it("should enforce organization-level security", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1,kit-2"
      );

      await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(db.kit.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["kit-1", "kit-2"] },
          organizationId: "org-1", // Should filter by organization
        },
        select: {
          id: true,
          name: true,
          image: true,
          imageExpiration: true,
          assets: {
            select: {
              id: true,
              title: true,
              mainImage: true,
              mainImageExpiration: true,
              category: {
                select: {
                  name: true,
                },
              },
            },
            orderBy: {
              title: "asc",
            },
          },
          _count: {
            select: {
              assets: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      });
    });

    it("should handle permission errors", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1"
      );

      const permissionError = new Error("Permission denied");
      (requirePermission as any).mockRejectedValue(permissionError);

      const shelfError = { status: 403, message: "Permission denied" };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

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
        "http://localhost:3000/api/kits?ids=kit-1"
      );

      const dbError = new Error("Database connection failed");
      (db.kit.findMany as any).mockRejectedValue(dbError);

      const shelfError = { status: 500, message: "Database error" };
      (makeShelfError as any).mockReturnValue(shelfError);

      const result = await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

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

    it("should return kits ordered by name", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1,kit-2"
      );

      (db.kit.findMany as any).mockResolvedValue(mockKits);

      await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(db.kit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            name: "asc",
          },
        })
      );
    });

    it("should only select required fields", async () => {
      const mockRequest = new Request(
        "http://localhost:3000/api/kits?ids=kit-1"
      );

      (db.kit.findMany as any).mockResolvedValue([mockKits[0]]);

      await loader({
        request: mockRequest,
        context: mockContext,
        params: {},
      });

      expect(db.kit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            name: true,
            image: true,
            imageExpiration: true,
            assets: expect.any(Object),
            _count: expect.any(Object),
          },
        })
      );
    });
  });
});
