import { OrganizationRoles, type AssetIndexSettings } from "@prisma/client";
import { describe, expect, it, vi, vitest, beforeEach } from "vitest";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  recordEvent,
  recordEvents,
} from "~/modules/activity-event/service.server";
import { getCategory } from "~/modules/category/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createConsumptionLog } from "~/modules/consumption-log/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  BULK_CREATE_MAX,
  bulkAssignAssetTags,
  bulkCheckOutAssets,
  bulkCreateAssetsFromModel,
  bulkDeleteAssets,
  bulkUpdateAssetCategory,
  checkOutQuantity,
  createAsset,
  getActiveCustomFieldsForAsset,
  moveAssetLocationUnits,
  getAssets,
  parseAssetValuation,
  placeUnplacedUnits,
  refreshExpiredAssetImages,
  releaseQuantity,
  relinkAssetQrCode,
  renderBulkAssetTitle,
  updateAsset,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    // why: checkOutQuantity wraps its work in an interactive transaction — we
    // route callbacks to the same mocked db so inner tx.* calls hit our stubs.
    // Falls back to Promise.all for the array form so older suites still pass.
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray: unknown) =>
        typeof callbackOrArray === "function"
          ? (callbackOrArray as (tx: unknown) => unknown)(db)
          : Promise.all(callbackOrArray as Promise<unknown>[])
      ),
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
      count: vitest.fn().mockResolvedValue(0),
      update: vitest.fn().mockResolvedValue({}),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: checkOutQuantity returns the refreshed asset at the end of its tx
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
    },
    // why: bulkUpdateAssetCategory + updateAsset cross-org guards verify the
    // categoryId belongs to the caller's org
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
    // why: checkOutQuantity finds/creates/increments the operator-allocated
    // custody row; releaseQuantity finds it then deletes or decrements by
    // primary key. Both use `findFirst` (not `findUnique`) because the
    // composite (assetId, teamMemberId) uniqueness was split into two
    // partial uniques — operator-only WHERE kitCustodyId IS NULL and
    // kit-only WHERE kitCustodyId IS NOT NULL. `aggregate` totals every
    // Custody row on the asset for the availability calc.
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      findFirst: vitest.fn().mockResolvedValue(null),
      create: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      // Default: pretend other custody rows still exist so the
      // status-flip branch doesn't fire — tests that exercise the
      // "last release" branch override this.
      count: vitest.fn().mockResolvedValue(1),
    },
    // why: availability math must subtract units tied to ONGOING/OVERDUE bookings
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    // why: moveAssetLocationUnits + placeUnplacedUnits read/write the
    // AssetLocation pivot for the manual placement rows. `findFirst` is
    // scoped to `assetKitId: null` (manual rows only); `aggregate` sums
    // the unplaced pool for `placeUnplacedUnits`. Defaults are empty so
    // tests opt in to the placement state they need.
    assetLocation: {
      findFirst: vitest.fn().mockResolvedValue(null),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
    },
    // why: checkOutQuantity / releaseQuantity look up the custodian's user.id so
    // the CUSTODY_ASSIGNED / CUSTODY_RELEASED activity event can carry targetUserId.
    // `bulkCheckOutAssets` resolves the custodian via `findFirst` scoped to
    // { id, organizationId } (cross-org IDOR guard), so both are mocked.
    teamMember: {
      findUnique: vitest.fn().mockResolvedValue({ user: null }),
      findFirst: vitest.fn().mockResolvedValue({ user: null }),
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

// why: lockAssetForQuantityUpdate runs a raw SELECT ... FOR UPDATE that we
// cannot execute against a mocked tx — stub it to return a controlled asset
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn(),
}));

// why: avoid touching real consumption log writes during checkOutQuantity tests
vitest.mock("~/modules/consumption-log/service.server", () => ({
  createConsumptionLog: vitest.fn().mockResolvedValue({}),
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

// why: avoid creating actual notes during relink tests and during the
// inline-edit note helpers added by main.
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
  createAssetCategoryChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetDescriptionChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetNameChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetQuantityChangeNote: vitest.fn().mockResolvedValue({}),
  createAssetValuationChangeNote: vitest.fn().mockResolvedValue({}),
  createTagChangeNoteIfNeeded: vitest.fn().mockResolvedValue(undefined),
}));

// why: `moveAssetLocationUnits` / `placeUnplacedUnits` write the
// bidirectional "moved N units" note via `createLocationChangeNote` after
// the tx commits. We're not asserting note content here — just preventing
// DB writes by stubbing the helper.
vitest.mock("~/modules/location/service.server", () => ({
  createLocationChangeNote: vitest.fn().mockResolvedValue({}),
  createLocationsIfNotExists: vitest.fn().mockResolvedValue([]),
}));

