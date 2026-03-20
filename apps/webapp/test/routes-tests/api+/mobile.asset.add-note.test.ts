import { action } from "~/routes/api+/mobile+/asset.add-note";
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

// why: external service — we don't want to create real notes in the database
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
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
import { createNote } from "~/modules/note/service.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/mobile/asset/add-note?orgId=org-1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/asset/add-note", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
  });

  it("should create a note and return it", async () => {
    (db.asset.findUnique as any).mockResolvedValue({ id: "asset-1" });
    (createNote as any).mockResolvedValue({
      id: "note-1",
      content: "This is a test note",
      type: "COMMENT",
    });

    const request = createRequest({
      assetId: "asset-1",
      content: "This is a test note",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.note.id).toBe("note-1");
    expect(body.note.content).toBe("This is a test note");

    expect(createNote).toHaveBeenCalledWith({
      content: "This is a test note",
      type: "COMMENT",
      userId: "user-1",
      assetId: "asset-1",
    });
  });

  it("should return 404 when asset is not found (wrong org)", async () => {
    (db.asset.findUnique as any).mockResolvedValue(null);

    const request = createRequest({
      assetId: "nonexistent",
      content: "A note",
    });
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

    const request = createRequest({
      assetId: "asset-1",
      content: "A note",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });
});
