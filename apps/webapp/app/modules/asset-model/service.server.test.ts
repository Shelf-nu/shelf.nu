import { describe, expect, it, vitest, beforeEach } from "vitest";
import { createAssetModel as createAssetModelFactory } from "@factories";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  clearInheritedAssetModelImages,
  createAssetModel,
  createAssetModelsIfNotExists,
  getAssetModels,
  getAssetModel,
  getInheritableAssetModelImage,
  isAssetModelImageUrl,
  propagateAssetModelImageToAssets,
  updateAssetModel,
  deleteAssetModel,
  bulkDeleteAssetModels,
} from "./service.server";

// why: isolating service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    assetModel: {
      create: vitest.fn(),
      findFirst: vitest.fn(),
      findMany: vitest.fn(),
      findFirstOrThrow: vitest.fn(),
      update: vitest.fn(),
      deleteMany: vitest.fn(),
      count: vitest.fn(),
    },
    asset: {
      findMany: vitest.fn(),
      updateMany: vitest.fn(),
    },
  },
}));

// why: Supabase storage is a network boundary — stub the signing call so the
// thumbnail derivation can be asserted without hitting it. getThumbnailStoragePath
// is pure, so it keeps its real implementation.
vitest.mock("~/utils/storage.server", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/utils/storage.server"
  );
  return {
    ...actual,
    createSignedUrl: vitest.fn(
      ({ filename }: { filename: string }) =>
        `https://xyz.supabase.co/storage/v1/object/sign/assets/${filename}?token=signed`
    ),
    parseFileFormData: vitest.fn(),
  };
});

describe("createAssetModel", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("creates an asset model with required fields", async () => {
    const mockModel = createAssetModelFactory();
    // @ts-expect-error mock setup
    db.assetModel.create.mockResolvedValue(mockModel);

    const result = await createAssetModel({
      name: "Dell Latitude 5550",
      userId: "user-123",
      organizationId: "org-123",
    });

    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Dell Latitude 5550",
        createdBy: { connect: { id: "user-123" } },
        organization: { connect: { id: "org-123" } },
      }),
    });
    expect(result).toEqual(mockModel);
  });

  it("trims whitespace from the name", async () => {
    const mockModel = createAssetModelFactory({ name: "Trimmed Name" });
    // @ts-expect-error mock setup
    db.assetModel.create.mockResolvedValue(mockModel);

    await createAssetModel({
      name: "  Trimmed Name  ",
      userId: "user-123",
      organizationId: "org-123",
    });

    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Trimmed Name",
      }),
    });
  });

  it("connects a default category when provided", async () => {
    const mockModel = createAssetModelFactory({
      defaultCategoryId: "cat-123",
    });
    // @ts-expect-error mock setup
    db.assetModel.create.mockResolvedValue(mockModel);

    await createAssetModel({
      name: "Test Model",
      userId: "user-123",
      organizationId: "org-123",
      defaultCategoryId: "cat-123",
    });

    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        defaultCategory: { connect: { id: "cat-123" } },
      }),
    });
  });

  it("sets default valuation when provided", async () => {
    const mockModel = createAssetModelFactory({ defaultValuation: 999.99 });
    // @ts-expect-error mock setup
    db.assetModel.create.mockResolvedValue(mockModel);

    await createAssetModel({
      name: "Test Model",
      userId: "user-123",
      organizationId: "org-123",
      defaultValuation: 999.99,
    });

    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        defaultValuation: 999.99,
      }),
    });
  });

  it("throws ShelfError on unique constraint violation", async () => {
    const prismaError = new Error("Unique constraint failed");
    Object.assign(prismaError, { code: "P2002" });
    // @ts-expect-error mock setup
    db.assetModel.create.mockRejectedValue(prismaError);

    await expect(
      createAssetModel({
        name: "Duplicate Model",
        userId: "user-123",
        organizationId: "org-123",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("getAssetModels", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns paginated asset models with asset counts", async () => {
    const mockModels = [
      createAssetModelFactory({ id: "model-1", name: "Model A" }),
      createAssetModelFactory({ id: "model-2", name: "Model B" }),
    ];
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue(mockModels);
    // @ts-expect-error mock setup
    db.assetModel.count.mockResolvedValue(2);

    const result = await getAssetModels({
      organizationId: "org-123",
      page: 1,
      perPage: 10,
    });

    expect(result.assetModels).toEqual(mockModels);
    expect(result.totalAssetModels).toBe(2);
    expect(db.assetModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 10,
        where: { organizationId: "org-123" },
        orderBy: { updatedAt: "desc" },
        include: expect.objectContaining({
          _count: { select: { assets: true } },
        }),
      })
    );
  });

  it("applies search filter on name and description (case-insensitive)", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue([]);
    // @ts-expect-error mock setup
    db.assetModel.count.mockResolvedValue(0);

    await getAssetModels({
      organizationId: "org-123",
      search: "latitude",
    });

    expect(db.assetModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-123",
          OR: [
            { name: { contains: "latitude", mode: "insensitive" } },
            { description: { contains: "latitude", mode: "insensitive" } },
          ],
        },
      })
    );
  });

  it("calculates correct skip for page > 1", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue([]);
    // @ts-expect-error mock setup
    db.assetModel.count.mockResolvedValue(0);

    await getAssetModels({
      organizationId: "org-123",
      page: 3,
      perPage: 10,
    });

    expect(db.assetModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20,
        take: 10,
      })
    );
  });
});