// why: same as above for the per-location-timeline note writes that
// `moveAssetLocationUnits` + `placeUnplacedUnits` queue post-tx.
vitest.mock("~/modules/location-note/service.server", () => ({
  createSystemLocationNote: vitest.fn().mockResolvedValue({}),
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
  // why: the Custody partial-uniques split (operator vs kit-allocated) means
  // `checkOutQuantity` now does `findFirst` + branch into `create` or
  // `update` instead of `upsert` — Prisma's `upsert` needs a single
  // declared unique and we no longer have one. Track the create call as
  // the "new operator-allocated row was written" signal.
  const mockCustodyCreate = db.custody.create as ReturnType<typeof vitest.fn>;
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
    // why: the `refreshExpiredAssetImages` suite earlier in this file
    // sets `db.asset.update.mockRejectedValue(P2025)`. `clearAllMocks`
    // only resets call history — the rejection implementation persists
    // and breaks the new symmetric `tx.asset.update` step inside
    // `checkOutQuantity`. Restore the resolve.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
  });

  it("rejects when booking-reserved units push requested qty over available", async () => {
    // Regression guard: availability must subtract BOTH direct custody
    // AND units tied to ONGOING/OVERDUE bookings. Without the booking
    // term, the math is `100 - 0 = 100` and this checkout would
    // silently succeed even though only 20 units are physically free.
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
    expect(mockCustodyCreate).not.toHaveBeenCalled();
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

    expect(mockCustodyCreate).toHaveBeenCalledTimes(1);
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
    expect(mockCustodyCreate).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(1);
  });
});

describe("checkOutQuantity — activity events", () => {
  // Typed handles. The CUSTODY_ASSIGNED event is emitted inside the tx
  // after the custody upsert succeeds.
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  // checkOutQuantity / releaseQuantity now resolve the custodian via
  // `findFirst` scoped to { id, organizationId } (cross-org IDOR guard).
  const mockTeamMemberFindUnique = db.teamMember.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockRecordEvent = recordEvent as ReturnType<typeof vitest.fn>;

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
    // See note on the sibling availability-accounting suite — the
    // `refreshExpiredAssetImages` test earlier rejects `asset.update`
    // and that implementation survives `clearAllMocks`.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
  });

  it("emits CUSTODY_ASSIGNED with quantity + viaQuantity meta on successful checkout", async () => {
    mockTeamMemberFindUnique.mockResolvedValue({ user: { id: "user-42" } });

    await checkOutQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 5,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "CUSTODY_ASSIGNED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        teamMemberId: "tm-1",
        // Resolved through the team-member → user lookup
        targetUserId: "user-42",
        meta: { quantity: 5, viaQuantity: true },
      }),
      // Second arg is the tx client — assert it's truthy (the mocked db).
      expect.anything()
    );
  });

  it("falls back to undefined targetUserId when team member has no linked user", async () => {
    mockTeamMemberFindUnique.mockResolvedValue({ user: null });

    await checkOutQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 3,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CUSTODY_ASSIGNED",
        targetUserId: undefined,
      }),
      expect.anything()
    );
  });
});

describe("releaseQuantity — activity events", () => {
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  // why: the Custody partial-uniques split (operator vs kit-allocated) means
  // `releaseQuantity` now uses `findFirst` scoped to `kitCustodyId: null`
  // instead of `findUnique` by composite key. Track the new call.
  const mockCustodyFindFirst = db.custody.findFirst as ReturnType<
    typeof vitest.fn
  >;
  // checkOutQuantity / releaseQuantity now resolve the custodian via
  // `findFirst` scoped to { id, organizationId } (cross-org IDOR guard).
  const mockTeamMemberFindUnique = db.teamMember.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockRecordEvent = recordEvent as ReturnType<typeof vitest.fn>;

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
    // Existing custody row with 10 units — release of 4 is valid.
    mockCustodyFindFirst.mockResolvedValue({
      id: "custody-1",
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
    });
  });

  it("emits CUSTODY_RELEASED with quantity + viaQuantity meta on partial release", async () => {
    mockTeamMemberFindUnique.mockResolvedValue({ user: { id: "user-42" } });

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 4,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "CUSTODY_RELEASED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        teamMemberId: "tm-1",
        targetUserId: "user-42",
        meta: { quantity: 4, viaQuantity: true },
      }),
      expect.anything()
    );
  });

  it("flips Asset.status to AVAILABLE when the last custody row is removed", async () => {
    mockTeamMemberFindUnique.mockResolvedValue({ user: { id: "user-42" } });
    // Full release of the existing 10-unit custody row.
    mockCustodyFindFirst.mockResolvedValue({
      id: "custody-1",
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
    });
    // After delete, no rows remain → status should flip.
    (db.custody.count as ReturnType<typeof vitest.fn>).mockResolvedValue(0);
    const mockAssetUpdate = db.asset.update as ReturnType<typeof vitest.fn>;
    mockAssetUpdate.mockResolvedValue({});

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockAssetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: { status: "AVAILABLE" },
    });
  });

  it("does NOT flip Asset.status when other custody rows remain", async () => {
    mockTeamMemberFindUnique.mockResolvedValue({ user: { id: "user-42" } });
    mockCustodyFindFirst.mockResolvedValue({
      id: "custody-1",
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
    });
    // Partial release: 4 of 10 → row decremented, not deleted; count is 1.
    (db.custody.count as ReturnType<typeof vitest.fn>).mockResolvedValue(1);
    const mockAssetUpdate = db.asset.update as ReturnType<typeof vitest.fn>;
    mockAssetUpdate.mockResolvedValue({});

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 4,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockAssetUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "AVAILABLE" }),
      })
    );
  });
});

