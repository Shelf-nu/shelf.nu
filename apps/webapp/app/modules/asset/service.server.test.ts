import { OrganizationRoles, type AssetIndexSettings } from "@prisma/client";
import { describe, expect, it, vi, vitest, beforeEach } from "vitest";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { recordEvents } from "~/modules/activity-event/service.server";
import { getCategory } from "~/modules/category/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  bulkAssignAssetTags,
  bulkAssignCustody,
  bulkDeleteAssets,
  bulkReleaseCustody,
  bulkUpdateAssetCategory,
  createAsset,
  getActiveCustomFieldsForAsset,
  parseAssetValuation,
  refreshExpiredAssetImages,
  relinkAssetQrCode,
  updateAsset,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest
      .fn()
      .mockImplementation((callback: (tx: unknown) => unknown) => callback(db)),
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findUnique: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      update: vitest.fn().mockResolvedValue({}),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    category: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    location: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    tag: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
    teamMember: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    assetCustomFieldValue: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    customField: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    user: {
      findFirst: vitest
        .fn()
        .mockResolvedValue({ firstName: "John", lastName: "Doe" }),
    },
  },
}));

// why: avoid emitting real activity events during asset service tests; assert
// the mock was called with the expected payload instead.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: avoid resolving real asset IDs from search params; just echo the ids
// the caller passed in so the test focuses on event emission.
vitest.mock("./bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vitest
    .fn()
    .mockImplementation(({ assetIds }: { assetIds: string[] }) =>
      Promise.resolve(assetIds)
    ),
}));

// why: control category lookup so we can simulate a cross-org category id
// being rejected by the org-scoped guard inside updateAsset.
vitest.mock("~/modules/category/service.server", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/modules/category/service.server"
  );
  return {
    ...actual,
    getCategory: vitest.fn(),
  };
});

// why: avoid real QR lookup during relink tests
vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

// why: avoid hitting Supabase storage during uploadDuplicateAssetMainImage tests
vitest.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vitest.fn(),
}));

// why: control storage path extraction for refreshExpiredAssetImages tests
vitest.mock("~/components/assets/asset-image/utils", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/components/assets/asset-image/utils"
  );
  return {
    ...actual,
    extractStoragePath: vitest
      .fn()
      .mockImplementation(
        actual.extractStoragePath as (...args: unknown[]) => unknown
      ),
  };
});

// why: avoid generating signed URLs during uploadDuplicateAssetMainImage tests
vitest.mock("~/utils/storage.server", async () => {
  const actual = await vitest.importActual<Record<string, unknown>>(
    "~/utils/storage.server"
  );
  return {
    ...actual,
    createSignedUrl: vitest.fn(),
  };
});

// why: avoid user lookup side effects during relink tests
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "John",
    lastName: "Doe",
  }),
}));

// why: avoid creating actual notes during relink tests
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
  createAssetCategoryChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetDescriptionChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetNameChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetValuationChangeNote: vitest.fn().mockResolvedValue({}),
  createTagChangeNoteIfNeeded: vitest.fn().mockResolvedValue(undefined),
}));

// why: control custom-field lookup so we can assert org+category scoping
vitest.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vitest.fn(),
}));

// why: createAsset generates a sequential id via a DB-backed counter; stub it
// so the create-path test reaches the org-scope guard without DB plumbing.
vitest.mock("./sequential-id.server", () => ({
  getNextSequentialId: vitest.fn().mockResolvedValue("TST-0001"),
}));

describe("relinkAssetQrCode (asset)", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("throws when QR is already linked to a kit", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: "kit-1",
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [] });

    await expect(
      relinkAssetQrCode({
        qrId: "qr-1",
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("relinks when QR is available", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [{ id: "old-qr" }] });

    await relinkAssetQrCode({
      qrId: "qr-1",
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.qr.update).toHaveBeenCalledWith({
      where: { id: "qr-1" },
      data: { organizationId: "org-1", userId: "user-1" },
    });
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-1" },
      data: {
        qrCodes: {
          set: [],
          connect: { id: "qr-1" },
        },
      },
    });
  });
});