describe("getAssetModel", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns a single asset model by id and organization", async () => {
    const mockModel = createAssetModelFactory();
    // @ts-expect-error mock setup
    db.assetModel.findFirstOrThrow.mockResolvedValue(mockModel);

    const result = await getAssetModel({
      id: "asset-model-123",
      organizationId: "org-123",
    });

    expect(result).toEqual(mockModel);
    expect(db.assetModel.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: "asset-model-123", organizationId: "org-123" },
      include: expect.objectContaining({
        defaultCategory: expect.any(Object),
      }),
    });
  });

  it("throws ShelfError when asset model is not found", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirstOrThrow.mockRejectedValue(
      new Error("Record not found")
    );

    await expect(
      getAssetModel({ id: "nonexistent", organizationId: "org-123" })
    ).rejects.toThrow(ShelfError);
  });
});

describe("updateAssetModel", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("updates name and description", async () => {
    const mockModel = createAssetModelFactory({ name: "Updated Name" });
    // @ts-expect-error mock setup
    db.assetModel.update.mockResolvedValue(mockModel);

    await updateAssetModel({
      id: "asset-model-123",
      organizationId: "org-123",
      name: "  Updated Name  ",
      description: "New description",
    });

    expect(db.assetModel.update).toHaveBeenCalledWith({
      where: { id: "asset-model-123", organizationId: "org-123" },
      data: expect.objectContaining({
        name: "Updated Name",
        description: "New description",
      }),
    });
  });

  it("disconnects default category when set to null", async () => {
    const mockModel = createAssetModelFactory({ defaultCategoryId: null });
    // @ts-expect-error mock setup
    db.assetModel.update.mockResolvedValue(mockModel);

    await updateAssetModel({
      id: "asset-model-123",
      organizationId: "org-123",
      defaultCategoryId: null,
    });

    expect(db.assetModel.update).toHaveBeenCalledWith({
      where: { id: "asset-model-123", organizationId: "org-123" },
      data: expect.objectContaining({
        defaultCategory: { disconnect: true },
      }),
    });
  });

  it("connects a new default category", async () => {
    const mockModel = createAssetModelFactory({
      defaultCategoryId: "cat-456",
    });
    // @ts-expect-error mock setup
    db.assetModel.update.mockResolvedValue(mockModel);

    await updateAssetModel({
      id: "asset-model-123",
      organizationId: "org-123",
      defaultCategoryId: "cat-456",
    });

    expect(db.assetModel.update).toHaveBeenCalledWith({
      where: { id: "asset-model-123", organizationId: "org-123" },
      data: expect.objectContaining({
        defaultCategory: { connect: { id: "cat-456" } },
      }),
    });
  });
});