describe("bulkDeleteAssets — activity events", () => {
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockAssetDeleteMany = db.asset.deleteMany as ReturnType<
    typeof vitest.fn
  >;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
    mockAssetDeleteMany.mockResolvedValue({ count: 2 });
  });

  it("emits one ASSET_DELETED per deleted asset, with title meta", async () => {
    mockAssetFindMany.mockResolvedValue([
      { id: "asset-1", mainImage: null, title: "Asset One" },
      { id: "asset-2", mainImage: null, title: "Asset Two" },
    ]);

    await bulkDeleteAssets({
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      userId: "user-1",
      // settings is required by the function but only consumed by the
      // mocked resolveAssetIdsForBulkOperation, which echoes assetIds back.
      settings: {} as never,
    });

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const events = mockRecordEvents.mock.calls[0][0];
    expect(events).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "ASSET_DELETED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        meta: { title: "Asset One" },
      }),
      expect.objectContaining({
        action: "ASSET_DELETED",
        entityId: "asset-2",
        meta: { title: "Asset Two" },
      }),
    ]);
  });
});

describe("bulkUpdateAssetCategory — activity events", () => {
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits ASSET_CATEGORY_CHANGED only for assets whose category actually changed", async () => {
    // asset-1: cat-a → cat-b (changed)
    // asset-2: cat-b → cat-b (no-op, must be skipped)
    // asset-3: null → cat-b (changed; previous null)
    // Service now selects `category: { id, name, color }` (PR 0e53b1d04
    // added an IDOR-style cross-org check); update mocks to match the
    // nested shape and stub `db.category.findFirst` so the guard passes.
    mockAssetFindMany.mockResolvedValue([
      {
        id: "asset-1",
        category: { id: "cat-a", name: "A", color: "#111" },
      },
      {
        id: "asset-2",
        category: { id: "cat-b", name: "B", color: "#222" },
      },
      { id: "asset-3", category: null },
    ]);
    (db.category.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "cat-b",
      name: "B",
      color: "#222",
    });

    await bulkUpdateAssetCategory({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2", "asset-3"],
      organizationId: "org-1",
      categoryId: "cat-b",
      settings: {} as never,
    });

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const events = mockRecordEvents.mock.calls[0][0];
    expect(events).toHaveLength(2);
    expect(events).toEqual([
      expect.objectContaining({
        action: "ASSET_CATEGORY_CHANGED",
        entityId: "asset-1",
        field: "categoryId",
        fromValue: "cat-a",
        toValue: "cat-b",
      }),
      expect.objectContaining({
        action: "ASSET_CATEGORY_CHANGED",
        entityId: "asset-3",
        field: "categoryId",
        fromValue: null,
        toValue: "cat-b",
      }),
    ]);
  });

  it("propagates null toValue when category is being cleared", async () => {
    mockAssetFindMany.mockResolvedValue([
      {
        id: "asset-1",
        category: { id: "cat-a", name: "A", color: "#111" },
      },
    ]);
    // categoryId: null skips the IDOR check, no need to mock category.findFirst

    await bulkUpdateAssetCategory({
      userId: "user-1",
      assetIds: ["asset-1"],
      organizationId: "org-1",
      categoryId: null,
      settings: {} as never,
    });

    const events = mockRecordEvents.mock.calls[0][0];
    expect(events).toEqual([
      expect.objectContaining({
        action: "ASSET_CATEGORY_CHANGED",
        fromValue: "cat-a",
        toValue: null,
      }),
    ]);
  });
});

describe("bulkAssignAssetTags — activity events", () => {
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockAssetUpdate = db.asset.update as ReturnType<typeof vitest.fn>;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits ASSET_TAGS_CHANGED per asset whose tag set actually changed", async () => {
    // Pre-fetch returns previous tag arrays per asset.
    mockAssetFindMany.mockResolvedValue([
      { id: "asset-1", tags: [{ id: "tag-a", name: "A" }] },
      // asset-2 already has tag-b — connecting tag-b is a no-op
      { id: "asset-2", tags: [{ id: "tag-b", name: "B" }] },
    ]);
    // The per-asset update returns the asset with the post-update tag set.
    mockAssetUpdate.mockResolvedValueOnce({
      id: "asset-1",
      tags: [
        { id: "tag-a", name: "A" },
        { id: "tag-b", name: "B" },
      ],
    });
    mockAssetUpdate.mockResolvedValueOnce({
      id: "asset-2",
      // Same set as before — must be filtered out
      tags: [{ id: "tag-b", name: "B" }],
    });

    // IDOR check verifies every tagId belongs to this org via tag.findMany.
    (db.tag.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      { id: "tag-b" },
    ]);

    await bulkAssignAssetTags({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      tagsIds: ["tag-b"],
      remove: false,
      settings: {} as never,
    });

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const events = mockRecordEvents.mock.calls[0][0];
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        action: "ASSET_TAGS_CHANGED",
        entityId: "asset-1",
        field: "tags",
        fromValue: ["tag-a"],
        toValue: ["tag-a", "tag-b"],
      })
    );
  });
});

describe("updateAsset cross-org guards", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Asset itself is in-org so kit-block lookup and assetBeforeUpdate succeed.
    (db.asset.findUnique as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce({ assetKits: [] }) // kit-block check
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

describe("updateAsset newLocationQuantity", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // `clearAllMocks` only resets call history, not queued `*Once`
    // values. Reset the findUnique mock so any leftover queue from a
    // prior test can't bleed into the validation path here.
    vi.mocked(db.asset.findUnique).mockReset();
  });

  it("rejects with 400 when submitted qty exceeds Asset.quantity", async () => {
    // Kit-guard fetch returns the asset without a kit, type + total
    // attached so the new validator can read them. The dialog collapses
    // any existing multi-placement to a single row at the target, so
    // MAX = Asset.quantity (no orthogonal subtraction).
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      {
        type: "QUANTITY_TRACKED",
        quantity: 80,
        assetKits: [],
      }
    );

    // Org-scope check passes so the validator gets a chance to run.
    (db.location.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "loc-1",
    });

    await expect(
      updateAsset({
        id: "pens",
        userId: "user-1",
        organizationId: "org-A",
        newLocationId: "loc-1",
        currentLocationId: "loc-2",
        // 100 > 80 — should throw before the transaction runs.
        newLocationQuantity: 100,
      } as any)
    ).rejects.toMatchObject({
      status: 400,
      title: "Quantity exceeds available pool",
    });

    // Validation fires before db.asset.update, so the update never runs.
    expect(db.asset.update).not.toHaveBeenCalled();
  });
});

