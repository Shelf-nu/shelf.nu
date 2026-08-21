import { describe, expect, it, vitest, beforeEach } from "vitest";
import { createAssetModel as createAssetModelFactory } from "@factories";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { parseFileFormData } from "~/utils/storage.server";
import {
  createAssetModel,
  createAssetModelsIfNotExists,
  getAssetModels,
  getAssetModel,
  updateAssetModel,
  updateAssetModelImage,
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
      updateMany: vitest.fn(),
      deleteMany: vitest.fn(),
      count: vitest.fn(),
    },
    asset: {
      findMany: vitest.fn(),
      updateMany: vitest.fn(),
    },
    // why: `~/utils/org-validation.server` is NOT mocked here, so
    // `assertCategoryBelongsToOrg` runs for real against this stub whenever a
    // `defaultCategoryId` is supplied.
    category: {
      findFirst: vitest.fn(),
    },
  },
}));

// why: parseFileFormData streams a multipart body to Supabase storage — a
// network boundary. Stubbing it lets the URL/persist wiring be asserted without
// an upload. getFileUploadPath is pure, so it keeps its real implementation.
vitest.mock("~/utils/storage.server", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/utils/storage.server"
  );
  return {
    ...actual,
    parseFileFormData: vitest.fn(),
  };
});

// why: the Supabase admin client is a network client; only its pure public-URL
// builder is exercised here, so a stub that mirrors the real URL shape is enough.
vitest.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://xyz.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
  }),
}));

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
    // why: the org-scope guard reads the category through this stub; a hit
    // means the id belongs to the caller's workspace, so the create proceeds.
    // @ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue({ id: "cat-123" });

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

  it("rejects a default category from a different organization", async () => {
    expect.assertions(3);
    // why: a miss is how the org-scoped lookup reports a foreign-org
    // category. Prisma's foreign key would connect it regardless, so this
    // guard is the only thing between form input and another tenant's data.
    // @ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue(null);

    await expect(
      createAssetModel({
        name: "Test Model",
        userId: "user-123",
        organizationId: "org-A",
        defaultCategoryId: "cat-from-org-B",
      })
    ).rejects.toThrow(ShelfError);

    expect(db.category.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-from-org-B", organizationId: "org-A" },
      select: { id: true },
    });
    expect(db.assetModel.create).not.toHaveBeenCalled();
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
    // why: the org-scope guard reads the category through this stub; a hit
    // means the id belongs to the caller's workspace, so the update proceeds.
    // @ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue({ id: "cat-456" });

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

  it("rejects a default category from a different organization", async () => {
    expect.assertions(3);
    // why: a miss is how the org-scoped lookup reports a foreign-org category,
    // which is what the guard has to refuse before the connect.
    // @ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue(null);

    await expect(
      updateAssetModel({
        id: "asset-model-123",
        organizationId: "org-A",
        defaultCategoryId: "cat-from-org-B",
      })
    ).rejects.toThrow(ShelfError);

    expect(db.category.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-from-org-B", organizationId: "org-A" },
      select: { id: true },
    });
    expect(db.assetModel.update).not.toHaveBeenCalled();
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
  });

  it("deletes specific asset models by IDs", async () => {
    // @ts-expect-error mock setup
    db.assetModel.deleteMany.mockResolvedValue({ count: 2 });

    await bulkDeleteAssetModels({
      assetModelIds: ["model-1", "model-2"],
      organizationId: "org-123",
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
    db.assetModel.deleteMany.mockResolvedValue({ count: 3 });

    await bulkDeleteAssetModels({
      assetModelIds: ["all-selected"],
      organizationId: "org-123",
    });

    // why: the assets of a deleted model need no image cleanup — they never
    // stored a copy, so ON DELETE SET NULL alone drops them to the placeholder.
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.assetModel.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-123" },
    });
  });
});

describe("updateAssetModelImage", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("stores public urls for the image and its thumbnail, scoped to the org", async () => {
    const withImage = new FormData();
    withImage.set(
      "image",
      JSON.stringify({
        originalPath: "org-1/asset-models/model-1/abc.jpg",
        thumbnailPath: "org-1/asset-models/model-1/abc-thumbnail.jpg",
      })
    );
    vitest.mocked(parseFileFormData).mockResolvedValue(withImage);

    const result = await updateAssetModelImage({
      request: new Request("http://localhost", { method: "POST" }),
      assetModelId: "model-1",
      organizationId: "org-1",
    });

    expect(result).toContain(
      "/object/public/files/org-1/asset-models/model-1/abc.jpg"
    );
    expect(db.assetModel.update).toHaveBeenCalledWith({
      where: { id: "model-1", organizationId: "org-1" },
      data: {
        image: expect.stringContaining("abc.jpg"),
        thumbnailImage: expect.stringContaining("abc-thumbnail.jpg"),
      },
    });
  });

  // why: a plain "Save" on the model form posts an empty file input; it must not
  // clear an image the user uploaded earlier.
  it("no-ops when the form carries no file, keeping the current image", async () => {
    vitest.mocked(parseFileFormData).mockResolvedValue(new FormData());

    const result = await updateAssetModelImage({
      request: new Request("http://localhost", { method: "POST" }),
      assetModelId: "model-1",
      organizationId: "org-1",
    });

    expect(result).toBeNull();
    expect(db.assetModel.update).not.toHaveBeenCalled();
  });

  it("stores a null thumbnail when the parser returned a bare path", async () => {
    const barePath = new FormData();
    barePath.set("image", "org-1/asset-models/model-1/abc.jpg");
    vitest.mocked(parseFileFormData).mockResolvedValue(barePath);

    await updateAssetModelImage({
      request: new Request("http://localhost", { method: "POST" }),
      assetModelId: "model-1",
      organizationId: "org-1",
    });

    expect(db.assetModel.update).toHaveBeenCalledWith({
      where: { id: "model-1", organizationId: "org-1" },
      data: {
        image: expect.stringContaining("abc.jpg"),
        thumbnailImage: null,
      },
    });
  });
});
