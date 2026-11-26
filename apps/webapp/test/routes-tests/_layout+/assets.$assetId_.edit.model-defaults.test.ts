/**
 * Asset edit route: moving onto a model fills the asset's empty fields.
 *
 * Only a move onto a DIFFERENT model fills, and only a field that is empty
 * both in the submitted form and on the saved asset: a field the asset already
 * holds is never filled, even if the form left it blank.
 *
 * The fill itself (`fillAssetFormDataFromModel`) runs for real; the saved
 * asset and the model are read from stubs.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId_.edit.tsx}
 * @see {@link file://./../../../app/modules/asset-model/defaults.server.ts}
 */
import type { CustomField } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import {
  getAllEntriesForCreateAndEdit,
  getAsset,
  updateAsset,
} from "~/modules/asset/service.server";
import type { AssetModelDefaults } from "~/modules/asset-model/defaults";
import { getAssetModelDefaults } from "~/modules/asset-model/defaults.server";
import { getAssetModels } from "~/modules/asset-model/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { action, loader } from "~/routes/_layout+/assets.$assetId_.edit";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the action reads the saved asset to decide what is empty; each test
// states that row. Nothing else here reaches Prisma.
vi.mock("~/database/db.server", () => ({
  db: { asset: { findFirst: vi.fn() } },
}));

// why: the update writes through Prisma and has its own suite; here it is the
// assertion target for what the form handed it.
vi.mock("~/modules/asset/service.server", () => ({
  getAllEntriesForCreateAndEdit: vi.fn(),
  getAsset: vi.fn(),
  updateAsset: vi.fn(),
  updateAssetMainImage: vi.fn(),
}));

// why: only the model read is stubbed (it is Prisma); the fill keeps its real
// implementation, since that is what the route wires in.
vi.mock("~/modules/asset-model/defaults.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "~/modules/asset-model/defaults.server"
  )),
  getAssetModelDefaults: vi.fn(),
}));

// why: loader-only model list behind Prisma.
vi.mock("~/modules/asset-model/service.server", () => ({
  getAssetModels: vi.fn(),
}));

// why: custom field definitions come from Prisma; each test gets one optional
// Brand field.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(),
}));

// why: tag resolution reads Prisma; the form submits no tags.
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));

