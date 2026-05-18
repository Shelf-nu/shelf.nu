import { action } from "~/routes/api+/mobile+/asset.create";
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

// why: external service — we don't want to hit the real database when creating assets
vi.mock("~/modules/asset/service.server", () => ({
  createAsset: vi.fn(),
}));

// why: route verifies `categoryId` belongs to the caller's org via the DB
// before trusting it. Mock the DB so tests can simulate "category exists"
// (default) and "category not in org" without hitting Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    category: {
      findFirst: vi.fn().mockResolvedValue({ id: "cat-42" }),
    },
  },
}));

// why: avoid hitting the DB to load org custom field defs; tests control the
// returned defs per-case to exercise the required-field validation contract.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));

// why: spy on the validator so we can assert it received the org-scoped defs
// and the cf-{id} reshape from the mobile array contract. Default returns []
// so it acts as a pass-through that doesn't surprise the route.
vi.mock("~/utils/custom-fields", () => ({
  extractCustomFieldValuesFromPayload: vi.fn(() => []),
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
import { createAsset } from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(
  body: Record<string, unknown>,
  { orgId = "org-1" }: { orgId?: string } = {}
) {
  const url = orgId
    ? `http://localhost/api/mobile/asset/create?orgId=${orgId}`
    : "http://localhost/api/mobile/asset/create";
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/asset/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (getActiveCustomFields as any).mockResolvedValue([]);
    (extractCustomFieldValuesFromPayload as any).mockReturnValue([]);
    // Default: any category referenced by tests exists in the caller's org.
    (db.category.findFirst as any).mockResolvedValue({ id: "cat-1" });
  });

  it("should create an asset and return its id and title", async () => {
    (createAsset as any).mockResolvedValue({
      id: "asset-1",
      title: "New Laptop",
    });

    const request = createRequest({ title: "New Laptop" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.title).toBe("New Laptop");

    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Laptop",
        userId: "user-1",
        organizationId: "org-1",
      })
    );
  });

  it("should return validation error when title is too short", async () => {
    const request = createRequest({ title: "A" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBeGreaterThanOrEqual(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toBeDefined();
  });

  it("should return 403 when permission is denied", async () => {
    const permError = new Error("Forbidden");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createRequest({ title: "New Laptop" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });

  describe("required custom fields contract", () => {
    it("rejects with 400 and the field name when a required field is missing", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({ title: "New Laptop" });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("creates the asset when a required field is present with a non-empty value", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-serial", value: { raw: "SN-123" } },
      ]);
      (createAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "New Laptop",
      });

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: "SN-123" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          customFieldsValues: [{ id: "cf-serial", value: { raw: "SN-123" } }],
        })
      );
    });

    it("rejects with 400 when a required field is explicitly set to null", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: null }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("rejects with 400 when a required field is explicitly set to empty string", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: "" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("lists every missing required field in the error message", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-a", name: "Serial Number", required: true },
        { id: "cf-b", name: "Asset Tag", required: true },
        { id: "cf-c", name: "Description", required: false },
      ]);

      const request = createRequest({ title: "New Laptop" });
      const result = await action(createActionArgs({ request }));

      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(body.error.message).toContain("Asset Tag");
      expect(body.error.message).not.toContain("Description");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("calls getActiveCustomFields with category: null when no categoryId is provided", async () => {
      (createAsset as any).mockResolvedValue({ id: "asset-1", title: "T" });

      const request = createRequest({ title: "Test Asset" });
      await action(createActionArgs({ request }));

      expect(getActiveCustomFields).toHaveBeenCalledWith({
        organizationId: "org-1",
        category: null,
      });
    });

    it("calls getActiveCustomFields with the provided categoryId", async () => {
      (createAsset as any).mockResolvedValue({ id: "asset-1", title: "T" });
      (db.category.findFirst as any).mockResolvedValue({ id: "cat-42" });

      const request = createRequest({
        title: "Test Asset",
        categoryId: "cat-42",
      });
      await action(createActionArgs({ request }));

      expect(getActiveCustomFields).toHaveBeenCalledWith({
        organizationId: "org-1",
        category: "cat-42",
      });
    });

    it("rejects with 400 'Invalid category' when categoryId is not in the caller's org", async () => {
      // why: the route verifies categoryId belongs to org via db.category
      // .findFirst — returning null means the id is unknown / cross-org.
      (db.category.findFirst as any).mockResolvedValue(null);

      const request = createRequest({
        title: "Test Asset",
        categoryId: "cat-from-another-org",
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Invalid category");
      expect(getActiveCustomFields).not.toHaveBeenCalled();
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("normalises BOOLEAN required field 'true' string to boolean true", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-active",
          name: "Active",
          type: "BOOLEAN",
          required: true,
        },
      ]);
      // Capture the payload the helper saw so we can assert the normalised value.
      let receivedPayload: Record<string, unknown> | undefined;
      (extractCustomFieldValuesFromPayload as any).mockImplementation(
        (args: { payload: Record<string, unknown> }) => {
          receivedPayload = args.payload;
          return [{ id: "cf-active", value: { raw: true } }];
        }
      );
      (createAsset as any).mockResolvedValue({ id: "asset-1", title: "T" });

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-active", value: "true" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(receivedPayload).toEqual({ "cf-cf-active": true });
    });
  });
});