/**
 * Centralised SELF_SERVICE guards for the bulk custody flows.
 *
 * Both web and mobile bulk-assign / bulk-release routes funnel through
 * `bulkCheckOutAssets` / `bulkCheckInAssets`. Pre-fix the
 * "self-service can only assign-to-self" check lived inline in the
 * web route only — the mobile route shipped without it (hex-security
 * r3202162994 / r3202161632). Moving the check into the service makes
 * both callers safe by default; these tests are the regression guard.
 */
describe("bulkCheckOutAssets — SELF_SERVICE guard", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // Re-arm `db.asset.update` after the refreshExpiredAssetImages suite
    // (see notes on the checkOutQuantity suites).
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
  });

  it("rejects when SELF_SERVICE assigns to a custodian whose user is not the actor", async () => {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        type: "INDIVIDUAL",
      },
    ]);
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      {
        name: "Other Person",
        user: {
          id: "other-user",
          firstName: "Other",
          lastName: "Person",
          displayName: null,
        },
      }
    );

    let caught: unknown;
    try {
      await bulkCheckOutAssets({
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-other",
        custodianName: "Other Person",
        organizationId: "org-1",
        settings: {} as any,
        role: OrganizationRoles.SELF_SERVICE,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ShelfError);
    expect((caught as ShelfError).status).toBe(403);
    expect((caught as ShelfError).message).toContain(
      "Self user can only assign custody to themselves"
    );
  });

  it("allows SELF_SERVICE assigning to a custodian whose user IS the actor", async () => {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        type: "INDIVIDUAL",
      },
    ]);
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      {
        name: "Self",
        user: {
          id: "user-current",
          firstName: "Self",
          lastName: "User",
          displayName: null,
        },
      }
    );

    // Should not throw the 403; downstream calls may stub-fail but the
    // SELF_SERVICE branch is past by the time that happens.
    let threw403 = false;
    try {
      await bulkCheckOutAssets({
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-self",
        custodianName: "Self",
        organizationId: "org-1",
        settings: {} as any,
        role: OrganizationRoles.SELF_SERVICE,
      });
    } catch (err) {
      if (err instanceof ShelfError && err.status === 403) threw403 = true;
    }
    expect(threw403).toBe(false);
  });

  it("does not run the SELF_SERVICE check when role is ADMIN", async () => {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        type: "INDIVIDUAL",
      },
    ]);
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      {
        name: "Anyone",
        user: {
          id: "anyone",
          firstName: "A",
          lastName: "B",
          displayName: null,
        },
      }
    );

    let threw403 = false;
    try {
      await bulkCheckOutAssets({
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-anyone",
        custodianName: "Anyone",
        organizationId: "org-1",
        settings: {} as any,
        role: OrganizationRoles.ADMIN,
      });
    } catch (err) {
      if (err instanceof ShelfError && err.status === 403) threw403 = true;
    }
    expect(threw403).toBe(false);
  });

  it("does not run the SELF_SERVICE check when role is omitted (back-compat)", async () => {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        type: "INDIVIDUAL",
      },
    ]);
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      {
        name: "Anyone",
        user: {
          id: "anyone",
          firstName: "A",
          lastName: "B",
          displayName: null,
        },
      }
    );

    let threw403 = false;
    try {
      await bulkCheckOutAssets({
        userId: "user-current",
        // why: `role` was optional pre-main; main made it required so every
        // caller passes through the SELF_SERVICE guard. Pass ADMIN here to
        // assert the same intent the legacy test had — non-SELF_SERVICE
        // callers must not throw 403 on a custodian mismatch.
        role: OrganizationRoles.ADMIN,
        assetIds: ["asset-1"],
        custodianId: "tm-anyone",
        custodianName: "Anyone",
        organizationId: "org-1",
        settings: {} as any,
      });
    } catch (err) {
      if (err instanceof ShelfError && err.status === 403) threw403 = true;
    }
    expect(threw403).toBe(false);
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
      bulkCheckOutAssets({
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

  // why: the release-side SELF_SERVICE guard still lives inline in the route
  // (apps/webapp/app/routes/api+/assets.bulk-release-custody.ts), not yet
  // centralised into `bulkCheckInAssets` like the assign-side was into
  // `bulkCheckOutAssets`. Skipped here until that centralisation lands; the
  // route's own integration tests cover the behaviour today.
  it.skip("blocks a SELF_SERVICE user from releasing someone else's custody (centralised in service)", async () => {
    // intentionally empty — see comment above.
  });
});