describe("uploadDuplicateAssetMainImage", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("uploads a valid image buffer and returns a signed URL", async () => {
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const arrayBuffer = pngHeader.buffer.slice(
      pngHeader.byteOffset,
      pngHeader.byteOffset + pngHeader.byteLength
    );

    const download = vitest.fn().mockResolvedValue({
      data: {
        arrayBuffer: () => arrayBuffer,
      },
      error: null,
    });
    const upload = vitest.fn().mockResolvedValue({
      data: { path: "user-1/asset-1/main-image-123" },
      error: null,
    });
    const list = vitest.fn().mockResolvedValue({
      data: [{ name: "main-image-123" }, { name: "main-image-122" }],
      error: null,
    });
    const remove = vitest.fn().mockResolvedValue({ data: null, error: null });

    // @ts-expect-error mock setup
    getSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          download,
          upload,
          list,
          remove,
        }),
      },
    });
    // @ts-expect-error mock setup
    createSignedUrl.mockResolvedValue("signed-url");

    const result = await uploadDuplicateAssetMainImage(
      "https://example.supabase.co/storage/v1/object/sign/assets/user-1/asset-1/main-image-123?token=abc",
      "asset-1",
      "user-1"
    );

    expect(result).toBe("signed-url");
    expect(download).toHaveBeenCalledWith("user-1/asset-1/main-image-123");
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining("user-1/asset-1/main-image-"),
      expect.any(Buffer),
      { contentType: "image/png", upsert: true }
    );
    expect(createSignedUrl).toHaveBeenCalledWith({
      filename: "user-1/asset-1/main-image-123",
    });
    expect(list).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("rejects when the downloaded buffer is not a supported image", async () => {
    const jsonPayload = Buffer.from(
      JSON.stringify({
        statusCode: "400",
        error: "InvalidJWT",
        message: '"exp" claim timestamp check failed',
      })
    );
    const arrayBuffer = jsonPayload.buffer.slice(
      jsonPayload.byteOffset,
      jsonPayload.byteOffset + jsonPayload.byteLength
    );

    const download = vitest.fn().mockResolvedValue({
      data: {
        arrayBuffer: () => arrayBuffer,
      },
      error: null,
    });
    const upload = vitest.fn();

    // @ts-expect-error mock setup
    getSupabaseAdmin.mockReturnValue({
      storage: {
        from: () => ({
          download,
          upload,
          list: vitest.fn(),
          remove: vitest.fn(),
        }),
      },
    });

    await expect(
      uploadDuplicateAssetMainImage(
        "https://example.supabase.co/storage/v1/object/sign/assets/user-1/asset-1/main-image-123?token=abc",
        "asset-1",
        "user-1"
      )
    ).rejects.toBeInstanceOf(ShelfError);

    expect(upload).not.toHaveBeenCalled();
  });
});

