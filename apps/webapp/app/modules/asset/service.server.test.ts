import { describe, expect, it, vitest, beforeEach } from "vitest";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { getCategory } from "~/modules/category/service.server";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  parseAssetValuation,
  refreshExpiredAssetImages,
  relinkAssetQrCode,
  updateAsset,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
    },
    location: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
  },
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
    expect(() => parseAssetValuation("abc")).toThrow(ShelfError);
    try {
      parseAssetValuation("abc");
    } catch (e) {
      expect((e as any).status).toBe(400);
      expect((e as any).message).toBe("Value must be a valid number");
    }
  });

  it("throws ShelfError 400 for NaN-producing input", () => {
    expect(() => parseAssetValuation("not a number")).toThrow(ShelfError);
  });

  it("throws ShelfError 400 for Infinity", () => {
    expect(() => parseAssetValuation("Infinity")).toThrow(ShelfError);
  });
});