describe("deleteAssetModel", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // @ts-expect-error mock setup — no inheriting assets unless a test says so
    db.asset.findMany.mockResolvedValue([]);
  });

  it("deletes an asset model scoped to organization", async () => {
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockResolvedValue({ count: 1 });

    await deleteAssetModel({
      id: "asset-model-123",
      organizationId: "org-123",
    });

    expect(db.assetModel.deleteMany).toHaveBeenCalledWith({
      where: { id: "asset-model-123", organizationId: "org-123" },
    });
  });

  it("throws ShelfError when deletion fails", async () => {
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockRejectedValue(new Error("DB error"));

    await expect(
      deleteAssetModel({
        id: "asset-model-123",
        organizationId: "org-123",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("createAssetModelsIfNotExists", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("reuses an existing model when name matches case-insensitively", async () => {
    // why: spreadsheets are noisy — "Dell Latitude 5550" and
    // "dell latitude 5550" must collapse to the same model row.
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue({ id: "model-existing" });

    const result = await createAssetModelsIfNotExists({
      data: [
        { key: "r1", title: "Asset 1", assetModel: "dell latitude 5550" },
      ] as any,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.assetModel.findFirst).toHaveBeenCalledWith({
      where: {
        name: { equals: "dell latitude 5550", mode: "insensitive" },
        organizationId: "org-1",
      },
    });
    expect(db.assetModel.create).not.toHaveBeenCalled();
    expect(result).toEqual({ "dell latitude 5550": "model-existing" });
  });

  it("creates a new model when none matches and trims whitespace before write", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue(null);
    // @ts-expect-error mock setup
    db.assetModel.create.mockResolvedValue({ id: "model-new" });

    const result = await createAssetModelsIfNotExists({
      data: [{ key: "r1", title: "Asset 1", assetModel: "  Brand X  " }] as any,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: {
        name: "Brand X",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
      },
    });
    expect(result).toEqual({ "  Brand X  ": "model-new" });
  });

  it("skips rows without an assetModel column", async () => {
    const result = await createAssetModelsIfNotExists({
      data: [
        { key: "r1", title: "Asset 1" }, // no assetModel
      ] as any,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.assetModel.findFirst).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it("deduplicates repeated model names across rows", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue({ id: "model-shared" });

    await createAssetModelsIfNotExists({
      data: [
        { key: "r1", title: "Asset 1", assetModel: "Brand X" },
        { key: "r2", title: "Asset 2", assetModel: "Brand X" },
        { key: "r3", title: "Asset 3", assetModel: "Brand X" },
      ] as any,
      userId: "user-1",
      organizationId: "org-1",
    });

    // Map dedupes by exact-key — only one lookup per unique name.
    expect(db.assetModel.findFirst).toHaveBeenCalledTimes(1);
  });

  it("wraps unexpected errors in ShelfError", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockRejectedValue(new Error("boom"));

    await expect(
      createAssetModelsIfNotExists({
        data: [{ key: "r1", title: "Asset 1", assetModel: "Brand X" }] as any,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("bulkDeleteAssetModels", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // @ts-expect-error mock setup — no inheriting assets unless a test says so
    db.asset.findMany.mockResolvedValue([]);
  });

  it("deletes specific asset models by IDs", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue([
      { id: "model-1" },
      { id: "model-2" },
    ]);
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockResolvedValue({ count: 2 });

    await bulkDeleteAssetModels({
      assetModelIds: ["model-1", "model-2"],
      organizationId: "org-123",
    });

    expect(db.assetModel.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["model-1", "model-2"] },
        organizationId: "org-123",
      },
      select: { id: true },
    });
    expect(db.assetModel.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["model-1", "model-2"] },
        organizationId: "org-123",
      },
    });
  });

  it("deletes all asset models when ALL_SELECTED key is present", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue([
      { id: "model-1" },
      { id: "model-2" },
      { id: "model-3" },
    ]);
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockResolvedValue({ count: 3 });

    await bulkDeleteAssetModels({
      assetModelIds: ["all-selected"],
      organizationId: "org-123",
    });

    // The id set is resolved from the org-wide filter first, so the
    // inherited-image cleanup and the delete cover exactly the same models.
    expect(db.assetModel.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-123" },
      select: { id: true },
    });
    expect(db.assetModel.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["model-1", "model-2", "model-3"] },
        organizationId: "org-123",
      },
    });
  });

  it("clears inherited images from the deleted models' assets before deleting", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findMany.mockResolvedValue([{ id: "model-1" }]);
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-inheriting",
        mainImage: MODEL_IMAGE_URL,
        assetModelId: "model-1",
      },
      {
        id: "asset-own-image",
        mainImage: OWN_ASSET_IMAGE_URL,
        assetModelId: "model-1",
      },
    ]);
    // @ts-expect-error mock setup
    db.asset.updateMany.mockResolvedValue({ count: 1 });
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockResolvedValue({ count: 1 });

    await bulkDeleteAssetModels({
      assetModelIds: ["model-1"],
      organizationId: "org-123",
    });

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-inheriting"] }, organizationId: "org-123" },
      data: {
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
      },
    });
    // why: after the delete, ON DELETE SET NULL has erased the link that
    // identifies inheriting assets — the cleanup must run first.
    expect(
      vitest.mocked(db.asset.updateMany).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vitest.mocked(db.assetModel.deleteMany).mock.invocationCallOrder[0]
    );
  });
});