describe("refreshExpiredAssetImages", () => {
  const mockUpdate = db.asset.update as ReturnType<typeof vitest.fn>;
  const mockCreateSignedUrl = createSignedUrl as ReturnType<typeof vitest.fn>;
  const mockExtractStoragePath = extractStoragePath as ReturnType<
    typeof vitest.fn
  >;

  beforeEach(() => {
    vitest.clearAllMocks();
    mockExtractStoragePath.mockReturnValue("org/asset/image.jpg");
    mockCreateSignedUrl.mockResolvedValue("https://new-signed-url.com");
    mockUpdate.mockResolvedValue({});
  });

  const makeAsset = (
    overrides: Partial<{
      id: string;
      organizationId: string;
      mainImage: string | null;
      mainImageExpiration: Date | null;
      thumbnailImage: string | null;
    }> = {}
  ) => ({
    id: "asset-1",
    organizationId: "org-1",
    mainImage: "https://old-signed-url.com",
    mainImageExpiration: new Date(Date.now() - 60_000), // expired
    thumbnailImage: null as string | null,
    ...overrides,
  });

  it("returns assets unchanged when none are expired", async () => {
    const assets = [
      makeAsset({
        mainImageExpiration: new Date(Date.now() + 60_000), // future
      }),
    ];

    const result = await refreshExpiredAssetImages(assets);

    expect(result).toEqual(assets);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refreshes mainImage and thumbnailImage when expired", async () => {
    const assets = [
      makeAsset({
        thumbnailImage: "https://old-thumbnail-url.com",
      }),
    ];

    mockCreateSignedUrl
      .mockResolvedValueOnce("https://new-main-url.com")
      .mockResolvedValueOnce("https://new-thumbnail-url.com");

    const result = await refreshExpiredAssetImages(assets);

    expect(result[0].mainImage).toBe("https://new-main-url.com");
    expect(result[0].thumbnailImage).toBe("https://new-thumbnail-url.com");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1", organizationId: "org-1" },
        data: expect.objectContaining({
          mainImage: "https://new-main-url.com",
          thumbnailImage: "https://new-thumbnail-url.com",
        }),
      })
    );
  });

  it("applies backoff when extractStoragePath returns null", async () => {
    mockExtractStoragePath.mockReturnValue(null);
    const assets = [makeAsset()];

    const result = await refreshExpiredAssetImages(assets);

    // Should return original asset (no refresh)
    expect(result[0].mainImage).toBe("https://old-signed-url.com");
    // Should bump expiration to prevent retry storm
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1", organizationId: "org-1" },
        data: expect.objectContaining({
          mainImageExpiration: expect.any(Date),
        }),
      })
    );
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("logs error and applies backoff when createSignedUrl fails", async () => {
    mockCreateSignedUrl.mockRejectedValue(
      new ShelfError({
        cause: new Error("rate limited"),
        message: "Failed to create signed URL",
        label: "Assets",
      })
    );
    const assets = [makeAsset()];

    // Should not throw (allSettled catches it)
    const result = await refreshExpiredAssetImages(assets);

    // Asset should be returned unchanged
    expect(result[0].mainImage).toBe("https://old-signed-url.com");
    // Backoff update should have been called
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mainImageExpiration: expect.any(Date),
        }),
      })
    );
  });

  it("handles deleted asset (P2025) gracefully without logging error", async () => {
    const { Prisma: ActualPrisma } = await import("@prisma/client");
    mockUpdate.mockRejectedValue(
      new ActualPrisma.PrismaClientKnownRequestError(
        "Record to update not found",
        { code: "P2025", clientVersion: "5.0.0" }
      )
    );
    const assets = [makeAsset()];

    const result = await refreshExpiredAssetImages(assets);

    // Should return original asset (refresh failed gracefully)
    expect(result[0].mainImage).toBe("https://old-signed-url.com");
  });
});

describe("updateAsset cross-org guards", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Asset itself is in-org so kit-block lookup and assetBeforeUpdate succeed.
    (db.asset.findUnique as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce({ kit: null }) // kit-block check
      .mockResolvedValueOnce({
        id: "asset-1",
        title: "Asset 1",
        description: null,
        valuation: null,
        category: null,
        tags: [],
      });
  });

  it("rejects categoryId from a different organization", async () => {
    (getCategory as ReturnType<typeof vitest.fn>).mockRejectedValue(
      new ShelfError({
        cause: null,
        title: "Category not found",
        message:
          "The category you are trying to access does not exist or you do not have permission to access it.",
        label: "Category",
        status: 404,
      })
    );

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-A",
        categoryId: "category-from-org-B",
      } as any)
    ).rejects.toThrow();

    expect(getCategory).toHaveBeenCalledWith({
      id: "category-from-org-B",
      organizationId: "org-A",
    });
  });

  it("rejects newLocationId from a different organization", async () => {
    // location.findFirst returns null when scoped by org → guard throws
    (db.location.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      null
    );

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-A",
        newLocationId: "location-from-org-B",
        currentLocationId: "current-loc-A",
      } as any)
    ).rejects.toThrow();

    expect(db.location.findFirst).toHaveBeenCalledWith({
      where: { id: "location-from-org-B", organizationId: "org-A" },
      select: { id: true },
    });
  });

  it("rejects a customFieldId from a different organization", async () => {
    expect.assertions(2);
    // No existing values for this asset; the form references a foreign-org
    // custom field whose org-scoped lookup returns nothing → guard throws.
    (
      db.assetCustomFieldValue.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    (db.customField.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(
      []
    );

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-A",
        customFieldsValues: [{ id: "cf-from-org-B", value: { raw: "x" } }],
      } as any)
    ).rejects.toThrow(ShelfError);

    expect(db.customField.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["cf-from-org-B"] }, organizationId: "org-A" },
      select: { id: true },
    });
  });
});

