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
import { updateAsset } from "~/modules/asset/service.server";
import type { AssetModelDefaults } from "~/modules/asset-model/defaults";
import { getAssetModelDefaults } from "~/modules/asset-model/defaults.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { action } from "~/routes/_layout+/assets.$assetId_.edit";
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
  } as Awaited<ReturnType<typeof db.asset.findFirst>>);
}

/** Posts the edit form with blank category, valuation and Brand. */
function post(fields: Record<string, string> = {}) {
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
  const request = new Request("http://localhost/assets/asset-1/edit", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return action({
    request,
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof action>[0]);
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