describe("renderBulkAssetTitle", () => {
  it("substitutes the {i} token with the index value", () => {
    expect(renderBulkAssetTitle("Dell Latitude {i}", 5)).toBe(
      "Dell Latitude 5"
    );
  });

  it("substitutes every occurrence of {i}", () => {
    expect(renderBulkAssetTitle("Batt-{i}-{i}", 7)).toBe("Batt-7-7");
  });

  it("appends the index when no {i} token is present", () => {
    expect(renderBulkAssetTitle("Battery", 3)).toBe("Battery 3");
  });

  it("trims surrounding whitespace from the resolved title", () => {
    expect(renderBulkAssetTitle("  Battery {i}  ", 2)).toBe("Battery 2");
    // No-token fallback also trims the template before appending — surrounding
    // whitespace shouldn't leak into the rendered title.
    expect(renderBulkAssetTitle("  Battery  ", 4)).toBe("Battery 4");
  });

  it("supports the {i} token at the start, middle, and end", () => {
    expect(renderBulkAssetTitle("{i}-Drone", 9)).toBe("9-Drone");
    expect(renderBulkAssetTitle("Drone-{i}-X", 11)).toBe("Drone-11-X");
    expect(renderBulkAssetTitle("Drone-{i}", 100)).toBe("Drone-100");
  });
});

describe("bulkCreateAssetsFromModel — pre-validation rejects before any write", () => {
  // why: every test in this describe exercises the synchronous validation
  // block at the top of bulkCreateAssetsFromModel. None of them should reach
  // the org-scope assert / model read / create loop. We assert by inspecting
  // the thrown ShelfError; no db mocking required.

  const COMMON = {
    assetModelId: "am-1",
    nameTemplate: "Battery {i}",
    organizationId: "org-1",
    userId: "user-1",
  };

  it("rejects count < 2 (no batch makes sense for a single asset)", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid count");
  });

  it("rejects count > BULK_CREATE_MAX", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: BULK_CREATE_MAX + 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid count");
  });

  it("rejects non-integer count", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: 5.5,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.title).toBe("Invalid count");
  });

  it("rejects negative startNumber", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: 5,
      startNumber: -1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.title).toBe("Invalid start number");
  });

  it("rejects empty name template", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: 5,
      nameTemplate: "   ",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.title).toBe("Invalid name template");
  });

  it("rejects a `{i}`-only template (would render as raw integers)", async () => {
    const err = await bulkCreateAssetsFromModel({
      ...COMMON,
      count: 5,
      nameTemplate: "{i}",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.title).toBe("Invalid name template");
  });

  // Note on the duplicate-titles branch: with `{i}` substitution + a fixed
  // template, duplicates are only reachable via pathological inputs we
  // can't construct with public params (the renderer always varies the
  // suffix by `startNumber + i`). The branch is defensive — exercised by
  // manual walk-through, not by an automated test.
});