describe("createAsset cross-org guards", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("rejects a customFieldId from a different organization", async () => {
    expect.assertions(2);
    // Foreign-org custom field → org-scoped lookup returns nothing → the guard
    // (run inside the create transaction) rejects before the asset is written.
    (db.customField.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(
      []
    );

    await expect(
      createAsset({
        title: "New asset",
        userId: "user-1",
        organizationId: "org-A",
        customFieldsValues: [{ id: "cf-from-org-B", value: { raw: "x" } }],
      } as any)
    ).rejects.toThrow(ShelfError);

    expect(db.customField.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["cf-from-org-B"] }, organizationId: "org-A" },
      select: { id: true },
    });
  });
});

describe("updateAsset custom-field writes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      title: "Asset 1",
      category: null,
      valuation: null,
    });
  });

  // Regression for Sentry SHELF-WEBAPP-1KY / SHELF-WEBAPP-1MF: persisting custom
  // field values must not use a nested `upsert`, which makes Prisma issue a
  // SELECT-then-write per field (N+1). New values become a single `create`,
  // existing ones an `updateMany` keyed by the value-row id we already loaded
  // (`updateMany` so a concurrently-deleted row matches zero rows instead of
  // throwing P2025 and aborting the whole save).
  it("creates new custom-field values and updates existing ones without a nested upsert", async () => {
    expect.assertions(4);

    // One value already exists for cf-existing; cf-new has none yet.
    (
      db.assetCustomFieldValue.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      {
        id: "val-1",
        customFieldId: "cf-existing",
        value: { raw: "old" },
        customField: { id: "cf-existing", name: "Existing", type: "TEXT" },
      },
    ]);
    (db.customField.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(
      [
        { id: "cf-existing", name: "Existing", type: "TEXT" },
        { id: "cf-new", name: "New", type: "TEXT" },
      ]
    );

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      customFieldsValues: [
        { id: "cf-existing", value: { raw: "updated" } },
        { id: "cf-new", value: { raw: "fresh" } },
      ],
    } as any);

    const updateArg = (db.asset.update as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    const { customFields } = updateArg.data;

    // No nested upsert — that was the N+1 source.
    expect(customFields.upsert).toBeUndefined();
    // New value → single create.
    expect(customFields.create).toEqual([
      { value: { raw: "fresh" }, customFieldId: "cf-new" },
    ]);
    // Existing value → updateMany (no-throw on a concurrently-deleted row),
    // keyed by the value-row id we already loaded.
    expect(customFields.updateMany).toEqual([
      { where: { id: "val-1" }, data: { value: { raw: "updated" } } },
    ]);
    // Existence info is read in a single query, not once per field.
    expect(db.assetCustomFieldValue.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("parseAssetValuation", () => {
  it("returns null for null input", () => {
    expect(parseAssetValuation(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAssetValuation("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseAssetValuation("   ")).toBeNull();
  });

  it("parses a valid integer", () => {
    expect(parseAssetValuation("42")).toBe(42);
  });

  it("parses a valid decimal", () => {
    expect(parseAssetValuation("1234.56")).toBe(1234.56);
  });

  it("parses a negative number", () => {
    expect(parseAssetValuation("-10")).toBe(-10);
  });

  it("throws ShelfError 400 for non-numeric input", () => {
    expect(() => parseAssetValuation("abc")).toThrowError(
      expect.objectContaining({
        status: 400,
        message: "Value must be a valid number",
      })
    );
  });

  it("throws ShelfError 400 for Infinity", () => {
    expect(() => parseAssetValuation("Infinity")).toThrow(ShelfError);
  });

  it("throws ShelfError 400 for -Infinity", () => {
    expect(() => parseAssetValuation("-Infinity")).toThrow(ShelfError);
  });
});

describe("getActiveCustomFieldsForAsset", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Reset the findUnique mock queue fully so that "once" values from other
    // describe blocks (e.g. updateAsset cross-org guards) don't leak in.
    vi.mocked(db.asset.findUnique).mockReset();
  });

  it("looks up the asset and forwards its categoryId to getActiveCustomFields", async () => {
    const assetFindUniqueMock = vi.mocked(db.asset.findUnique);
    assetFindUniqueMock.mockResolvedValue({
      id: "asset-1",
      categoryId: "cat-1",
    } as any);
    const getActiveCustomFieldsMock = vi.mocked(getActiveCustomFields);
    getActiveCustomFieldsMock.mockResolvedValue([
      { id: "cf-1", name: "Serial", required: false } as any,
    ]);

    const result = await getActiveCustomFieldsForAsset({
      id: "asset-1",
      organizationId: "org-1",
    });

    expect(assetFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-1" },
      select: { categoryId: true },
    });
    expect(getActiveCustomFieldsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: "cat-1",
    });
    expect(result).toEqual([{ id: "cf-1", name: "Serial", required: false }]);
  });

  it("throws a 404 ShelfError when the asset does not exist in this org", async () => {
    const assetFindUniqueMock = vi.mocked(db.asset.findUnique);
    assetFindUniqueMock.mockResolvedValue(null);
    const getActiveCustomFieldsMock = vi.mocked(getActiveCustomFields);

    await expect(
      getActiveCustomFieldsForAsset({
        id: "asset-from-other-org",
        organizationId: "org-1",
      })
    ).rejects.toThrowError(expect.objectContaining({ status: 404 }));
    expect(getActiveCustomFieldsMock).not.toHaveBeenCalled();
  });

  it("forwards null categoryId when asset is uncategorized", async () => {
    const assetFindUniqueMock = vi.mocked(db.asset.findUnique);
    assetFindUniqueMock.mockResolvedValue({
      id: "asset-1",
      categoryId: null,
    } as any);
    const getActiveCustomFieldsMock = vi.mocked(getActiveCustomFields);
    getActiveCustomFieldsMock.mockResolvedValue([]);

    await getActiveCustomFieldsForAsset({
      id: "asset-1",
      organizationId: "org-1",
    });

    expect(getActiveCustomFieldsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      category: null,
    });
  });
});

