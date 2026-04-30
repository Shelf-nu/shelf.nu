import { describe, expect, it, vitest, beforeEach } from "vitest";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createConsumptionLog } from "~/modules/consumption-log/service.server";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  checkOutQuantity,
  createAsset,
  refreshExpiredAssetImages,
  relinkAssetQrCode,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
      // why: checkOutQuantity returns the refreshed asset at the end of its tx
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
    // why: checkOutQuantity upserts custody rows and aggregates custody/booking totals
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      upsert: vitest.fn().mockResolvedValue({}),
    },
    // why: availability math must subtract units tied to ONGOING/OVERDUE bookings
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    // why: checkOutQuantity wraps its work in an interactive transaction — we
    // route callbacks to the same mocked db so inner tx.* calls hit our stubs
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray) =>
        typeof callbackOrArray === "function"
          ? callbackOrArray(db)
          : Promise.all(callbackOrArray)
      ),
  },
}));

// why: lockAssetForQuantityUpdate runs a raw SELECT ... FOR UPDATE that we
// cannot execute against a mocked tx — stub it to return a controlled asset
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn(),
}));

// why: avoid touching real consumption log writes during checkOutQuantity tests
vitest.mock("~/modules/consumption-log/service.server", () => ({
  createConsumptionLog: vitest.fn().mockResolvedValue({}),
}));

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

describe("createAsset quantity validation", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("throws when QUANTITY_TRACKED asset has no quantity", async () => {
    await expect(
      createAsset({
        title: "Test Cables",
        description: "USB cables",
        userId: "user-1",
        categoryId: null,
        valuation: null,
        organizationId: "org-1",
        type: "QUANTITY_TRACKED",
        consumptionType: "ONE_WAY",
        // quantity intentionally omitted
      })
    ).rejects.toThrow("Quantity is required for quantity-tracked assets");
  });

  it("throws when QUANTITY_TRACKED asset has no consumptionType", async () => {
    await expect(
      createAsset({
        title: "Test Cables",
        description: "USB cables",
        userId: "user-1",
        categoryId: null,
        valuation: null,
        organizationId: "org-1",
        type: "QUANTITY_TRACKED",
        quantity: 100,
        // consumptionType intentionally omitted
      })
    ).rejects.toThrow(
      "Consumption type is required for quantity-tracked assets"
    );
  });

  it("does not throw quantity validation for INDIVIDUAL assets", async () => {
    // This test verifies that INDIVIDUAL assets skip quantity validation.
    // The function will proceed past validation but will fail on
    // other operations (e.g., sequential ID generation) which is expected.
    // We assert the thrown error is NOT a quantity validation error.
    await expect(
      createAsset({
        title: "Test Laptop",
        description: "A laptop",
        userId: "user-1",
        categoryId: null,
        valuation: null,
        organizationId: "org-1",
        type: "INDIVIDUAL",
        // No quantity or consumptionType — should not throw validation error
      })
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("Quantity is required"),
      })
    );
  });
});

describe("checkOutQuantity — availability accounting", () => {
  // Typed handles for the mocks we set up at the top of the file. Using the
  // returned-type of vitest.fn keeps IntelliSense happy without casting on
  // every call.
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockCreateConsumptionLog = createConsumptionLog as ReturnType<
    typeof vitest.fn
  >;
  const mockCustodyAggregate = db.custody.aggregate as ReturnType<
    typeof vitest.fn
  >;
  const mockCustodyUpsert = db.custody.upsert as ReturnType<typeof vitest.fn>;
  const mockBookingAssetAggregate = db.bookingAsset.aggregate as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetFindUniqueOrThrow = db.asset.findUniqueOrThrow as ReturnType<
    typeof vitest.fn
  >;

  // A realistic asset stub returned by the row-level lock. The service only
  // reads id, organizationId, type, quantity, and title from it.
  const lockedAsset = {
    id: "asset-1",
    title: "USB-C Cables",
    organizationId: "org-1",
    type: "QUANTITY_TRACKED" as const,
    quantity: 100,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    mockLock.mockResolvedValue(lockedAsset);
    mockAssetFindUniqueOrThrow.mockResolvedValue({
      ...lockedAsset,
    });
  });

  it("rejects when booking-reserved units push requested qty over available", async () => {
    // Regression guard for the Phase 3c fix: availability must subtract
    // BOTH direct custody AND units tied to ONGOING/OVERDUE bookings.
    // Pre-fix math was `100 - 0 = 100` and this checkout would have
    // silently succeeded even though only 20 units are physically free.
    mockCustodyAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mockBookingAssetAggregate.mockResolvedValue({ _sum: { quantity: 80 } });

    let caught: unknown;
    try {
      await checkOutQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 25,
        userId: "user-1",
        organizationId: "org-1",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ShelfError);
    expect((caught as ShelfError).status).toBe(400);
    // why: "Only 20" is the single most operator-meaningful substring — it
    // encodes the post-fix math (100 - 0 - 80 = 20) and would not appear if
    // the service regressed to "Only 100 available" (custody-only math).
    expect((caught as ShelfError).message).toContain("Only 20");
    // The service must not create a custody row or log entry on rejection.
    expect(mockCustodyUpsert).not.toHaveBeenCalled();
    expect(mockCreateConsumptionLog).not.toHaveBeenCalled();
  });

  it("accepts a checkout that fits within (total − custody − booked) availability", async () => {
    mockCustodyAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mockBookingAssetAggregate.mockResolvedValue({ _sum: { quantity: 80 } });

    await checkOutQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 15,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockCustodyUpsert).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "CHECKOUT" })
    );
  });

  it("ignores RESERVED bookings when computing availability", async () => {
    // The service's bookingAsset.aggregate call filters on
    // `status: { in: ["ONGOING", "OVERDUE"] }`, so RESERVED bookings are
    // excluded at the DB layer. We mirror that by returning 0 from the
    // aggregate mock — a RESERVED-only booking contributes nothing.
    mockCustodyAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mockBookingAssetAggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    await checkOutQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 90,
      userId: "user-1",
      organizationId: "org-1",
    });

    // Assert the aggregate was invoked with the ONGOING/OVERDUE filter —
    // this is what makes RESERVED invisible to availability math.
    expect(mockBookingAssetAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: "asset-1",
          booking: { status: { in: ["ONGOING", "OVERDUE"] } },
        }),
        _sum: { quantity: true },
      })
    );
    expect(mockCustodyUpsert).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(1);
  });
});