describe("clearInheritedAssetModelImages", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("clears only the assets that were showing their model's image", async () => {
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-inheriting",
        mainImage: MODEL_IMAGE_URL,
        assetModelId: "model-1",
      },
      {
        id: "asset-own-image",
        mainImage: OWN_ASSET_IMAGE_URL,
        assetModelId: "model-1",
      },
      { id: "asset-no-image", mainImage: null, assetModelId: "model-1" },
    ]);
    // @ts-expect-error mock setup
    db.asset.updateMany.mockResolvedValue({ count: 1 });

    const count = await clearInheritedAssetModelImages({
      assetModelIds: ["model-1"],
      organizationId: "org-123",
    });

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-inheriting"] }, organizationId: "org-123" },
      data: {
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
      },
    });
    expect(count).toBe(1);
  });

  it("writes nothing when no asset was inheriting", async () => {
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-own-image",
        mainImage: OWN_ASSET_IMAGE_URL,
        assetModelId: "model-1",
      },
    ]);

    const count = await clearInheritedAssetModelImages({
      assetModelIds: ["model-1"],
      organizationId: "org-123",
    });

    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("short-circuits on an empty model list", async () => {
    const count = await clearInheritedAssetModelImages({
      assetModelIds: [],
      organizationId: "org-123",
    });

    expect(db.asset.findMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});

/* ====================================================================== */
/*  Cover image                                                            */
/* ====================================================================== */

/** A signed URL for an image stored under model `model-1`'s folder. */
const MODEL_IMAGE_URL =
  "https://xyz.supabase.co/storage/v1/object/sign/assets/user-123/asset-models/model-1/image-1700000000000.png?token=abc";
/** A re-signed URL for the SAME object (different token — refresh happened). */
const MODEL_IMAGE_URL_RESIGNED =
  "https://xyz.supabase.co/storage/v1/object/sign/assets/user-123/asset-models/model-1/image-1700000000000.png?token=zzz";
/** The shared 108px thumbnail sitting next to that model image. */
const MODEL_THUMBNAIL_URL =
  "https://xyz.supabase.co/storage/v1/object/sign/assets/user-123/asset-models/model-1/image-1700000000000-thumbnail.png?token=abc";
/** An image the user uploaded for one specific asset. */
const OWN_ASSET_IMAGE_URL =
  "https://xyz.supabase.co/storage/v1/object/sign/assets/user-123/asset-abc/main-image-1700000000000?token=abc";

describe("isAssetModelImageUrl", () => {
  it("recognises an asset-model image by its storage path", () => {
    expect(isAssetModelImageUrl(MODEL_IMAGE_URL)).toBe(true);
    expect(isAssetModelImageUrl(MODEL_IMAGE_URL, "model-1")).toBe(true);
  });

  it("still recognises the image after the signed URL was re-signed", () => {
    // why: refreshExpiredAssetImages rewrites the token on the asset row, so an
    // exact-URL comparison would lose track of the inheritance. The path is
    // the stable part.
    expect(isAssetModelImageUrl(MODEL_IMAGE_URL_RESIGNED, "model-1")).toBe(
      true
    );
  });

  it("does not claim another model's image", () => {
    expect(isAssetModelImageUrl(MODEL_IMAGE_URL, "model-2")).toBe(false);
  });

  it("does not claim an image the user uploaded for the asset itself", () => {
    expect(isAssetModelImageUrl(OWN_ASSET_IMAGE_URL)).toBe(false);
    expect(isAssetModelImageUrl(OWN_ASSET_IMAGE_URL, "model-1")).toBe(false);
  });

  it("treats a missing image as not inherited", () => {
    expect(isAssetModelImageUrl(null)).toBe(false);
    expect(isAssetModelImageUrl(undefined)).toBe(false);
    expect(isAssetModelImageUrl("")).toBe(false);
  });
});

describe("getInheritableAssetModelImage", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns the model's image plus its derived shared thumbnail", async () => {
    const imageExpiration = new Date("2026-08-01T00:00:00.000Z");
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue({
      image: MODEL_IMAGE_URL,
      imageExpiration,
    });

    const result = await getInheritableAssetModelImage({
      assetModelId: "model-1",
      organizationId: "org-123",
    });

    expect(db.assetModel.findFirst).toHaveBeenCalledWith({
      where: { id: "model-1", organizationId: "org-123" },
      select: { image: true, imageExpiration: true },
    });
    expect(result).toEqual({
      image: MODEL_IMAGE_URL,
      imageExpiration,
      // Derived from the image path by the same rule the upload wrote it with,
      // so a fresh asset renders at list size without a generate-thumbnail hop.
      thumbnailImage:
        "https://xyz.supabase.co/storage/v1/object/sign/assets/user-123/asset-models/model-1/image-1700000000000-thumbnail.png?token=signed",
    });
  });

  it("returns null when the model has no image", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue({
      image: null,
      imageExpiration: null,
    });

    await expect(
      getInheritableAssetModelImage({
        assetModelId: "model-1",
        organizationId: "org-123",
      })
    ).resolves.toBeNull();
  });

  it("returns null for a model outside the organization", async () => {
    // @ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue(null);

    await expect(
      getInheritableAssetModelImage({
        assetModelId: "foreign-model",
        organizationId: "org-123",
      })
    ).resolves.toBeNull();
  });
});