describe("bulkUpdateAssetCategory", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits ASSET_CATEGORY_CHANGED only for assets whose category actually changes", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        category: { id: "cat-old", name: "Old", color: "#000" },
      },
      // already in the target category → should be skipped
      {
        id: "asset-2",
        category: { id: "cat-new", name: "New", color: "#fff" },
      },
      // currently uncategorized → should change
      { id: "asset-3", category: null },
    ]);
    //@ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue({
      id: "cat-new",
      name: "New",
      color: "#fff",
    });

    await bulkUpdateAssetCategory({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2", "asset-3"],
      organizationId: "org-1",
      categoryId: "cat-new",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_CATEGORY_CHANGED",
          assetId: "asset-1",
          fromValue: "cat-old",
          toValue: "cat-new",
        }),
        expect.objectContaining({
          action: "ASSET_CATEGORY_CHANGED",
          assetId: "asset-3",
          fromValue: null,
          toValue: "cat-new",
        }),
      ]),
      expect.anything()
    );
    expect(
      (recordEvents as ReturnType<typeof vitest.fn>).mock.calls[0][0]
    ).toHaveLength(2);
  });

  it("does not emit events when no asset's category changes", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", category: { id: "cat-new", name: "x", color: "#000" } },
    ]);

    await bulkUpdateAssetCategory({
      userId: "user-1",
      assetIds: ["asset-1"],
      organizationId: "org-1",
      categoryId: "cat-new",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("throws when categoryId belongs to a different organization", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", category: null }]);
    // why: emulate a foreign-org category — findFirst is org-scoped, returns null
    //@ts-expect-error mock setup
    db.category.findFirst.mockResolvedValue(null);

    await expect(
      bulkUpdateAssetCategory({
        userId: "user-1",
        assetIds: ["asset-1"],
        organizationId: "org-1",
        categoryId: "foreign-cat",
        // @ts-expect-error settings not relevant for this test
        settings: {},
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("bulkAssignAssetTags", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits ASSET_TAGS_CHANGED only for assets whose tag set changed", async () => {
    expect.assertions(2);

    //@ts-expect-error mock setup
    db.tag.findMany.mockResolvedValue([{ id: "tag-new" }]);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", tags: [{ id: "tag-old", name: "Old" }] },
      { id: "asset-2", tags: [] },
    ]);

    (db.asset.update as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce({
        id: "asset-1",
        tags: [
          { id: "tag-old", name: "Old" },
          { id: "tag-new", name: "New" },
        ],
      })
      .mockResolvedValueOnce({
        id: "asset-2",
        tags: [{ id: "tag-new", name: "New" }],
      });

    await bulkAssignAssetTags({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      tagsIds: ["tag-new"],
      remove: false,
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_TAGS_CHANGED",
          assetId: "asset-1",
          field: "tags",
        }),
        expect.objectContaining({
          action: "ASSET_TAGS_CHANGED",
          assetId: "asset-2",
        }),
      ]),
      expect.anything()
    );
    expect(
      (recordEvents as ReturnType<typeof vitest.fn>).mock.calls[0][0]
    ).toHaveLength(2);
  });

  it("throws when any tagId belongs to a different organization", async () => {
    expect.assertions(1);
    // why: emulate cross-org tag — org-scoped findMany returns fewer rows
    //@ts-expect-error mock setup
    db.tag.findMany.mockResolvedValue([{ id: "tag-own" }]);

    await expect(
      bulkAssignAssetTags({
        userId: "user-1",
        assetIds: ["asset-1"],
        organizationId: "org-1",
        tagsIds: ["tag-own", "tag-foreign"],
        remove: false,
        // @ts-expect-error settings not relevant for this test
        settings: {},
      })
    ).rejects.toThrow(ShelfError);
  });

  // Regression: the per-asset `update` loop runs inside the interactive tx, so
  // large selections must not abort with P2028 (Sentry SHELF-WEBAPP-1MH).
  it("raises the interactive transaction timeout to 15s", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.tag.findMany.mockResolvedValue([{ id: "tag-new" }]);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", tags: [] }]);
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      tags: [{ id: "tag-new", name: "New" }],
    });

    await bulkAssignAssetTags({
      userId: "user-1",
      assetIds: ["asset-1"],
      organizationId: "org-1",
      tagsIds: ["tag-new"],
      remove: false,
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15000,
    });
  });
});

