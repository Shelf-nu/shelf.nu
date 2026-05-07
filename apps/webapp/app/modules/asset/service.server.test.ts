import { describe, expect, it, vitest, beforeEach } from "vitest";
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
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import {
  bulkAssignAssetTags,
  bulkDeleteAssets,
  bulkUpdateAssetCategory,
  checkOutQuantity,
  createAsset,
  refreshExpiredAssetImages,
  releaseQuantity,
  relinkAssetQrCode,
  updateAsset,
  uploadDuplicateAssetMainImage,
} from "./service.server";

// why: isolating asset service logic from actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: checkOutQuantity returns the refreshed asset at the end of its tx
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
    },
    location: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
    // why: checkOutQuantity upserts custody rows and aggregates custody/booking totals;
    // releaseQuantity additionally reads / decrements / deletes them, and
    // counts remaining rows after a release to decide whether to flip
    // Asset.status back to AVAILABLE.
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      upsert: vitest.fn().mockResolvedValue({}),
      findUnique: vitest.fn().mockResolvedValue(null),
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
    // why: checkOutQuantity / releaseQuantity look up the custodian's user.id so
    // the CUSTODY_ASSIGNED / CUSTODY_RELEASED activity event can carry targetUserId
    teamMember: {
      findUnique: vitest.fn().mockResolvedValue({ user: null }),
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
  createTagChangeNoteIfNeeded: vitest.fn().mockResolvedValue({}),
}));

// why: asset service emits activity events alongside its mutations — stub so
// tests can assert on payloads without actually persisting events.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: bulk-operations resolution helper hits the DB; the bulk tests in this
// file exercise the post-resolve event emission, not the resolver itself.
vitest.mock("./bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vitest
    .fn()
    .mockImplementation(({ assetIds }: { assetIds: string[] }) =>
      Promise.resolve(assetIds)
    ),
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
    // why: the `refreshExpiredAssetImages` suite earlier in this file
    // sets `db.asset.update.mockRejectedValue(P2025)`. `clearAllMocks`
    // only resets call history — the rejection implementation persists
    // and breaks the new symmetric `tx.asset.update` step inside
    // `checkOutQuantity`. Restore the resolve.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
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

describe("checkOutQuantity — activity events", () => {
  // Typed handles. The CUSTODY_ASSIGNED event is emitted inside the tx
  // after the custody upsert succeeds.
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockTeamMemberFindUnique = db.teamMember.findUnique as ReturnType<
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
  const mockCustodyFindUnique = db.custody.findUnique as ReturnType<
    typeof vitest.fn
  >;
  const mockTeamMemberFindUnique = db.teamMember.findUnique as ReturnType<
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
    mockCustodyFindUnique.mockResolvedValue({
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
    mockCustodyFindUnique.mockResolvedValue({
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
    mockCustodyFindUnique.mockResolvedValue({
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
    mockAssetFindMany.mockResolvedValue([
      { id: "asset-1", categoryId: "cat-a" },
      { id: "asset-2", categoryId: "cat-b" },
      { id: "asset-3", categoryId: null },
    ]);

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
      { id: "asset-1", categoryId: "cat-a" },
    ]);

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
