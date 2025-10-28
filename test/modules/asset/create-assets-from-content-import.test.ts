import type { CustomField } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { ShelfError } from "~/utils/error";

const dbMocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  assetCreate: vi.fn(),
  kitFindMany: vi.fn(),
  kitUpdate: vi.fn(),
}));

const moduleMocks = vi.hoisted(() => ({
  createCustomFieldsIfNotExists: vi.fn(),
  parseQrCodesFromImportData: vi.fn(),
  parseBarcodesFromImportData: vi.fn(),
  createKitsIfNotExists: vi.fn(),
  createCategoriesIfNotExists: vi.fn(),
  createLocationsIfNotExists: vi.fn(),
  createTeamMemberIfNotExists: vi.fn(),
  createTagsIfNotExists: vi.fn(),
  getQr: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    $queryRaw: dbMocks.queryRaw,
    asset: { create: dbMocks.assetCreate },
    kit: { findMany: dbMocks.kitFindMany, update: dbMocks.kitUpdate },
  },
}));

vi.mock("~/modules/custom-field/service.server", () => ({
  createCustomFieldsIfNotExists: moduleMocks.createCustomFieldsIfNotExists,
  getActiveCustomFields: vi.fn(),
  upsertCustomField: vi.fn(),
}));

vi.mock("~/modules/qr/service.server", () => ({
  getQr: moduleMocks.getQr,
  parseQrCodesFromImportData: moduleMocks.parseQrCodesFromImportData,
}));

vi.mock("~/modules/barcode/service.server", () => ({
  parseBarcodesFromImportData: moduleMocks.parseBarcodesFromImportData,
  updateBarcodes: vi.fn(),
  validateBarcodeUniqueness: vi.fn(),
}));

vi.mock("~/modules/kit/service.server", () => ({
  createKitsIfNotExists: moduleMocks.createKitsIfNotExists,
}));

vi.mock("~/modules/category/service.server", () => ({
  createCategoriesIfNotExists: moduleMocks.createCategoriesIfNotExists,
}));

vi.mock("~/modules/location/service.server", () => ({
  createLocationsIfNotExists: moduleMocks.createLocationsIfNotExists,
  createLocationChangeNote: vi.fn(),
}));

vi.mock("~/modules/team-member/service.server", () => ({
  createTeamMemberIfNotExists: moduleMocks.createTeamMemberIfNotExists,
  getTeamMemberForCustodianFilter: vi.fn(),
}));

vi.mock("~/modules/tag/service.server", () => ({
  createTagsIfNotExists: moduleMocks.createTagsIfNotExists,
}));

vi.mock("~/utils/id/id.server", () => ({
  id: () => "generated-id",
}));

vi.mock("~/utils/import.image-cache.server", () => ({
  MAX_CACHE_SIZE: 10,
}));

vi.mock("~/utils/storage.server", () => ({
  createSignedUrl: vi.fn(),
  parseFileFormData: vi.fn(),
  uploadImageFromUrl: vi.fn(),
}));

const userId = "user-1";
const organizationId = "org-1";

const amountCustomField: CustomField = {
  id: "cf_amount",
  name: "Budget",
  helpText: null,
  required: false,
  active: true,
  type: "AMOUNT",
  options: [],
  organizationId,
  userId,
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
};

const numberCustomField: CustomField = {
  ...amountCustomField,
  id: "cf_number",
  name: "Quantity",
  type: "NUMBER",
};

function buildImportData(value: string): CreateAssetFromContentImportPayload[] {
  return [
    {
      key: "row-1",
      title: "Camera",
      "cf:Budget,type:amount": value,
    } as CreateAssetFromContentImportPayload,
  ];
}

describe("createAssetsFromContentImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMocks.queryRaw.mockResolvedValue([
      { get_next_sequential_id: "SAM-0001" },
    ] as any);
    dbMocks.assetCreate.mockResolvedValue({ id: "asset-1" });

    moduleMocks.getQr.mockResolvedValue(null);
    moduleMocks.parseQrCodesFromImportData.mockResolvedValue([]);
    moduleMocks.parseBarcodesFromImportData.mockResolvedValue([]);
    moduleMocks.createKitsIfNotExists.mockResolvedValue({});
    moduleMocks.createCategoriesIfNotExists.mockResolvedValue({});
    moduleMocks.createLocationsIfNotExists.mockResolvedValue({});
    moduleMocks.createTeamMemberIfNotExists.mockResolvedValue({});
    moduleMocks.createTagsIfNotExists.mockResolvedValue({});
    moduleMocks.createCustomFieldsIfNotExists.mockResolvedValue({
      customFields: {
        Budget: amountCustomField,
        Quantity: numberCustomField,
      },
      newOrUpdatedFields: [],
    });
  });

  it("sanitizes numeric custom field values before asset creation", async () => {
    const data = buildImportData("$600.00 ");

    await createAssetsFromContentImport({
      data,
      userId,
      organizationId,
    });

    expect(dbMocks.assetCreate).toHaveBeenCalledTimes(1);
    const createArgs = dbMocks.assetCreate.mock.calls[0][0];
    expect(createArgs.data.customFields.create).toEqual([
      {
        value: { raw: 600, valueText: "600.00" },
        customFieldId: amountCustomField.id,
      },
    ]);
  });

  it("throws a descriptive error when numeric custom field values are invalid", async () => {
    const data = buildImportData("invalid");

    const promise = createAssetsFromContentImport({
      data,
      userId,
      organizationId,
    });

    await expect(promise).rejects.toThrowError(ShelfError);
    await expect(promise).rejects.toThrowError(
      "Custom field 'Budget' has invalid numeric value 'invalid' on asset 'Camera'. Please use plain numbers without currency symbols or letters (e.g., 600.00)."
    );

    expect(dbMocks.assetCreate).not.toHaveBeenCalled();
  });

  it("provides guidance when database constraint rejects numeric custom field values", async () => {
    const constraintError = new Error(
      'new row for relation "AssetCustomFieldValue" violates check constraint "ensure_value_structure_and_types"'
    );
    dbMocks.assetCreate.mockRejectedValueOnce(constraintError);

    const data = buildImportData("600");

    const promise = createAssetsFromContentImport({
      data,
      userId,
      organizationId,
    });

    await expect(promise).rejects.toThrowError(
      "We were unable to save numeric custom field values. Please ensure AMOUNT and NUMBER fields use plain numbers without currency symbols or letters (e.g., 600.00)."
    );
  });
});
