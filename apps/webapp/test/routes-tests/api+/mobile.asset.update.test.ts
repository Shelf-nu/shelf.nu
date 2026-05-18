import { action } from "~/routes/api+/mobile+/asset.update";
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

// why: external service — we don't want to hit the real database when updating assets
vi.mock("~/modules/asset/service.server", () => ({
  updateAsset: vi.fn(),
}));

// why: when categoryId is omitted from the body, the route looks up the
// asset's persisted category to resolve the right custom-field defs.
// Mocking the DB lets tests control that lookup without hitting Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findUnique: vi.fn().mockResolvedValue({ categoryId: null }),
    },
  },
}));

// why: avoid hitting the DB to load org custom field defs
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));

// why: spy on the validator so we can assert it received the org-scoped defs
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
import { updateAsset } from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/mobile/asset/update?orgId=org-1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/asset/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (db.asset.findUnique as any).mockResolvedValue({ categoryId: null });
  });

  it("should update an asset and return the updated data", async () => {
    (updateAsset as any).mockResolvedValue({
      id: "asset-1",
      title: "Updated Laptop",
      description: "New description",
    });

    const request = createRequest({
      assetId: "asset-1",
      title: "Updated Laptop",
      description: "New description",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.title).toBe("Updated Laptop");
    expect(body.asset.description).toBe("New description");

    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        title: "Updated Laptop",
        description: "New description",
      })
    );
  });

  it("should return 403 when permission is denied", async () => {
    const permError = new Error("Forbidden");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createRequest({
      assetId: "asset-1",
      title: "Updated Laptop",
    });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });

  it("should return validation error when assetId is missing", async () => {
    const request = createRequest({ title: "Updated Laptop" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBeGreaterThanOrEqual(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toBeDefined();
  });

  it("validates customFields against org-scoped definitions before update", async () => {
    // why: route now rejects unknown custom-field ids up front. Provide
    // matching defs so we exercise the validator path the test cares about.
    const defs = [
      { id: "cf-text-1", name: "Notes", type: "TEXT", required: false },
      { id: "cf-num-1", name: "Quantity", type: "NUMBER", required: false },
    ];
    (getActiveCustomFields as any).mockResolvedValue(defs);
    (updateAsset as any).mockResolvedValue({
      id: "asset-1",
      title: "T",
      description: null,
    });

    const request = createRequest({
      assetId: "asset-1",
      categoryId: "cat-1",
      customFields: [
        { id: "cf-text-1", value: "hello" },
        { id: "cf-num-1", value: 42 },
      ],
    });

    const result = await action(createActionArgs({ request }));
    expect(result instanceof Response).toBe(true);

    // org-scoped defs were loaded for the right org and category
    expect(getActiveCustomFields).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: "cat-1",
    });

    // values were validated through the helper, not passed through raw
    expect(extractCustomFieldValuesFromPayload).toHaveBeenCalledWith({
      payload: {
        "cf-cf-text-1": "hello",
        "cf-cf-num-1": 42,
      },
      customFieldDef: defs,
    });
  });

  describe("required custom fields contract", () => {
    it("rejects with 400 when explicitly clearing a required field to null", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-serial", name: "Serial Number", required: true },
      ]);

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-serial", value: null }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain(
        "Cannot clear required custom field"
      );
      expect(body.error.message).toContain("Serial Number");
      expect(updateAsset).not.toHaveBeenCalled();
    });

    it("rejects with 400 when explicitly clearing a required field to empty string", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-serial", name: "Serial Number", required: true },
      ]);

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-serial", value: "" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(updateAsset).not.toHaveBeenCalled();
    });

    it("allows a partial update that omits required field ids entirely", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-serial", name: "Serial Number", required: true },
      ]);
      (updateAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "New Title",
        description: null,
      });

      // Only touching title — required custom field is left untouched. Update
      // is partial, so this must succeed.
      const request = createRequest({
        assetId: "asset-1",
        title: "New Title",
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(updateAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "asset-1",
          title: "New Title",
        })
      );
    });

    it("allows setting a required field to a new non-empty value", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-serial", name: "Serial Number", required: true },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-serial", value: { raw: "SN-NEW" } },
      ]);
      (updateAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "T",
        description: null,
      });

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-serial", value: "SN-NEW" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(updateAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          customFieldsValues: [{ id: "cf-serial", value: { raw: "SN-NEW" } }],
        })
      );
    });
  });

  describe("wire contract: customFields value must be a primitive", () => {
    // why: the companion's edit screen previously wrapped the value in
    // `{ raw: ... }`, which Zod rejected, surfacing as a generic
    // "Sorry, something went wrong" 500 to the user (any custom field
    // edit was broken in production). This block locks the wire
    // contract — `value` is `string | number | boolean | null` — so a
    // future client that drifts back to the wrapped shape fails loud
    // in tests instead of in customers' hands.
    it("rejects a wrapped { raw: ... } object as the value", async () => {
      // why: seed a matching definition so the test path is unambiguously
      // the Zod parse failure on `value`, not the unknown-id rejection
      // that runs against an empty defs array.
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-text-1", name: "Notes", type: "TEXT", required: false },
      ]);

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-text-1", value: { raw: "hello" } }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      // Zod parse throws ZodError → caught by the route → makeShelfError
      // wraps it. The mock at the top of this file (`vi.mock` for
      // ~/utils/error) doesn't extract a status from ZodError, so the
      // fallback `cause?.status || 500` returns 500. Assert that exact
      // status — looser checks (e.g. `!= 200`) accept 401/403 and miss
      // a future regression where auth fails before validation.
      expect((result as unknown as Response).status).toBe(500);
      expect(updateAsset).not.toHaveBeenCalled();
    });

    it("accepts a raw string for DATE / TEXT / OPTION values", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-date", name: "Purchase date", type: "DATE", required: true },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-date", value: { raw: "2026-02-05" } },
      ]);
      (updateAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "T",
        description: null,
      });

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-date", value: "2026-02-05" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
    });

    it("accepts a raw STRING for NUMBER / AMOUNT values (companion sends strings; server coerces)", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-qty", name: "Qty", type: "NUMBER", required: false },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-qty", value: { raw: 42 } },
      ]);
      (updateAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "T",
        description: null,
      });

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-qty", value: "42" }],
      });
      const result = await action(createActionArgs({ request }));

      expect((result as unknown as Response).status).toBe(200);
    });

    it("accepts a raw STRING for BOOLEAN values (server coerces 'true'/'false')", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-warranty",
          name: "Under warranty",
          type: "BOOLEAN",
          required: false,
        },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-warranty", value: { raw: true } },
      ]);
      (updateAsset as any).mockResolvedValue({
        id: "asset-1",
        title: "T",
        description: null,
      });

      const request = createRequest({
        assetId: "asset-1",
        customFields: [{ id: "cf-warranty", value: "true" }],
      });
      const result = await action(createActionArgs({ request }));

      expect((result as unknown as Response).status).toBe(200);
    });
  });
});
