/**
 * Asset create route: a picked model fills the form's blank fields.
 *
 * The fill runs on the submitted form before it is validated, so a required
 * custom field the model covers passes validation and `createAsset` receives
 * the model's value like any typed value. Anything the user typed wins.
 *
 * The fill itself (`fillAssetFormDataFromModel`) runs for real; only the
 * model read behind Prisma is stubbed.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.new.tsx}
 * @see {@link file://./../../../app/modules/asset-model/defaults.server.ts}
 */
import type { CustomField } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAsset } from "~/modules/asset/service.server";
import type { AssetModelDefaults } from "~/modules/asset-model/defaults";
import { getAssetModelDefaults } from "~/modules/asset-model/defaults.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { action } from "~/routes/_layout+/assets.new";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: React Router v7 single fetch: `data()` outside a request context
// returns an internal wrapper, not a Response. A real Response makes the
// status directly assertable.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), { status: init?.status ?? 200 })
    ),
  };
});

// why: the real db.server connects at module load; every read the action
// makes goes through a stubbed service below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: permission resolution is an auth boundary, not the unit here.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the create writes through Prisma and has its own suite; here it is the
// assertion target for what the form handed it.
vi.mock("~/modules/asset/service.server", () => ({
  bulkCreateAssetsFromModel: vi.fn(),
  createAsset: vi.fn(),
  getAllEntriesForCreateAndEdit: vi.fn(),
  updateAssetMainImage: vi.fn(),
}));

// why: loader-only sequence read behind Postgres.
vi.mock("~/modules/asset/sequential-id.server", () => ({
  estimateNextSequentialId: vi.fn(),
}));

// why: only the model read is stubbed (it is Prisma); the fill keeps its real
// implementation, since that is what the route wires in.
vi.mock("~/modules/asset-model/defaults.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "~/modules/asset-model/defaults.server"
  )),
  getAssetModelDefaults: vi.fn(),
}));

// why: loader-only model reads behind Prisma.
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModel: vi.fn(),
  getAssetModels: vi.fn(),
}));

// why: custom field definitions come from Prisma; each test states the one
// field the form has.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(),
}));

// why: the creation note is written through Prisma and not asserted here.
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn(),
}));

// why: loader-only QR ownership check behind Prisma.
vi.mock("~/modules/qr/service.server", () => ({
  assertWhetherQrBelongsToCurrentOrganization: vi.fn(),
}));

// why: tag resolution reads Prisma; the form submits no tags.
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));

// why: notifications go over the event bus; not asserted here.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** A required Brand text field, as `getActiveCustomFields` returns it. */
const brandField = {
  id: "brand",
  name: "Brand",
  type: "TEXT",
  required: true,
  helpText: null,
  options: [],
  active: true,
} as unknown as CustomField;

/** A model with a category, a valuation and a Brand default. */
const model: AssetModelDefaults = {
  id: "model-1",
  name: "Westermo L210",
  defaultCategoryId: "cat-network",
  defaultValuation: 450,
  customFieldDefaults: [
    {
      customFieldId: "brand",
      value: { raw: "Westermo" },
      customField: {
        id: "brand",
        name: "Brand",
        type: "TEXT",
        active: true,
        deletedAt: null,
        options: [],
        categories: [],
      },
    },
  ],
};

/** Posts the create form with the given fields over a blank one. */
function post(fields: Record<string, string>) {
  // why: a URLSearchParams body, not FormData: happy-dom's multipart round
  // trip drops empty-valued fields, and blank fields are the subject here.
  const body = new URLSearchParams({
    title: "Switch 33",
    description: "",
    category: "",
    valuation: "",
    "cf-brand": "",
    ...fields,
  });
  const request = new Request("http://localhost/assets/new", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return action({
    request,
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0]);
}

/** The single payload the action handed to `createAsset`. */
function createAssetPayload() {
  expect(createAsset).toHaveBeenCalledTimes(1);
  return vi.mocked(createAsset).mock.calls[0][0];
}

describe("assets.new: model defaults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(getActiveCustomFields).mockResolvedValue([brandField]);
    vi.mocked(getAssetModelDefaults).mockResolvedValue(model);
    vi.mocked(createAsset).mockResolvedValue({
      id: "asset-1",
      type: "INDIVIDUAL",
      unitOfMeasure: null,
      assetLocations: [],
      user: {
        id: "user-1",
        firstName: "Carlos",
        lastName: "Diaz",
        displayName: null,
      },
    } as unknown as Awaited<ReturnType<typeof createAsset>>);
  });

  it("fills a blank required field from the model before validating", async () => {
    const response = await post({ assetModelId: "model-1" });

    expect(response.status).toBe(302);
    expect(getAssetModelDefaults).toHaveBeenCalledWith({
      assetModelId: "model-1",
      organizationId: "org-1",
    });
    // The filled category decides which custom fields load.
    expect(getActiveCustomFields).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: "cat-network",
    });
    const payload = createAssetPayload();
    expect(payload.categoryId).toBe("cat-network");
    expect(payload.valuation).toBe(450);
    expect(payload.customFieldsValues).toEqual([
      { id: "brand", value: expect.objectContaining({ raw: "Westermo" }) },
    ]);
  });

  it("keeps what the user typed over the model's defaults", async () => {
    await post({
      assetModelId: "model-1",
      category: "cat-mine",
      valuation: "12",
      "cf-brand": "Siemens",
    });

    const payload = createAssetPayload();
    expect(payload.categoryId).toBe("cat-mine");
    expect(payload.valuation).toBe(12);
    expect(payload.customFieldsValues).toEqual([
      { id: "brand", value: expect.objectContaining({ raw: "Siemens" }) },
    ]);
  });

  it("rejects the blank required field when no model is picked", async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect(getAssetModelDefaults).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
  });
});