// why: permission resolution is an auth boundary, not the unit here.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: notifications go over the event bus; not asserted here.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** An optional Brand text field, as `getActiveCustomFields` returns it. */
const brandField = {
  id: "brand",
  name: "Brand",
  type: "TEXT",
  required: false,
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

/** The saved asset row the action reads. */
function savedAsset(overrides: {
  assetModelId?: string | null;
  categoryId?: string | null;
  valuation?: number | null;
  customFields?: { customFieldId: string }[];
}) {
  vi.mocked(db.asset.findFirst).mockResolvedValue({
    assetModelId: null,
    categoryId: null,
    valuation: null,
    customFields: [],
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof db.asset.findFirst>>);
}

/** Posts the edit form with blank category, valuation and Brand. */
async function post(
  fields: Record<string, string> = {},
  query = ""
): Promise<Response> {
  // why: a URLSearchParams body, not FormData: happy-dom's multipart round
  // trip drops empty-valued fields, and blank fields are the subject here.
  const body = new URLSearchParams({
    title: "Switch 33",
    description: "",
    category: "uncategorized",
    valuation: "",
    "cf-brand": "",
    assetModelId: "model-1",
    ...fields,
  });
  const request = new Request(`http://localhost/assets/asset-1/edit${query}`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  // The action answers with a Response on every path these tests take.
  return (await action({
    request,
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0])) as unknown as Response;
}

/** The single payload the action handed to `updateAsset`. */
function updateAssetPayload() {
  expect(updateAsset).toHaveBeenCalledTimes(1);
  return vi.mocked(updateAsset).mock.calls[0][0];
}

/** The Brand value handed to `updateAsset`, if any. */
function submittedBrand() {
  return updateAssetPayload().customFieldsValues?.find(
    (value) => value.id === "brand"
  )?.value;
}

describe("assets.$assetId_.edit: model defaults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      canUseBarcodes: false,
    } as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(getActiveCustomFields).mockResolvedValue([brandField]);
    vi.mocked(getAssetModelDefaults).mockResolvedValue(model);
    vi.mocked(updateAsset).mockResolvedValue({
      id: "asset-1",
      title: "Switch 33",
    } as Awaited<ReturnType<typeof updateAsset>>);
  });

  it("fills the empty fields when the asset moves onto a different model", async () => {
    savedAsset({ assetModelId: null });

    await post();

    expect(db.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1", organizationId: "org-1", archivedAt: null },
      })
    );
    const payload = updateAssetPayload();
    expect(payload.categoryId).toBe("cat-network");
    expect(payload.valuation).toBe(450);
    expect(submittedBrand()).toEqual(
      expect.objectContaining({ raw: "Westermo" })
    );
  });

  it("loads the custom fields of the category the model fills, not the one in the URL", async () => {
    savedAsset({ assetModelId: null });

    // The Category picker writes its choice to the URL, so a user who picked
    // Uncategorized submits ?category=uncategorized while the model fills
    // its own category on the server.
    await post({}, "?category=uncategorized");

    expect(updateAssetPayload().categoryId).toBe("cat-network");
    expect(getActiveCustomFields).toHaveBeenCalledWith(
      expect.objectContaining({ category: "cat-network" })
    );
  });

  it("fills nothing when the asset stays on the same model", async () => {
    savedAsset({ assetModelId: "model-1" });

    await post();

    expect(getAssetModelDefaults).not.toHaveBeenCalled();
    const payload = updateAssetPayload();
    expect(payload.categoryId).toBe("uncategorized");
    expect(payload.valuation).toBeNull();
    expect(submittedBrand()?.raw).not.toBe("Westermo");
  });

  it("does not fill a field the saved asset holds, even if the form left it blank", async () => {
    savedAsset({
      assetModelId: "model-old",
      categoryId: "cat-saved",
      valuation: 99,
      customFields: [{ customFieldId: "brand" }],
    });

    await post();

    expect(getAssetModelDefaults).toHaveBeenCalledWith({
      assetModelId: "model-1",
      organizationId: "org-1",
    });
    // The form's own (blank) answers go through unchanged.
    const payload = updateAssetPayload();
    expect(payload.categoryId).toBe("uncategorized");
    expect(payload.valuation).toBeNull();
    expect(submittedBrand()?.raw).not.toBe("Westermo");
  });
});

describe("assets.$assetId_.edit loader: the asset's own model", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: { currency: "USD" },
      userOrganizations: [],
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);
    vi.mocked(getAllEntriesForCreateAndEdit).mockResolvedValue({
      categories: [],
      totalCategories: 0,
      tags: [],
      locations: [],
      totalLocations: 0,
    } as unknown as Awaited<ReturnType<typeof getAllEntriesForCreateAndEdit>>);
    vi.mocked(getAssetModels).mockResolvedValue({
      assetModels: [],
      totalAssetModels: 0,
    } as unknown as Awaited<ReturnType<typeof getAssetModels>>);
    vi.mocked(getActiveCustomFields).mockResolvedValue([]);
  });

  /** Runs the loader for an asset on the given model. */
  async function load(assetModelId: string | null) {
    vi.mocked(getAsset).mockResolvedValue({
      id: "asset-1",
      title: "Switch 33",
      archivedAt: null,
      categoryId: null,
      assetModelId,
      assetLocations: [],
    } as unknown as Awaited<ReturnType<typeof getAsset>>);

    return loader({
      request: new Request("http://localhost/assets/asset-1/edit"),
      params: { assetId: "asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as unknown as Parameters<typeof loader>[0]);
  }

  it("asks for the asset's model even when it is outside the first page", async () => {
    await load("model-old");

    // A select shows its value only if the value is among its options, so the
    // list must carry the asset's model.
    expect(getAssetModels).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        includeId: "model-old",
      })
    );
  });

  it("asks for no extra model when the asset has none", async () => {
    await load(null);

    expect(getAssetModels).toHaveBeenCalledWith(
      expect.objectContaining({ includeId: null })
    );
  });
});
