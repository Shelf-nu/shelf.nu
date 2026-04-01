import { describe, expect, it, vitest, beforeEach } from "vitest";
import { createAssetModel as createAssetModelFactory } from "@factories";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  createAssetModel,
  getAssetModels,
  getAssetModel,
  updateAssetModel,
  deleteAssetModel,
  bulkDeleteAssetModels,
} from "./service.server";

// why: isolating service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    assetModel: {
      create: vitest.fn(),
      findMany: vitest.fn(),
      findFirstOrThrow: vitest.fn(),
      update: vitest.fn(),
      deleteMany: vitest.fn(),
      count: vitest.fn(),
    },
  },
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
    db.assetModel.deleteMany.mockResolvedValue({ count: 5 });

    await bulkDeleteAssetModels({
      assetModelIds: ["all-selected"],
      organizationId: "org-123",
    });

    expect(db.assetModel.deleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org-123" },
    });
  });
});