describe("propagateAssetModelImageToAssets", () => {
  const imageExpiration = new Date("2026-08-01T00:00:00.000Z");

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("re-stamps assets with no image and assets already inheriting, but never an asset with its own image", async () => {
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-no-image", mainImage: null },
      { id: "asset-inheriting", mainImage: MODEL_IMAGE_URL_RESIGNED },
      { id: "asset-own-image", mainImage: OWN_ASSET_IMAGE_URL },
    ]);
    // @ts-expect-error mock setup
    db.asset.updateMany.mockResolvedValue({ count: 2 });

    const count = await propagateAssetModelImageToAssets({
      assetModelId: "model-1",
      organizationId: "org-123",
      image: MODEL_IMAGE_URL,
      imageExpiration,
      thumbnailImage: MODEL_THUMBNAIL_URL,
    });

    expect(db.asset.findMany).toHaveBeenCalledWith({
      where: { assetModelId: "model-1", organizationId: "org-123" },
      select: { id: true, mainImage: true },
    });
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-no-image", "asset-inheriting"] },
        organizationId: "org-123",
      },
      data: {
        mainImage: MODEL_IMAGE_URL,
        mainImageExpiration: imageExpiration,
        // why: the shared thumbnail is stamped too, so N inheriting assets
        // don't each fire /api/asset/generate-thumbnail to build the one
        // object that already exists.
        thumbnailImage: MODEL_THUMBNAIL_URL,
      },
    });
    expect(count).toBe(2);
  });

  it("writes nothing when every asset has its own image", async () => {
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-own-image", mainImage: OWN_ASSET_IMAGE_URL },
    ]);

    const count = await propagateAssetModelImageToAssets({
      assetModelId: "model-1",
      organizationId: "org-123",
      image: MODEL_IMAGE_URL,
      imageExpiration,
      thumbnailImage: MODEL_THUMBNAIL_URL,
    });

    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it("writes nothing when the model has no assets", async () => {
    // @ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([]);

    const count = await propagateAssetModelImageToAssets({
      assetModelId: "model-1",
      organizationId: "org-123",
      image: MODEL_IMAGE_URL,
      imageExpiration,
      thumbnailImage: MODEL_THUMBNAIL_URL,
    });

    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});