describe("bulkDeleteAssets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits ASSET_DELETED per asset before deleteMany", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", mainImage: null },
      { id: "asset-2", mainImage: null },
    ]);

    await bulkDeleteAssets({
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      userId: "user-1",
      // @ts-expect-error settings not relevant
      settings: {},
    });

    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_DELETED",
          assetId: "asset-1",
          entityType: "ASSET",
          entityId: "asset-1",
        }),
        expect.objectContaining({
          action: "ASSET_DELETED",
          assetId: "asset-2",
        }),
      ]),
      expect.anything()
    );
    expect(
      (recordEvents as ReturnType<typeof vitest.fn>).mock.calls[0][0]
    ).toHaveLength(2);
  });

  it("does not emit events when no assets resolved", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([]);

    await bulkDeleteAssets({
      assetIds: [],
      organizationId: "org-1",
      userId: "user-1",
      // @ts-expect-error settings not relevant
      settings: {},
    });

    expect(recordEvents).not.toHaveBeenCalled();
  });

  // Regression: a bulk delete cascades across every asset relation, so large
  // selections must not abort with P2028 (Sentry SHELF-WEBAPP-1MJ).
  it("raises the interactive transaction timeout to 15s", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", mainImage: null }]);

    await bulkDeleteAssets({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      userId: "user-1",
      // @ts-expect-error settings not relevant
      settings: {},
    });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 15000,
    });
  });
});

describe("custody SELF_SERVICE self-restriction (bulk services)", () => {
  // Settings are unused before the guard throws (asset-id resolution is mocked).
  const fakeSettings = {} as unknown as AssetIndexSettings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks a SELF_SERVICE user from assigning custody to someone else", async () => {
    // why: the custodian resolves to a DIFFERENT user than the caller.
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      { name: "Other Person", user: { id: "other-user" } }
    );

    await expect(
      bulkAssignCustody({
        userId: "me",
        role: OrganizationRoles.SELF_SERVICE,
        assetIds: ["asset-1"],
        custodianId: "tm-other",
        custodianName: "Other Person",
        organizationId: "org-1",
        settings: fakeSettings,
      })
    ).rejects.toThrow("Self user can only assign custody to themselves only");

    // The mutation must never run.
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("blocks a SELF_SERVICE user from releasing someone else's custody", async () => {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Asset 1",
        custody: { id: "c1", custodian: { userId: "other-user" } },
      },
    ]);

    await expect(
      bulkReleaseCustody({
        userId: "me",
        role: OrganizationRoles.SELF_SERVICE,
        assetIds: ["asset-1"],
        organizationId: "org-1",
        settings: fakeSettings,
      })
    ).rejects.toThrow(
      "Self service user can only release custody of assets assigned to their user"
    );
  });
});
