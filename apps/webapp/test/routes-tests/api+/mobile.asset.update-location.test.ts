import { action } from "~/routes/api+/mobile+/asset.update-location";
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

// why: external database — we don't want to hit the real database in tests.
// PR #2533 wraps the asset update + activity-event write in `db.$transaction`,
// so the mock needs a `$transaction` that just invokes the callback with the
// same mocked db as the tx client. Without this the route's tx call returns
// undefined and the test sees `body.asset` undefined.
vi.mock("~/database/db.server", () => {
  const db: any = {
    asset: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    location: {
      findFirst: vi.fn(),
    },
  };
  db.$transaction = vi.fn((callback: (tx: typeof db) => Promise<unknown>) =>
    callback(db)
  );
  return { db };
});

// why: the route records an `ASSET_LOCATION_CHANGED` activity event inside the
// transaction. We mock the service so tests don't try to write to the real
// `activityEvent` table.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn(),
}));

// why: external service — we don't want to create real notes in the database
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

// why: utility functions used for note formatting — we mock to avoid internal dependencies
vi.mock("~/utils/markdoc-wrappers", () => ({
  wrapUserLinkForNote: vi.fn(
    ({ firstName, lastName }: any) => `[${firstName} ${lastName}]`
  ),
  wrapLinkForNote: vi.fn((_path: string, name: string) => `[${name}]`),
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
  return new Request(
    "http://localhost/api/mobile/asset/update-location?orgId=org-1",
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

describe("POST /api/mobile/asset/update-location", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
  });

  it("should update asset location and create a note", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      id: "asset-1",
      title: "Test Laptop",
      location: { id: "loc-old", name: "Old Office" },
      kit: null,
    });
    (db.location.findFirst as any).mockResolvedValue({
      id: "loc-new",
      name: "New Office",
    });
    (db.asset.update as any).mockResolvedValue({
      id: "asset-1",
      title: "Test Laptop",
      location: { id: "loc-new", name: "New Office" },
    });
    (createNote as any).mockResolvedValue({ id: "note-1" });

    const request = createRequest({
      assetId: "asset-1",
      locationId: "loc-new",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.location.name).toBe("New Office");

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
      })
    );
  });

  it("should short-circuit (no update, no event, no note) when location is unchanged", async () => {
    // why: codified by `.claude/rules/bulk-event-parity.md` — the singular
    // mobile path must filter out no-op location moves the same way
    // `bulkUpdateAssetLocation` does, so reports don't count phantom
    // `ASSET_LOCATION_CHANGED` events with fromValue === toValue.
    const { recordEvent } = await import(
      "~/modules/activity-event/service.server"
    );
    (db.asset.findUnique as any).mockResolvedValue({
      id: "asset-1",
      title: "Test Laptop",
      location: { id: "loc-same", name: "Same Office" },
      kit: null,
    });
    (db.location.findFirst as any).mockResolvedValue({
      id: "loc-same",
      name: "Same Office",
    });

    const request = createRequest({
      assetId: "asset-1",
      locationId: "loc-same",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.location.id).toBe("loc-same");

    // No write, no event, no note when the location is unchanged.
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("should return 404 when asset is not found", async () => {
    (db.asset.findUnique as any).mockResolvedValue(null);

    const request = createRequest({
      assetId: "nonexistent",
      locationId: "loc-1",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(404);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("not found");
  });

  it("should return 400 when asset belongs to a kit", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      id: "asset-1",
      title: "Kit Asset",
      location: null,
      kit: { id: "kit-1", name: "Server Kit" },
    });

    const request = createRequest({
      assetId: "asset-1",
      locationId: "loc-1",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("kit");
  });

  it("should return 403 when permission is denied", async () => {
    const permError = new Error("Forbidden");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createRequest({
      assetId: "asset-1",
      locationId: "loc-1",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });
});