describe("moveAssetLocationUnits", () => {
  // Typed handles for the mocks we drive directly. The `findFirst`
  // mock is used twice per happy-path: once for the source row, once
  // for the destination row — `mockResolvedValueOnce` lets us script
  // each call in sequence.
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;
  const mockAssetLocationFindFirst = db.assetLocation.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationCreate = db.assetLocation.create as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationUpdate = db.assetLocation.update as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationDelete = db.assetLocation.delete as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockLocationFindFirst = db.location.findFirst as ReturnType<
    typeof vitest.fn
  >;

  /**
   * Realistic QUANTITY_TRACKED locked asset stub. The service reads only
   * `id`, `organizationId`, `type`, `quantity`, `unitOfMeasure`, `title`.
   */
  const lockedAsset = {
    id: "asset-1",
    title: "USB-C Cables",
    organizationId: "org-1",
    type: "QUANTITY_TRACKED" as const,
    quantity: 100,
    unitOfMeasure: "boxes",
  };

  const baseArgs = {
    assetId: "asset-1",
    organizationId: "org-1",
    userId: "user-1",
    fromLocationId: "loc-from",
    toLocationId: "loc-to",
    quantity: 25,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    mockLock.mockResolvedValue(lockedAsset);
    // why: prior describe blocks may have left a rejection on
    // `asset.update` — restore the default resolve so the tx body
    // doesn't blow up on writes it doesn't even use.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
    // why: `assertAssetsBelongToOrg` runs `db.asset.findMany` with
    // `{ id: { in: [assetId] }, organizationId }`. Echo the input so the
    // org-scope guard passes by default.
    mockAssetFindMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id })))
    );
    // why: `assertLocationBelongsToOrg` runs `db.location.findFirst` —
    // by default return the queried id so both src/dest validate. Also
    // covers the post-tx `db.location.findFirst` for the note-writer
    // sequence at the end of the service.
    mockLocationFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, name: where.id })
    );
  });

  it("creates a new destination row when 25/100 are moved to a fresh location", async () => {
    // Source row has 100; no existing destination row.
    mockAssetLocationFindFirst
      .mockResolvedValueOnce({ id: "al-src", quantity: 100 })
      .mockResolvedValueOnce(null);

    const result = await moveAssetLocationUnits(baseArgs);

    expect(result.fromQuantity).toBe(75);
    expect(result.toQuantity).toBe(25);
    expect(result.sourceRowDeleted).toBe(false);
    expect(result.moveCorrelationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    expect(mockAssetLocationUpdate).toHaveBeenCalledWith({
      where: { id: "al-src" },
      data: { quantity: 75 },
    });
    expect(mockAssetLocationCreate).toHaveBeenCalledWith({
      data: {
        assetId: "asset-1",
        locationId: "loc-to",
        organizationId: "org-1",
        quantity: 25,
      },
    });
    expect(mockAssetLocationDelete).not.toHaveBeenCalled();
  });

  it("merges into an existing destination row instead of creating a new one", async () => {
    mockAssetLocationFindFirst
      .mockResolvedValueOnce({ id: "al-src", quantity: 100 })
      .mockResolvedValueOnce({ id: "al-dst", quantity: 25 });

    const result = await moveAssetLocationUnits(baseArgs);

    expect(result.fromQuantity).toBe(75);
    expect(result.toQuantity).toBe(50);
    expect(result.sourceRowDeleted).toBe(false);

    // Destination merged into existing row, not freshly created.
    expect(mockAssetLocationCreate).not.toHaveBeenCalled();
    expect(mockAssetLocationUpdate).toHaveBeenCalledWith({
      where: { id: "al-dst" },
      data: { quantity: 50 },
    });
  });

  it("deletes the source row when the move exhausts it", async () => {
    mockAssetLocationFindFirst
      .mockResolvedValueOnce({ id: "al-src", quantity: 25 })
      .mockResolvedValueOnce(null);

    const result = await moveAssetLocationUnits(baseArgs);

    expect(result.fromQuantity).toBe(0);
    expect(result.toQuantity).toBe(25);
    expect(result.sourceRowDeleted).toBe(true);

    expect(mockAssetLocationDelete).toHaveBeenCalledWith({
      where: { id: "al-src" },
    });
    // Update path must NOT fire when the row is deleted.
    expect(mockAssetLocationUpdate).not.toHaveBeenCalled();
  });

  it("emits two paired ASSET_LOCATION_CHANGED events sharing a moveCorrelationId", async () => {
    mockAssetLocationFindFirst
      .mockResolvedValueOnce({ id: "al-src", quantity: 100 })
      .mockResolvedValueOnce(null);

    const result = await moveAssetLocationUnits(baseArgs);

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const [events] = mockRecordEvents.mock.calls[0] as [
      Array<{
        action: string;
        meta: { moveCorrelationId: string; side: "from" | "to" };
      }>,
    ];
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("ASSET_LOCATION_CHANGED");
    expect(events[1].action).toBe("ASSET_LOCATION_CHANGED");
    expect(events[0].meta.side).toBe("from");
    expect(events[1].meta.side).toBe("to");
    // Both halves of the move share the same correlation id, AND it
    // matches the one returned to the caller.
    expect(events[0].meta.moveCorrelationId).toBe(
      events[1].meta.moveCorrelationId
    );
    expect(events[0].meta.moveCorrelationId).toBe(result.moveCorrelationId);
  });

  it("rejects an INDIVIDUAL asset (split/merge is QUANTITY_TRACKED-only)", async () => {
    mockLock.mockResolvedValue({
      ...lockedAsset,
      type: "INDIVIDUAL" as const,
    });

    const err = await moveAssetLocationUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("quantity-tracked");
    expect(mockAssetLocationUpdate).not.toHaveBeenCalled();
    expect(mockAssetLocationCreate).not.toHaveBeenCalled();
  });

  it("rejects when source and destination are the same location", async () => {
    const err = await moveAssetLocationUnits({
      ...baseArgs,
      toLocationId: baseArgs.fromLocationId,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("different");
  });

  it("rejects a non-positive quantity", async () => {
    const err = await moveAssetLocationUnits({
      ...baseArgs,
      quantity: 0,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("positive");
  });

  it("rejects when the asset is not placed at the source location (kit-driven rows are filtered out)", async () => {
    // No manual source row — either the asset isn't placed there at
    // all, or all placement at this location is kit-driven (the
    // service's `assetKitId: null` filter excludes those).
    mockAssetLocationFindFirst.mockResolvedValueOnce(null);

    const err = await moveAssetLocationUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain(
      "not placed at the source location"
    );
  });

  it("rejects an over-move and surfaces the available quantity in the error", async () => {
    // Source has 10 boxes; user tries to move 25.
    mockAssetLocationFindFirst.mockResolvedValueOnce({
      id: "al-src",
      quantity: 10,
    });

    const err = await moveAssetLocationUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    // Helpful error: surface the available count + unit label so the
    // user understands what to retry with.
    expect((err as ShelfError).message).toMatch(/Only/);
    expect((err as ShelfError).message).toMatch(/10/);
    expect(mockAssetLocationUpdate).not.toHaveBeenCalled();
    expect(mockAssetLocationDelete).not.toHaveBeenCalled();
  });

  it("rejects when the asset belongs to another org (assertAssetsBelongToOrg)", async () => {
    // Empty result → the org-scope guard throws a 400.
    mockAssetFindMany.mockResolvedValue([]);

    const err = await moveAssetLocationUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    // The lock+placement work must NOT have happened.
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("rejects when the destination location is not in the org (assertLocationBelongsToOrg)", async () => {
    // Default location.findFirst is overridden to return null for
    // `loc-to`, simulating a cross-org destination ID.
    mockLocationFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "loc-to" ? null : { id: where.id, name: where.id }
        )
    );

    const err = await moveAssetLocationUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    // assertLocationBelongsToOrg throws 400 ("Invalid location") for both
    // missing and cross-org IDs — same status as the asset-side
    // assertAssetsBelongToOrg guard. Treating either as 404 would let
    // attackers probe ID existence across orgs.
    expect((err as ShelfError).status).toBe(400);
  });

  it("does not touch AssetKit, Custody, or BookingAsset rows (orthogonal-axes invariant)", async () => {
    mockAssetLocationFindFirst
      .mockResolvedValueOnce({ id: "al-src", quantity: 100 })
      .mockResolvedValueOnce(null);

    await moveAssetLocationUnits(baseArgs);

    // Orthogonal-axes invariant — moving on the location axis must not
    // alter the kit axis or any custody/booking pivot rows.
    expect(db.custody.create).not.toHaveBeenCalled();
    expect(db.custody.update).not.toHaveBeenCalled();
    expect(db.custody.delete).not.toHaveBeenCalled();
    // No BookingAsset writes are exposed on the asset-side mock; the
    // service has no `bookingAsset` writes inside this path either —
    // verified by the absence of failing calls above.
  });
});

describe("placeUnplacedUnits", () => {
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;
  const mockAssetLocationFindFirst = db.assetLocation.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationAggregate = db.assetLocation.aggregate as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationCreate = db.assetLocation.create as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetLocationUpdate = db.assetLocation.update as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockLocationFindFirst = db.location.findFirst as ReturnType<
    typeof vitest.fn
  >;

  const lockedAsset = {
    id: "asset-1",
    title: "USB-C Cables",
    organizationId: "org-1",
    type: "QUANTITY_TRACKED" as const,
    quantity: 30,
    unitOfMeasure: "boxes",
  };

  const baseArgs = {
    assetId: "asset-1",
    organizationId: "org-1",
    userId: "user-1",
    toLocationId: "loc-office",
    quantity: 10,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    mockLock.mockResolvedValue(lockedAsset);
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
    mockAssetFindMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id })))
    );
    mockLocationFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, name: where.id })
    );
  });

  it("places 10 unplaced units at a fresh destination", async () => {
    // Asset has 30 units; 20 already placed → 10 unplaced. We ask for
    // exactly 10.
    mockAssetLocationAggregate.mockResolvedValue({ _sum: { quantity: 20 } });
    mockAssetLocationFindFirst.mockResolvedValueOnce(null);

    const result = await placeUnplacedUnits(baseArgs);

    expect(result.toQuantity).toBe(10);
    expect(result.moveCorrelationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(mockAssetLocationCreate).toHaveBeenCalledWith({
      data: {
        assetId: "asset-1",
        locationId: "loc-office",
        organizationId: "org-1",
        quantity: 10,
      },
    });
  });

  it("merges into an existing manual row at the destination", async () => {
    // Asset has 30 units; 0 placed → 30 unplaced.
    mockAssetLocationAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    // Existing manual row at the destination with 20 units already.
    mockAssetLocationFindFirst.mockResolvedValueOnce({
      id: "al-dst",
      quantity: 20,
    });

    const result = await placeUnplacedUnits(baseArgs);

    expect(result.toQuantity).toBe(30);
    expect(mockAssetLocationCreate).not.toHaveBeenCalled();
    expect(mockAssetLocationUpdate).toHaveBeenCalledWith({
      where: { id: "al-dst" },
      data: { quantity: 30 },
    });
  });

  it("emits ONE ASSET_LOCATION_CHANGED event with meta.placeUnplaced", async () => {
    mockAssetLocationAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mockAssetLocationFindFirst.mockResolvedValueOnce(null);

    await placeUnplacedUnits(baseArgs);

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const [events] = mockRecordEvents.mock.calls[0] as [
      Array<{
        action: string;
        meta: { placeUnplaced?: boolean; side?: string };
      }>,
    ];
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe("ASSET_LOCATION_CHANGED");
    expect(events[0].meta.placeUnplaced).toBe(true);
    expect(events[0].meta.side).toBe("to");
  });

  it("rejects when the user tries to place more than the unplaced pool", async () => {
    // Pool: 30 total − 25 placed = 5 unplaced. User asks for 10.
    mockAssetLocationAggregate.mockResolvedValue({ _sum: { quantity: 25 } });

    const err = await placeUnplacedUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toMatch(/Only/);
    expect((err as ShelfError).message).toMatch(/unplaced/);
    expect(mockAssetLocationCreate).not.toHaveBeenCalled();
    expect(mockAssetLocationUpdate).not.toHaveBeenCalled();
  });

  it("rejects an INDIVIDUAL asset", async () => {
    mockLock.mockResolvedValue({
      ...lockedAsset,
      type: "INDIVIDUAL" as const,
    });

    const err = await placeUnplacedUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("quantity-tracked");
  });

  it("rejects a non-positive quantity", async () => {
    const err = await placeUnplacedUnits({
      ...baseArgs,
      quantity: -5,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("positive");
  });

  it("rejects a cross-org destination location with status 400", async () => {
    // assertLocationBelongsToOrg throws 400 ("Invalid location") for both
    // missing and cross-org IDs — uniform with the other org-scope guards so
    // attackers can't probe ID existence across orgs.
    mockLocationFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "loc-office" ? null : { id: where.id, name: where.id }
        )
    );

    const err = await placeUnplacedUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
  });

  it("rejects a cross-org asset (assertAssetsBelongToOrg)", async () => {
    mockAssetFindMany.mockResolvedValue([]);

    const err = await placeUnplacedUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("does not touch AssetKit, Custody, or BookingAsset rows", async () => {
    mockAssetLocationAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    mockAssetLocationFindFirst.mockResolvedValueOnce(null);

    await placeUnplacedUnits(baseArgs);

    expect(db.custody.create).not.toHaveBeenCalled();
    expect(db.custody.update).not.toHaveBeenCalled();
    expect(db.custody.delete).not.toHaveBeenCalled();
  });
});

describe("getAssets search fallback", () => {
  const findManyMock = vi.mocked(db.asset.findMany);
  const countMock = vi.mocked(db.asset.count);

  /** Minimal required params for a simple-index search call. */
  const baseParams = {
    organizationId: "org-1",
    page: 1,
    perPage: 8,
    orderBy: "createdAt" as const,
    orderDirection: "desc" as const,
  };

  /**
   * Title contains-clause used to assert the full (post-fallback) search clause
   * surfaces title matches. Note: title now ALSO appears in the narrow fast-path
   * clause (see the first test below) so bare-numeric substrings embedded in a
   * title are matched without needing the zero-row fallback.
   */
  const titleClause = {
    title: { contains: "103468", mode: "insensitive" },
  };

  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
  });

  it("runs only the narrow indexed clause when an ID-shaped query matches", async () => {
    // why: first (and only) fetch returns a row, so no fallback is needed.
    findManyMock.mockResolvedValueOnce([{ id: "a1" }] as never);
    countMock.mockResolvedValueOnce(1 as never);

    const result = await getAssets({ ...baseParams, search: "103468" });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = (findManyMock.mock.calls[0][0] as any).where;
    // Narrow clause covers the indexed ID columns: sequentialId / barcode / qr.
    expect(where.OR).toContainEqual({
      sequentialId: { contains: "103468", mode: "insensitive" },
    });
    expect(where.OR).toContainEqual({
      barcodes: {
        some: { value: { contains: "103468", mode: "insensitive" } },
      },
    });
    expect(where.OR).toContainEqual({
      qrCodes: { some: { id: { contains: "103468", mode: "insensitive" } } },
    });
    // ...and ALSO title + description (both trigram-indexed), so a bare-numeric
    // substring embedded in a title is matched directly in the fast path
    // instead of relying on the zero-row fallback.
    expect(where.OR).toContainEqual({
      title: { contains: "103468", mode: "insensitive" },
    });
    expect(where.OR).toContainEqual({
      description: { contains: "103468", mode: "insensitive" },
    });
    expect(result).toEqual({ assets: [{ id: "a1" }], totalAssets: 1 });
  });

  it("matches a title-embedded number in the fast path without falling back", async () => {
    // why: regression guard for the dropped "451" → "KCI-451 Kids Resources Box"
    // match. "451" is ID-shaped (bare digits) so it takes the narrow path, but
    // the number lives only inside the title. The narrow clause must carry a
    // `title` contains-clause so the row surfaces on the FIRST query — otherwise
    // an unrelated ID-column match returns rows, suppresses the zero-row
    // fallback, and the title-only asset is silently dropped.
    findManyMock.mockResolvedValueOnce([{ id: "kci-451" }] as never);
    countMock.mockResolvedValueOnce(1 as never);

    await getAssets({ ...baseParams, search: "451" });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = (findManyMock.mock.calls[0][0] as any).where;
    expect(where.OR).toContainEqual({
      title: { contains: "451", mode: "insensitive" },
    });
  });

  it("falls back to the full search when the narrow clause matches nothing", async () => {
    // why: narrow query finds 0 rows; the number is embedded in a title, so the
    // fallback re-query with the full clause must surface it.
    findManyMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "a1" }] as never);
    countMock
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(1 as never);

    const result = await getAssets({ ...baseParams, search: "103468" });

    expect(findManyMock).toHaveBeenCalledTimes(2);
    // The narrow-first behaviour is asserted by the single-query test above;
    // getAssets mutates and reuses one `where` object across both fetches, so
    // we can only reliably inspect its final (post-fallback) state here.
    const secondWhere = (findManyMock.mock.calls[1][0] as any).where;
    expect(secondWhere.OR[0]).toEqual({
      OR: expect.arrayContaining([titleClause]),
    });
    expect(result).toEqual({ assets: [{ id: "a1" }], totalAssets: 1 });
  });

  it("does not run the fast path for free-text searches", async () => {
    // why: "armchair" is not ID-shaped, so the full clause is used directly and
    // there is never a second query even when zero rows match.
    findManyMock.mockResolvedValueOnce([] as never);
    countMock.mockResolvedValueOnce(0 as never);

    await getAssets({ ...baseParams, search: "armchair" });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = (findManyMock.mock.calls[0][0] as any).where;
    expect(JSON.stringify(where.OR)).toContain("title");
  });

  it("preserves appended filter clauses when falling back", async () => {
    // why: the fallback must keep filter OR clauses (here: team-member custody)
    // appended after the search, or it would return assets outside the filter.
    findManyMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ id: "a1" }] as never);
    countMock
      .mockResolvedValueOnce(0 as never)
      .mockResolvedValueOnce(1 as never);

    await getAssets({
      ...baseParams,
      search: "103468",
      teamMemberIds: ["tm-1"],
    });

    const secondWhere = (findManyMock.mock.calls[1][0] as any).where;
    // Full search clause swapped in...
    expect(secondWhere.OR[0]).toEqual({
      OR: expect.arrayContaining([titleClause]),
    });
    // ...and the team-member filter clause survived the fallback.
    // Post-pivot: custody is now a relation (multiple per-unit rows), so the
    // teamMember predicate is nested under `some` (was the direct field).
    expect(secondWhere.OR).toContainEqual({
      custody: { some: { teamMemberId: { in: ["tm-1"] } } },
    });
  });
});
