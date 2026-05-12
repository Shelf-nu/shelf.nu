import { loader } from "~/routes/api+/mobile+/custom-fields";
import { createLoaderArgs } from "@mocks/remix";

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
}));

// why: external database — the loader calls `db.customField.findMany`
// directly to control the `select` shape. Mocking the DB lets tests assert
// on the `where` clause (category-filter contract) without hitting Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    customField: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// why: error utility — we mock to control error formatting in tests so we
// can assert on the route's status/message behaviour without coupling to
// the real ShelfError internals.
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
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest({
  orgId,
  categoryId,
}: { orgId?: string; categoryId?: string } = {}) {
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  if (categoryId !== undefined) params.set("categoryId", categoryId);
  const qs = params.toString();
  const url = `http://localhost/api/mobile/custom-fields${qs ? `?${qs}` : ""}`;
  return new Request(url, {
    headers: { Authorization: "Bearer test-token" },
  });
}

describe("GET /api/mobile/custom-fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (db.customField.findMany as any).mockResolvedValue([]);
  });

  it("returns 400 when orgId is missing (propagated from requireOrganizationAccess)", async () => {
    const missingOrgError = new Error(
      "Missing organization ID. Pass orgId as query param or x-shelf-organization header."
    );
    (missingOrgError as any).status = 400;
    (requireOrganizationAccess as any).mockRejectedValue(missingOrgError);

    const request = createRequest();
    const result = await loader(createLoaderArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(400);
    expect(db.customField.findMany).not.toHaveBeenCalled();
  });

  it("scopes uncategorized-only fields when no categoryId is provided", async () => {
    const request = createRequest({ orgId: "org-1" });
    await loader(createLoaderArgs({ request }));

    // Without a category, the route must return ONLY uncategorized fields —
    // i.e. those with no related categories at all.
    expect(db.customField.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          categories: { none: {} },
        }),
      })
    );
  });

  it("treats categoryId='uncategorized' as null (uncategorized-only fields)", async () => {
    const request = createRequest({
      orgId: "org-1",
      categoryId: "uncategorized",
    });
    await loader(createLoaderArgs({ request }));

    expect(db.customField.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          categories: { none: {} },
        }),
      })
    );
  });

  it("with a real categoryId returns fields scoped to that category OR uncategorized", async () => {
    const request = createRequest({
      orgId: "org-1",
      categoryId: "cat-42",
    });
    await loader(createLoaderArgs({ request }));

    expect(db.customField.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          OR: [
            { categories: { none: {} } },
            { categories: { some: { id: "cat-42" } } },
          ],
        }),
      })
    );
  });

  it("returns each field shaped with id, name, type, helpText, required, options", async () => {
    (db.customField.findMany as any).mockResolvedValue([
      {
        id: "cf-1",
        name: "Serial Number",
        type: "TEXT",
        helpText: "Where to find it",
        required: true,
        options: [],
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "cf-2",
        name: "Condition",
        type: "OPTION",
        helpText: null,
        required: false,
        options: ["new", "used"],
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const request = createRequest({ orgId: "org-1" });
    const result = await loader(createLoaderArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(Array.isArray(body.customFields)).toBe(true);
    expect(body.customFields).toHaveLength(2);

    for (const cf of body.customFields) {
      expect(cf).toHaveProperty("id");
      expect(cf).toHaveProperty("name");
      expect(cf).toHaveProperty("type");
      expect(cf).toHaveProperty("helpText");
      expect(cf).toHaveProperty("required");
      // `options` is always present in the JSON response; it is the actual
      // option array for OPTION fields and `null` for every other type. This
      // keeps the wire shape in sync with the companion's exported
      // `MobileCustomFieldDefinition.options: string[] | null` type.
      expect(cf).toHaveProperty("options");
      if (cf.type === "OPTION") {
        expect(Array.isArray(cf.options)).toBe(true);
      } else {
        expect(cf.options).toBeNull();
      }
    }

    expect(body.customFields[0]).toMatchObject({
      id: "cf-1",
      name: "Serial Number",
      type: "TEXT",
      helpText: "Where to find it",
      required: true,
      options: null,
    });
    expect(body.customFields[1]).toMatchObject({
      id: "cf-2",
      name: "Condition",
      type: "OPTION",
      helpText: null,
      required: false,
      options: ["new", "used"],
    });
  });
});
