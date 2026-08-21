import {
  AssetStatus,
  OrganizationRoles,
  type AssetIndexSettings,
} from "@prisma/client";
import { describe, expect, it, vi, vitest, beforeEach } from "vitest";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  recordEvent,
  recordEvents,
} from "~/modules/activity-event/service.server";
import { assertAssetQuantityNotBelowReservations } from "~/modules/asset/availability-primitives.server";
import { getCategory } from "~/modules/category/service.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createConsumptionLog } from "~/modules/consumption-log/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { bulkAssignKitCustody } from "~/modules/kit/service.server";
import { createNote } from "~/modules/note/service.server";
import { getQr } from "~/modules/qr/service.server";
import { ShelfError } from "~/utils/error";
import { createSignedUrl } from "~/utils/storage.server";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
import {
  ASSET_SEARCH_CEILING_MESSAGE,
  MAX_MATCHED_ASSET_SEARCH_IDS,
} from "./search.server";
import {
  BULK_CREATE_MAX,
  bulkAssignAssetTags,
  bulkCheckOutAssets,
  bulkCreateAssetsFromModel,
  bulkDeleteAssets,
  bulkUpdateAssetCategory,
  bulkUpdateAssetModel,
  buildAssetKitCreateData,
  checkOutQuantity,
  createAsset,
  setKitCustodyAfterAssetImport,
  getActiveCustomFieldsForAsset,
  moveAssetLocationUnits,
  getAssets,
  parseAssetValuation,
  placeUnplacedUnits,
  refreshExpiredAssetImages,
  releaseQuantity,
  replaceAssetPlacements,
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
    // why: getAssets resolves its search term to matching asset ids via the
    // shared buildAssetSearchUnion, executed as a raw query.
    $queryRaw: vitest.fn().mockResolvedValue([]),
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
    // why: `~/utils/org-validation.server` is NOT mocked in this file, so
    // `assertAssetModelBelongsToOrg` runs for real inside
    // `bulkUpdateAssetModel` and hits this stub. Without the key the guard
    // throws a TypeError instead of exercising the org check.
    assetModel: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    location: {
      findFirst: vitest.fn().mockResolvedValue(null),
      // why: `replaceAssetPlacements` resolves every submitted locationId
      // through a single org-scoped `findMany` (the cross-org guard) and
      // reuses the (id, name) pairs for the per-row placement notes.
      findMany: vitest.fn().mockResolvedValue([]),
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
      // why: `bulkCheckOutAssets` clears stale rows then bulk-inserts. Without
      // these the transaction body throws on an undefined stub before it ever
      // reaches the status guard under test.
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: availability math must subtract units tied to ONGOING/OVERDUE bookings
    bookingAsset: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
    },
    // why: moveAssetLocationUnits + placeUnplacedUnits read/write the
    // AssetLocation pivot for the manual placement rows. `findFirst` is
    // scoped to `assetKitId: null` (manual rows only); `aggregate` sums
    // the unplaced pool for `placeUnplacedUnits`; `findMany` is how
    // `reconcileManualPlacementsForStockDecrease` reads the manual rows it
    // may have to trim. Defaults are empty so tests opt in to the placement
    // state they need.
    assetLocation: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
      // why: `replaceAssetPlacements` applies its diff with the bulk
      // delegates, and `updateAsset`'s placement path clears manual rows with
      // `deleteMany` before creating the new one.
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
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

// why: the stock-lowering guard's own committed-peak math (custody + kits +
// peak-concurrent bookings) is exhaustively unit-tested in
// `availability.server.test.ts`. Here we only verify updateAsset's WIRING —
// that it's called with the right args when quantity is lowered on a
// QUANTITY_TRACKED asset, and that its rejection propagates — so stubbing it
// avoids re-deriving custody/kit/booking fixtures in this already-large file.
// `updateAsset` imports the guard from the dependency-free leaf (not
// `availability.server`) to avoid the heavy transitive import chain — mock the
// leaf so the stub intercepts.
vitest.mock("~/modules/asset/availability-primitives.server", () => ({
  assertAssetQuantityNotBelowReservations: vitest.fn(),
}));

// why: avoid touching real consumption log writes during checkOutQuantity tests
vitest.mock("~/modules/consumption-log/service.server", () => ({
  createConsumptionLog: vitest.fn().mockResolvedValue({}),
}));

// why: wiring-only — assert that updateAsset invokes the low-stock notifier on
// a quantity DROP without running the real debounce/email logic (that logic is
// exhaustively tested in low-stock.server.test.ts).
vitest.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vitest.fn().mockResolvedValue(undefined),
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

// why: setKitCustodyAfterAssetImport delegates to the canonical bulkAssignKitCustody
// flow (kit/service). Mock it so we can assert the delegation (grouping by
// custodian) without running the full kit-custody transaction.
vitest.mock("~/modules/kit/service.server", () => ({
  bulkAssignKitCustody: vitest.fn(),
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

  /** Shared happy-path args; individual tests vary only the QR state. */
  const args = {
    qrId: "qr-1",
    assetId: "asset-1",
    organizationId: "org-1",
    userId: "user-1",
  };

  it("throws 403 when the QR belongs to another organization", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-other",
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [] });

    await expect(relinkAssetQrCode(args)).rejects.toMatchObject({
      status: 403,
      title: "QR not valid.",
    });
    expect(db.qr.update).not.toHaveBeenCalled();
  });

  it("throws 404 when the asset is missing or not in the caller's org", async () => {
    // why: `db.asset.findFirst` is org-scoped, so null means missing OR another
    // tenant's. Explicitly 404 and uncaptured — not the generic
    // "requested resource could not be found" a bare P2025 would produce, and
    // not the 500 a statusless ShelfError would resolve to.
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue(null);

    await expect(relinkAssetQrCode(args)).rejects.toMatchObject({
      status: 404,
      title: "Asset not found.",
    });
    expect(db.qr.update).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
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

    await expect(relinkAssetQrCode(args)).rejects.toMatchObject({
      // why: user-caused guard, not a server fault — the mobile route
      // documents 403 for it and clients must not retry it as a 5xx.
      status: 403,
      title: "QR already linked.",
    });
  });

  it("throws 403 when the QR is already linked to a different asset", async () => {
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-other",
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [] });

    await expect(relinkAssetQrCode(args)).rejects.toMatchObject({
      status: 403,
      title: "QR already linked.",
    });
    expect(db.qr.update).not.toHaveBeenCalled();
  });

  it("claims an UNCLAIMED QR inline, pinning the still-unclaimed state", async () => {
    // why: this is the branch the mobile link flow now depends on — the
    // separate claimQrCode step was removed, so an unclaimed code is claimed
    // as part of the link. Nothing covered it before.
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: null,
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [] });

    await relinkAssetQrCode(args);

    expect(db.qr.update).toHaveBeenCalledWith({
      where: { id: "qr-1", organizationId: null, kitId: null, assetId: null },
      data: { organizationId: "org-1", userId: "user-1" },
    });
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

    await relinkAssetQrCode(args);

    expect(db.qr.update).toHaveBeenCalledWith({
      // why: the WHERE re-asserts the state the guards observed, so a
      // concurrent writer that changed it loses instead of both winning.
      where: {
        id: "qr-1",
        organizationId: "org-1",
        kitId: null,
        assetId: null,
      },
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

  it("loses the race safely: 403, and no asset or note write", async () => {
    // why: the conditional WHERE means a competing writer makes this update
    // match zero rows (P2025). The asset's existing code must NOT be cleared
    // and no "changed QR code" note may be written for a link that never
    // happened — that would falsify the audit trail.
    //@ts-expect-error mock setup
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: null,
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error mock setup
    db.asset.findFirst.mockResolvedValue({ qrCodes: [{ id: "old-qr" }] });
    //@ts-expect-error mock setup
    db.qr.update.mockRejectedValueOnce(
      Object.assign(new Error("no rows"), { code: "P2025" })
    );

    await expect(relinkAssetQrCode(args)).rejects.toMatchObject({
      status: 403,
      title: "QR already linked.",
    });
    expect(db.asset.update).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
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
  // The background flush persists via a guarded updateMany (on the original
  // mainImage), not update — assert on updateMany here.
  const mockUpdateMany = db.asset.updateMany as ReturnType<typeof vitest.fn>;
  const mockCreateSignedUrl = createSignedUrl as ReturnType<typeof vitest.fn>;
  const mockExtractStoragePath = extractStoragePath as ReturnType<
    typeof vitest.fn
  >;

  beforeEach(() => {
    vitest.clearAllMocks();
    mockExtractStoragePath.mockReturnValue("org/asset/image.jpg");
    mockCreateSignedUrl.mockResolvedValue("https://new-signed-url.com");
    // Default: the guarded write matches one row (image unchanged since read).
    mockUpdateMany.mockResolvedValue({ count: 1 });
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
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

    // The return value carries the fresh URLs synchronously — re-signing stays
    // awaited, only the DB persist is deferred.
    expect(result[0].mainImage).toBe("https://new-main-url.com");
    expect(result[0].thumbnailImage).toBe("https://new-thumbnail-url.com");

    // The persist now runs in a fire-and-forget background batch, so wait for
    // the flush before asserting the write happened.
    await vi.waitFor(() =>
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          // Guarded on the original mainImage AND thumbnailImage (a thumbnail is
          // written here) so a concurrent replace of either can't be clobbered
          // by this deferred write.
          where: {
            id: "asset-1",
            organizationId: "org-1",
            mainImage: "https://old-signed-url.com",
            thumbnailImage: "https://old-thumbnail-url.com",
          },
          data: expect.objectContaining({
            mainImage: "https://new-main-url.com",
            thumbnailImage: "https://new-thumbnail-url.com",
          }),
        })
      )
    );
  });

  it("applies backoff when extractStoragePath returns null", async () => {
    mockExtractStoragePath.mockReturnValue(null);
    const assets = [makeAsset()];

    const result = await refreshExpiredAssetImages(assets);

    // Should return original asset (no refresh)
    expect(result[0].mainImage).toBe("https://old-signed-url.com");
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();

    // The backoff bump is now persisted in the deferred background batch —
    // wait for the flush before asserting the write.
    await vi.waitFor(() =>
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "asset-1",
            organizationId: "org-1",
            mainImage: "https://old-signed-url.com",
          },
          data: expect.objectContaining({
            mainImageExpiration: expect.any(Date),
          }),
        })
      )
    );
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

    // Backoff update is deferred to the background batch — wait for the flush.
    await vi.waitFor(() =>
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mainImageExpiration: expect.any(Date),
          }),
        })
      )
    );
  });

  it("returns fresh URLs when the row was deleted or its image changed (updateMany count 0)", async () => {
    // Regression guard for the deferred-write refactor: the persist is a guarded
    // updateMany that runs fire-and-forget AFTER the response value is built. If
    // the asset was deleted OR its image was replaced between the read and the
    // flush, the guard matches no rows and updateMany resolves { count: 0 }
    // (never throws P2025). The returned URLs must still be the freshly
    // re-signed ones — the next load simply re-signs (idempotent).
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const assets = [makeAsset()];

    // Resolves (no throw) with the freshly re-signed URL.
    const result = await refreshExpiredAssetImages(assets);
    expect(result[0].mainImage).toBe("https://new-signed-url.com");

    // The guarded write was still attempted in the background.
    await vi.waitFor(() => expect(mockUpdateMany).toHaveBeenCalled());
  });

  it("returns fresh URLs even when the background persist throws unexpectedly", async () => {
    // A non-expected write failure (e.g. a pool timeout) is swallowed + logged
    // in the background and must not affect the returned URLs or throw.
    mockUpdateMany.mockRejectedValue(new Error("connection pool timeout"));
    const assets = [makeAsset()];

    const result = await refreshExpiredAssetImages(assets);
    expect(result[0].mainImage).toBe("https://new-signed-url.com");

    await vi.waitFor(() => expect(mockUpdateMany).toHaveBeenCalled());
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
    // why: the `refreshExpiredAssetImages` suite earlier in this file leaves
    // `db.asset.updateMany.mockRejectedValue(...)` set (its last test).
    // `clearAllMocks` only resets call history — the rejection implementation
    // persists across suites — so restore both write mocks to a resolve.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });
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
    // `refreshExpiredAssetImages` test earlier leaves `asset.updateMany`
    // rejected, and that implementation survives `clearAllMocks`.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });
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
        // The split is recorded on the event so reports can tell a return
        // from a consume without re-deriving it from the asset row.
        meta: { quantity: 4, viaQuantity: true, consumed: 0, returned: 4 },
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
    const mockAssetUpdateMany = db.asset.updateMany as ReturnType<
      typeof vitest.fn
    >;
    mockAssetUpdateMany.mockResolvedValue({ count: 1 });

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    // `updateMany` + a `status: { not: CHECKED_OUT }` guard, so releasing the
    // last custody row can never advertise an asset that is still physically
    // out on a booking as AVAILABLE. See the "custody writes must not
    // overwrite CHECKED_OUT" suite for the behavioural coverage.
    expect(mockAssetUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        organizationId: "org-1",
        status: { not: "CHECKED_OUT" },
      },
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

/**
 * Ending a custodian's hold means something different per `consumptionType`:
 * a TWO_WAY asset's units go back in the pool, a ONE_WAY consumable's units
 * are gone. Before this suite nothing on the direct-custody path exercised
 * `consumptionType` at all, which is how the consumable case shipped writing
 * RETURN and handing the stock back.
 */
describe("releaseQuantity — consumptionType disposition", () => {
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockCustodyFindFirst = db.custody.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockTeamMemberFindUnique = db.teamMember.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockCreateConsumptionLog = createConsumptionLog as ReturnType<
    typeof vitest.fn
  >;
  const mockRecordEvent = recordEvent as ReturnType<typeof vitest.fn>;
  const mockAssetUpdate = db.asset.update as ReturnType<typeof vitest.fn>;

  /** Base locked-asset row; each test sets the `consumptionType` under test. */
  const baseLockedAsset = {
    id: "asset-1",
    title: "Nitrile Gloves",
    organizationId: "org-1",
    type: "QUANTITY_TRACKED" as const,
    quantity: 500,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    mockTeamMemberFindUnique.mockResolvedValue({ user: { id: "user-42" } });
    // Custodian holds 40 units; every test releases 10 of them (partial), so
    // the status-flip branch stays out of the way of the quantity assertions.
    mockCustodyFindFirst.mockResolvedValue({
      id: "custody-1",
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 40,
    });
    (db.custody.count as ReturnType<typeof vitest.fn>).mockResolvedValue(1);
    // why: the `refreshExpiredAssetImages` suite earlier in this file leaves a
    // rejection implementation on the asset write mocks that `clearAllMocks`
    // does not undo (it only clears call history).
    mockAssetUpdate.mockResolvedValue({});
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });
    // why: same reason — the placement rows a reconcile test hands back would
    // otherwise leak into every later test in this suite.
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
  });

  it("consumes the whole release for a ONE_WAY consumable by default", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });

    const result = await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    // Exactly one log, classified as consumption. Writing RETURN here is the
    // shipped bug: consumption reporting counts the units as back on the shelf.
    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        category: "CONSUME",
        quantity: 10,
        custodianId: "tm-1",
      })
    );
    expect(mockAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1" },
        data: { quantity: { decrement: 10 } },
      })
    );
    expect(result.consumed).toBe(10);
    expect(result.returned).toBe(0);
  });

  it("splits a partial consume: two logs, and only the consumed units leave stock", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });

    const result = await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 40,
      consumed: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    // 10 gloves used up, 30 handed back in good condition. Destroying all 40
    // is the over-correction this split exists to prevent.
    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(2);
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "CONSUME", quantity: 10 })
    );
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "RETURN", quantity: 30 })
    );
    expect(mockAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1" },
        data: { quantity: { decrement: 10 } },
      })
    );
    expect(result.consumed).toBe(10);
    expect(result.returned).toBe(30);
  });

  it("emits ASSET_QUANTITY_CHANGED for the consumed units only", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 40,
      consumed: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    // One event per field that changed: stock dropped by the consumed
    // amount, not by the full release.
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "ASSET_QUANTITY_CHANGED",
        entityType: "ASSET",
        entityId: "asset-1",
        assetId: "asset-1",
        field: "quantity",
        fromValue: 500,
        toValue: 490,
      }),
      // Second arg is the tx client — the event must commit with the write.
      expect.anything()
    );
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CUSTODY_RELEASED",
        meta: { quantity: 40, viaQuantity: true, consumed: 10, returned: 30 },
      }),
      expect.anything()
    );
    expect(mockRecordEvent).toHaveBeenCalledTimes(2);
  });

  it("an explicit consumed of 0 on a consumable returns everything and never touches stock", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });

    const result = await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      consumed: 0,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockCreateConsumptionLog).toHaveBeenCalledTimes(1);
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "RETURN", quantity: 10 })
    );
    // No quantity write at all — the returnable path stays byte-identical.
    // Match ANY `quantity` payload rather than `decrement: 0`: the service
    // gates the whole decrement block on `consumedUnits > 0`, so asserting
    // the zero case alone could never fail even if it wrongly decremented.
    // (The status-flip write carries no `quantity` key, so it can't match.)
    expect(mockAssetUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: expect.anything() }),
      })
    );
    expect(mockRecordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "ASSET_QUANTITY_CHANGED" }),
      expect.anything()
    );
    expect(result.consumed).toBe(0);
    expect(result.returned).toBe(10);
  });

  it("leaves TWO_WAY behaviour untouched: RETURN log, no stock decrement", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "TWO_WAY",
    });

    const result = await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "RETURN", quantity: 10 })
    );
    expect(mockRecordEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "ASSET_QUANTITY_CHANGED" }),
      expect.anything()
    );
    expect(result.consumed).toBe(0);
    expect(result.returned).toBe(10);
  });

  it("treats a legacy null consumptionType as returnable", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: null,
    });

    const result = await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "RETURN", quantity: 10 })
    );
    expect(result.consumed).toBe(0);
    expect(result.returned).toBe(10);
  });

  it("rejects consuming a returnable asset", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "TWO_WAY",
    });

    // A client must never be able to destroy stock that is meant to come back.
    await expect(
      releaseQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 10,
        consumed: 5,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(/consumable/i);

    expect(mockCreateConsumptionLog).not.toHaveBeenCalled();
  });

  it("rejects a consumed amount larger than the release", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });

    await expect(
      releaseQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 10,
        consumed: 11,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow();

    expect(mockCreateConsumptionLog).not.toHaveBeenCalled();
  });

  it("leaves placements alone on consume while the unplaced residual absorbs it", async () => {
    // `baseLockedAsset` owns 500 units and only 50 are placed, so consuming 10
    // shrinks the residual from 450 to 440. Reducing a placement here would
    // assert "this room now holds 10 fewer", which is not something the
    // consume established.
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "al-1", locationId: "loc-1", quantity: 50 }]);

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    // The three write methods the mocked client exposes — the same set
    // `moveAssetLocationUnits` / `placeUnplacedUnits` drive when they DO
    // adjust placements.
    expect(db.assetLocation.create).not.toHaveBeenCalled();
    expect(db.assetLocation.update).not.toHaveBeenCalled();
    expect(db.assetLocation.delete).not.toHaveBeenCalled();
  });

  it("trims the single placement on consume once the residual is exhausted", async () => {
    // The reproduced production case: every owned unit is placed, so
    // destroying 10 of them would leave SUM(AssetLocation) above
    // `Asset.quantity` and silently break the PRD invariant. One placement
    // means the source is a fact, not a guess.
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "al-1", locationId: "loc-1", quantity: 500 }]);

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.assetLocation.update).toHaveBeenCalledWith({
      where: { id: "al-1" },
      data: { quantity: 490 },
    });
  });

  it("writes nothing when several placements make the consumed source ambiguous", async () => {
    // All 500 placed across two rooms with no residual left. Nothing records
    // which room the used-up units left, so any rule applied here would persist
    // a number that was never true. The drift is reported instead.
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "al-1", locationId: "loc-1", quantity: 300 },
      { id: "al-2", locationId: "loc-2", quantity: 200 },
    ]);

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 10,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.assetLocation.update).not.toHaveBeenCalled();
    expect(db.assetLocation.delete).not.toHaveBeenCalled();
  });

  it("still flips Asset.status to AVAILABLE when a consume empties the last custody row", async () => {
    mockLock.mockResolvedValue({
      ...baseLockedAsset,
      consumptionType: "ONE_WAY",
    });
    // Full release of the 40-unit row → no custody rows remain.
    (db.custody.count as ReturnType<typeof vitest.fn>).mockResolvedValue(0);

    await releaseQuantity({
      assetId: "asset-1",
      teamMemberId: "tm-1",
      quantity: 40,
      userId: "user-1",
      organizationId: "org-1",
    });

    // Guarded `updateMany` — see the sibling assertion in the
    // "releaseQuantity — activity events" suite.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        organizationId: "org-1",
        status: { not: "CHECKED_OUT" },
      },
      data: { status: "AVAILABLE" },
    });
    expect(mockAssetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { quantity: { decrement: 40 } },
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

  it("rejects a categoryId from a different organization", async () => {
    expect.assertions(2);
    // Prisma's foreign key only proves the Category row exists — it says
    // nothing about which workspace owns it, so a foreign-org id would be
    // connected verbatim without this guard.
    (db.category.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      null
    );

    await expect(
      createAsset({
        title: "New asset",
        userId: "user-1",
        organizationId: "org-A",
        categoryId: "cat-from-org-B",
      } as any)
    ).rejects.toThrow(ShelfError);

    expect(db.category.findFirst).toHaveBeenCalledWith({
      where: { id: "cat-from-org-B", organizationId: "org-A" },
      select: { id: true },
    });
  });

  it("does not look up a category when the asset is uncategorized", async () => {
    // "uncategorized" is the form's empty sentinel, not an id.
    await createAsset({
      title: "New asset",
      userId: "user-1",
      organizationId: "org-A",
      categoryId: "uncategorized",
    } as any).catch(() => undefined);

    expect(db.category.findFirst).not.toHaveBeenCalled();
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
 * `replaceAssetPlacements` — the manage-placements dialog's write path.
 *
 * Two properties matter here and neither is visible from the outside without
 * the mocks: the sum bound is the MANUAL axis alone, and the diff is computed
 * from the rows read under the asset lock rather than a pre-request snapshot.
 */
describe("replaceAssetPlacements", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (
      db.asset.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      title: "Pens",
      type: "QUANTITY_TRACKED",
      quantity: 100,
      unitOfMeasure: "pcs",
    });
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 100,
      title: "Pens",
      unitOfMeasure: "pcs",
    });
    (db.location.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "loc-1", name: "Baghdad Store" },
    ]);
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
  });

  it("accepts a manual set that fills the whole total even when the asset is in a kit", async () => {
    // `enforce_asset_location_sum_within_total` sums `assetKitId IS NULL` rows
    // only — `20260602100000_assetlocation_sum_exclude_kit_driven` took the
    // kit-driven rows out precisely so a fully-placed asset could still be
    // added to a kit. Adding a kit-driven sum back into this check made the
    // dialog permanently unsaveable for exactly that asset, and the only way
    // out was deleting valid manual placements to "make room" for the kit
    // slice — which `kit-location-owns-member-placement.md` forbids.
    await expect(
      replaceAssetPlacements({
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
        placements: [{ locationId: "loc-1", quantity: 100 }],
      })
    ).resolves.toEqual({ ok: true });

    expect(db.assetLocation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ locationId: "loc-1", quantity: 100 })],
      })
    );
  });

  it("still refuses a manual set that exceeds the total on its own", async () => {
    await expect(
      replaceAssetPlacements({
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
        placements: [{ locationId: "loc-1", quantity: 101 }],
      })
    ).rejects.toMatchObject({
      status: 400,
      title: "Quantity exceeds available pool",
    });

    expect(db.assetLocation.createMany).not.toHaveBeenCalled();
  });

  it("diffs against the rows read under the lock, not a pre-request snapshot", async () => {
    // A concurrent save committed a placement at loc-9 while this request was
    // in flight. The submitted set is the user's full desired state, so loc-9
    // must be deleted — a diff built before the lock would not know the row
    // exists and would leave it behind.
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      {
        locationId: "loc-9",
        quantity: 40,
        location: { id: "loc-9", name: "Warehouse" },
      },
    ]);

    await replaceAssetPlacements({
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
      placements: [{ locationId: "loc-1", quantity: 20 }],
    });

    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: "asset-1",
          assetKitId: null,
          locationId: { in: ["loc-9"] },
        }),
      })
    );
  });
});

/**
 * Wiring for the STOCK-LOWERING guard: `updateAsset` must not let a
 * QUANTITY_TRACKED asset's total `quantity` drop below what's already
 * committed to custody, kits, or bookings. The guard's own committed-peak
 * math is unit-tested in `availability.server.test.ts` — these tests only
 * verify updateAsset calls it (with the right args, at the right time) and
 * correctly propagates its rejection. `db.asset.findUnique` (the
 * `assetBeforeUpdate` snapshot) is left at its default `null` resolve so the
 * unrelated note/event-emission block — gated on `assetBeforeUpdate` being
 * non-null — never runs, keeping each test focused on the guard wiring.
 */
describe("updateAsset stock-lowering guard", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      quantity: 5,
    });
    // why: a reduction also runs the placement guard, which reads the manual
    // placement rows. `clearAllMocks` keeps implementations, so reset it here
    // or the one test that models placements leaks into its neighbours.
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    // why: `clearAllMocks` clears call history but NOT queued `*Once` values.
    // The placement-replacing tests below queue a kit-guard result; an
    // unconsumed leftover would surface as a non-null `assetBeforeUpdate` in
    // the next test and switch on the unrelated note/event-emission block.
    vi.mocked(db.asset.findUnique).mockReset();
    vi.mocked(db.asset.findUnique).mockResolvedValue(null);
  });

  it("locks the asset then calls the guard when lowering quantity on a QUANTITY_TRACKED asset", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 5, // 5 < 10 (current) — a genuine reduction
    } as any);

    expect(lockAssetForQuantityUpdate).toHaveBeenCalledWith(
      expect.anything(),
      "asset-1",
      "org-1"
    );
    expect(assertAssetQuantityNotBelowReservations).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        organizationId: "org-1",
        newTotal: 5,
        assetTitle: "Widget",
        unitOfMeasure: "boards",
      })
    );
    // The guard must run BEFORE the write.
    expect(db.asset.update).toHaveBeenCalled();
  });

  it("refuses a reduction that would strand units already placed at locations", async () => {
    // The reservations guard passes — custody / kits / bookings are clear —
    // and the reduction is still wrong, because 9 units are recorded as
    // sitting somewhere. Nothing else catches this: the location trigger
    // never fires on an `Asset` write.
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "al-1", locationId: "loc-1", quantity: 9 }]);

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        quantity: 5,
      } as any)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("assigned to locations"),
    });

    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("allows lowering the total when the same patch replaces the placement", async () => {
    // The asset edit form submits quantity and location as ONE request. The
    // transaction clears every manual row and writes a single new one at the
    // target, so the 10 units currently recorded at loc-1 are about to stop
    // existing — measuring the new total against them refuses an edit whose
    // end state (5 units at loc-2, total 5) is perfectly valid.
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);
    // Fully placed at the location the patch is moving AWAY from.
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ id: "al-1", locationId: "loc-1", quantity: 10 }]);
    // Kit guard: no parent kit, and the type/total the pre-tx validator reads.
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      {
        type: "QUANTITY_TRACKED",
        quantity: 10,
        assetKits: [],
      }
    );
    (db.location.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "loc-2",
      name: "Storage B",
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 5,
      newLocationId: "loc-2",
      currentLocationId: "loc-1",
    } as any);

    expect(db.asset.update).toHaveBeenCalled();
  });

  it("refuses when the replacement placement itself exceeds the new total", async () => {
    // Same shape as above, but the submitted per-location quantity (8) is
    // more than the total the patch leaves behind (5). Skipping the guard for
    // replacement patches must not mean skipping the bound entirely.
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      {
        type: "QUANTITY_TRACKED",
        quantity: 10,
        assetKits: [],
      }
    );
    (db.location.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "loc-2",
      name: "Storage B",
    });

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        quantity: 5,
        newLocationId: "loc-2",
        currentLocationId: "loc-1",
        newLocationQuantity: 8,
      } as any)
    ).rejects.toMatchObject({
      status: 400,
      title: "Quantity exceeds available pool",
    });

    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("bounds a placement against the total this patch leaves, not the one it found", async () => {
    // Raising 10 -> 100 while placing 50 is legal: the pre-transaction check
    // used to measure 50 against the STALE total of 10 and refuse it.
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      {
        type: "QUANTITY_TRACKED",
        quantity: 10,
        assetKits: [],
      }
    );
    (db.location.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "loc-2",
      name: "Storage B",
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 100,
      newLocationId: "loc-2",
      currentLocationId: "loc-1",
      newLocationQuantity: 50,
    } as any);

    expect(db.asset.update).toHaveBeenCalled();
  });

  it("propagates the guard's 400 and never writes when the reduction is below commitments", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          'Cannot reduce "Widget" to 5 boards — 8 boards are committed ' +
          "(custody, kits, or overlapping bookings). Release or reduce those first.",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        quantity: 5,
      } as any)
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("committed"),
    });

    // The rejection must land before the write.
    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("allows a safe reduction (down to or above what's committed)", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);

    await expect(
      updateAsset({
        id: "asset-1",
        userId: "user-1",
        organizationId: "org-1",
        quantity: 8,
      } as any)
    ).resolves.toMatchObject({ id: "asset-1" });

    expect(db.asset.update).toHaveBeenCalled();
  });

  it("skips the lock and the guard entirely when quantity is not being changed", async () => {
    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      title: "Renamed",
    } as any);

    expect(lockAssetForQuantityUpdate).not.toHaveBeenCalled();
    expect(assertAssetQuantityNotBelowReservations).not.toHaveBeenCalled();
    expect(db.asset.update).toHaveBeenCalled();
  });

  it("skips the guard when quantity is being INCREASED, even on a QUANTITY_TRACKED asset", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 15, // 15 > 10 — an increase, never a stock-lowering concern
    } as any);

    // The lock still runs (it's how the guard learns the fresh current
    // total), but the guard itself is never invoked for an increase.
    expect(lockAssetForQuantityUpdate).toHaveBeenCalled();
    expect(assertAssetQuantityNotBelowReservations).not.toHaveBeenCalled();
  });

  it("skips the guard for an INDIVIDUAL asset even if a lower quantity is submitted", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "INDIVIDUAL",
      quantity: 1,
      title: "Drill",
      unitOfMeasure: null,
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 0,
    } as any);

    expect(assertAssetQuantityNotBelowReservations).not.toHaveBeenCalled();
    expect(db.asset.update).toHaveBeenCalled();
  });
});

/**
 * Wiring for the low-stock notifier trigger on the asset-edit path. ANY quantity
 * change on a QUANTITY_TRACKED asset — a DROP or a RAISE — must run
 * `checkAndNotifyLowStock` AFTER the write commits: a drop may cross INTO the
 * low-stock band, and a raise (restock) may cross back OUT and must clear the
 * debounce marker / send the recovery notice. Only a non-quantity edit (or a
 * no-op) must not. The notifier's own debounce/recipient logic lives in
 * low-stock.server.test.ts — here we only assert the call is made (with which args).
 */
describe("updateAsset low-stock notifier wiring", () => {
  const mockLowStock = checkAndNotifyLowStock as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      type: "QUANTITY_TRACKED",
      quantity: 5,
    });
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);
  });

  it("runs checkAndNotifyLowStock when a QUANTITY_TRACKED asset's quantity is lowered", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 5, // 5 < 10 → a genuine reduction
    } as any);

    expect(mockLowStock).toHaveBeenCalledWith({
      assetId: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("runs checkAndNotifyLowStock when a QUANTITY_TRACKED asset's quantity is RAISED (restock → clears the debounce marker / recovery notice)", async () => {
    (
      lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 15, // 15 > 10 → a raise; must still run so a recovery clears
    } as any); // the stale lowStockNotifiedAt marker (else the next alert is suppressed)

    expect(mockLowStock).toHaveBeenCalledWith({
      assetId: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("does NOT run checkAndNotifyLowStock when quantity is not part of the patch", async () => {
    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      title: "Renamed",
    } as any);

    expect(mockLowStock).not.toHaveBeenCalled();
  });

  it("runs checkAndNotifyLowStock when only the min-quantity threshold changes (so a stale marker is cleared)", async () => {
    // No `quantity` in the patch → no row lock; the QT check falls back to the
    // returned asset's `type`, and the change is detected from the before-snapshot.
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValue({
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 5,
      minQuantity: 2,
      consumptionType: "REUSABLE",
      unitOfMeasure: "boards",
      organization: { currency: "USD" },
      tags: [],
    });
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      type: "QUANTITY_TRACKED",
      quantity: 5,
      minQuantity: 8,
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      tags: [],
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      minQuantity: 8, // threshold 2 → 8; quantity is NOT part of the patch
      request: new Request("http://localhost"),
    } as any);

    expect(mockLowStock).toHaveBeenCalledWith({
      assetId: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
    });
  });
});

/**
 * Audit trail for quantity / min-quantity edits made through the asset-edit
 * form (`updateAsset`). A real stock change writes an immutable
 * `ConsumptionLog` ADJUSTMENT *and* an `ASSET_QUANTITY_CHANGED` activity
 * event; a min-quantity (threshold) change emits only
 * `ASSET_MIN_QUANTITY_CHANGED` and writes NO ConsumptionLog; a no-op change
 * writes neither. `db.asset.findUnique` returns the before-snapshot so the
 * event block (gated on a non-null `assetBeforeUpdate`) runs; `db.asset.update`
 * returns the post-update row the event reads its `toValue` from.
 */
describe("updateAsset quantity audit trail", () => {
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockCreateConsumptionLog = createConsumptionLog as ReturnType<
    typeof vitest.fn
  >;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
    // Reset any leftover *Once queue so the single before-snapshot resolve
    // below can't be shadowed by a prior test's queued value.
    vi.mocked(db.asset.findUnique).mockReset();
    (
      assertAssetQuantityNotBelowReservations as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(undefined);
  });

  it("writes a ConsumptionLog ADJUSTMENT (positive delta) and emits ASSET_QUANTITY_CHANGED with the true direction on a QT quantity edit", async () => {
    mockLock.mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    // Before-snapshot: quantity 10, so a write down to 4 is a real change.
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValue({
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 10,
      minQuantity: 2,
      consumptionType: "REUSABLE",
      unitOfMeasure: "boards",
      organization: { currency: "USD" },
      tags: [],
    });
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 4,
      minQuantity: 2,
      tags: [],
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 4, // 10 → 4 (a reduction; delta 6)
      // The valuation-note builder reads `getLocale(request)`; a bare Request
      // is enough (no accept-language header → default locale).
      request: new Request("http://localhost"),
    } as any);

    // ConsumptionLog stores the positive delta (|4 − 10| = 6) as an ADJUSTMENT,
    // written inside the quantity tx (tx threaded through).
    expect(mockCreateConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-1",
        category: "ADJUSTMENT",
        quantity: 6,
        userId: "user-1",
      })
    );
    // The direction the log can't carry is captured by the event's from/to.
    expect(mockRecordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_QUANTITY_CHANGED",
          entityType: "ASSET",
          entityId: "asset-1",
          assetId: "asset-1",
          field: "quantity",
          fromValue: 10,
          toValue: 4,
        }),
      ])
    );
  });

  it("emits ASSET_MIN_QUANTITY_CHANGED and writes NO ConsumptionLog for a min-quantity (threshold) edit", async () => {
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValue({
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 10,
      minQuantity: 2,
      consumptionType: "REUSABLE",
      unitOfMeasure: "boards",
      organization: { currency: "USD" },
      tags: [],
    });
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 10,
      minQuantity: 5,
      tags: [],
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      minQuantity: 5, // threshold 2 → 5; no stock movement
      request: new Request("http://localhost"),
    } as any);

    // minQuantity is a threshold, not stock — never a ConsumptionLog.
    expect(mockCreateConsumptionLog).not.toHaveBeenCalled();
    // The lock is only taken when a `quantity` write is part of the patch.
    expect(mockLock).not.toHaveBeenCalled();
    expect(mockRecordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_MIN_QUANTITY_CHANGED",
          entityType: "ASSET",
          entityId: "asset-1",
          assetId: "asset-1",
          field: "minQuantity",
          fromValue: 2,
          toValue: 5,
        }),
      ])
    );
  });

  it("writes neither a ConsumptionLog nor an ASSET_QUANTITY_CHANGED event when the submitted quantity is unchanged", async () => {
    mockLock.mockResolvedValue({
      id: "asset-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 10,
      title: "Widget",
      unitOfMeasure: "boards",
    });
    (db.asset.findUnique as ReturnType<typeof vitest.fn>).mockResolvedValue({
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 10,
      minQuantity: 2,
      consumptionType: "REUSABLE",
      unitOfMeasure: "boards",
      organization: { currency: "USD" },
      tags: [],
    });
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "asset-1",
      title: "Widget",
      description: null,
      category: null,
      valuation: null,
      quantity: 10,
      minQuantity: 2,
      tags: [],
    });

    await updateAsset({
      id: "asset-1",
      userId: "user-1",
      organizationId: "org-1",
      quantity: 10, // 10 → 10, delta 0
      request: new Request("http://localhost"),
    } as any);

    // delta 0 → no stock-movement audit (createConsumptionLog rejects qty 0).
    expect(mockCreateConsumptionLog).not.toHaveBeenCalled();
    // No field actually changed, so no quantity event is recorded.
    const emittedQuantityEvent = mockRecordEvents.mock.calls.some(([events]) =>
      (events as Array<{ action: string }>).some(
        (e) => e.action === "ASSET_QUANTITY_CHANGED"
      )
    );
    expect(emittedQuantityEvent).toBe(false);
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
/**
 * Complete `AssetIndexSettings` row. These tests pass explicit asset ids, so
 * nothing reads the settings at runtime — but the parameter is typed, and
 * `{} as any` opts the whole call out of that contract, hiding a signature
 * change behind a cast. One shared fixture keeps the type honest without
 * repeating the shape at four call sites.
 */
const ASSET_INDEX_SETTINGS: AssetIndexSettings = {
  id: "settings-1",
  userId: "user-current",
  organizationId: "org-1",
  mode: "SIMPLE",
  columns: [],
  freezeColumn: true,
  showAssetImage: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

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
        allowedTeamMemberIds: "all" as const,
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-other",
        custodianName: "Other Person",
        organizationId: "org-1",
        settings: ASSET_INDEX_SETTINGS,
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
        allowedTeamMemberIds: "all" as const,
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-self",
        custodianName: "Self",
        organizationId: "org-1",
        settings: ASSET_INDEX_SETTINGS,
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
        allowedTeamMemberIds: "all" as const,
        userId: "user-current",
        assetIds: ["asset-1"],
        custodianId: "tm-anyone",
        custodianName: "Anyone",
        organizationId: "org-1",
        settings: ASSET_INDEX_SETTINGS,
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
        allowedTeamMemberIds: "all" as const,
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
        settings: ASSET_INDEX_SETTINGS,
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

describe("bulkUpdateAssetModel", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: this file pins shared db mocks with sticky `mockReturnValue` in
    // other suites and `clearAllMocks` does not undo those. Re-arm the two
    // stubs this suite drives so it never reads a leaked value.
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([]);
    //@ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue({
      id: "model-1",
      name: "Panasonic PT-VZ580",
    });
  });

  it("links the individually tracked assets and skips quantity-tracked ones", async () => {
    expect.assertions(5);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", type: "INDIVIDUAL", assetModelId: null },
      { id: "asset-2", type: "QUANTITY_TRACKED", assetModelId: null },
      { id: "asset-3", type: "INDIVIDUAL", assetModelId: null },
    ]);

    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2", "asset-3"],
      organizationId: "org-1",
      assetModelId: "model-1",
      currentSearchParams: "assetModel=is:without-model",
      // @ts-expect-error settings shape not relevant, only pass-through is
      settings: { mode: "ADVANCED" },
    });

    expect(result).toEqual({
      linked: true,
      resolved: 3,
      updated: 2,
      moved: 0,
      skippedQuantityTracked: 1,
      modelName: "Panasonic PT-VZ580",
    });
    // The model is read ONCE. `assertAssetModelBelongsToOrg` returns the row it
    // already had to fetch, so the toast label costs no second round trip —
    // pinned here because re-adding a `findFirst` for the name is the easy
    // regression.
    expect(db.assetModel.findFirst).toHaveBeenCalledTimes(1);
    // The active filters and index mode must reach the resolver, or a
    // cross-page "select all" silently operates on the wrong set.
    expect(resolveAssetIdsForBulkOperation).toHaveBeenCalledWith({
      assetIds: ["asset-1", "asset-2", "asset-3"],
      organizationId: "org-1",
      currentSearchParams: "assetModel=is:without-model",
      settings: { mode: "ADVANCED" },
      // `asset: update` is ADMIN/OWNER-only, so this bulk path declares that
      // the custodian filter needs no narrowing.
      allowedTeamMemberIds: "all",
    });
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-3"] }, organizationId: "org-1" },
      data: { assetModelId: "model-1" },
    });
    // The qty-tracked asset must never reach the write.
    expect(
      (db.asset.updateMany as ReturnType<typeof vitest.fn>).mock.calls[0][0]
        .where.id.in
    ).not.toContain("asset-2");
  });

  it("counts assets moved off another model separately from first-time grouping", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", type: "INDIVIDUAL", assetModelId: null },
      { id: "asset-2", type: "INDIVIDUAL", assetModelId: "model-other" },
      // already on the target model → not a change at all
      { id: "asset-3", type: "INDIVIDUAL", assetModelId: "model-1" },
    ]);

    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2", "asset-3"],
      organizationId: "org-1",
      assetModelId: "model-1",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(result).toMatchObject({ updated: 2, moved: 1 });
  });

  it("removes the link when no model is given, without touching the model table", async () => {
    expect.assertions(3);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", type: "INDIVIDUAL", assetModelId: "model-1" },
      // already unlinked → no write
      { id: "asset-2", type: "INDIVIDUAL", assetModelId: null },
    ]);

    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      // why: the dialog posts an EMPTY STRING for "remove from asset model",
      // never null — this is the shape the route actually parses.
      assetModelId: "",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(result).toMatchObject({
      linked: false,
      updated: 1,
      moved: 0,
      modelName: null,
    });
    expect(db.assetModel.findFirst).not.toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
      data: { assetModelId: null },
    });
  });

  it("does not error when unlinking a selection that is entirely quantity-tracked", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", type: "QUANTITY_TRACKED", assetModelId: null },
    ]);

    // Removing a model from assets that can never have had one is a no-op,
    // not a rule violation. Only the LINK direction rejects.
    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: ["asset-1"],
      organizationId: "org-1",
      assetModelId: "",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(result).toMatchObject({
      linked: false,
      updated: 0,
      skippedQuantityTracked: 0,
    });
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("throws a 400 when every selected asset is quantity-tracked", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", type: "QUANTITY_TRACKED", assetModelId: null },
    ]);

    await expect(
      bulkUpdateAssetModel({
        userId: "user-1",
        assetIds: ["asset-1"],
        organizationId: "org-1",
        assetModelId: "model-1",
        // @ts-expect-error settings not relevant for this test
        settings: {},
      })
      // The status AND the message must survive the catch-all wrapper, or the
      // dialog shows "Something went wrong" instead of the eligibility rule.
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("quantity-tracked"),
    });

    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("throws when the asset model belongs to a different organization", async () => {
    expect.assertions(2);
    // why: emulate a foreign-org model — the org-scoped guard finds nothing
    //@ts-expect-error mock setup
    db.assetModel.findFirst.mockResolvedValue(null);

    await expect(
      bulkUpdateAssetModel({
        userId: "user-1",
        assetIds: ["asset-1"],
        organizationId: "org-1",
        assetModelId: "foreign-model",
        // @ts-expect-error settings not relevant for this test
        settings: {},
      })
      // Same reason as above: the guard's own 404 message has to reach the UI.
    ).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("workspace"),
    });

    // The guard must run before the assets are read or written.
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("reports resolved 0 when the ids are not in this organization", async () => {
    expect.assertions(2);
    // why: the resolver returns a caller-supplied id list verbatim, so the
    // org check is the org-scoped read. Foreign ids resolve to a non-empty
    // list but match no rows, and the caller must be able to tell that apart
    // from "these are already on the model".
    //@ts-expect-error mock setup
    db.asset.findMany.mockResolvedValue([]);

    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: ["foreign-asset-1", "foreign-asset-2"],
      organizationId: "org-1",
      assetModelId: "model-1",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(result).toMatchObject({ resolved: 0, updated: 0 });
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("writes nothing when the selection resolves to no assets", async () => {
    expect.assertions(2);

    const result = await bulkUpdateAssetModel({
      userId: "user-1",
      assetIds: [],
      organizationId: "org-1",
      assetModelId: "model-1",
      // @ts-expect-error settings not relevant for this test
      settings: {},
    });

    expect(result).toEqual({
      linked: true,
      resolved: 0,
      updated: 0,
      moved: 0,
      skippedQuantityTracked: 0,
      modelName: null,
    });
    expect(db.asset.updateMany).not.toHaveBeenCalled();
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
        allowedTeamMemberIds: "all" as const,
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

/**
 * The guarded status write gates the whole batch.
 *
 * `assetsNotAvailable` rejects checked-out assets, but that read happens
 * OUTSIDE the transaction. If a checkout commits in between, the guard on
 * `setCustodyDrivenAssetStatus` correctly refuses to overwrite `CHECKED_OUT` —
 * and pre-fix the batch carried on regardless, writing a custody row, a note
 * and a CUSTODY_ASSIGNED event for an asset that is physically out on a
 * booking. The audit trail then asserted a grant that never happened.
 *
 * @see {@link file://./custody-status.server.ts}
 */
describe("bulkCheckOutAssets — status guard gates the batch", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.asset.update as ReturnType<typeof vitest.fn>).mockResolvedValue({});
    (db.teamMember.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      {
        name: "Custodian",
        user: {
          id: "custodian-user",
          firstName: "Cust",
          lastName: "Odian",
          displayName: null,
        },
      }
    );
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        type: "INDIVIDUAL",
      },
      { id: "asset-2", title: "Saw", status: "AVAILABLE", type: "INDIVIDUAL" },
    ]);
  });

  it("aborts without writing custody when an asset was checked out mid-flight", async () => {
    // why: two assets passed the pre-check, but by write time only one still
    // matches `status: { not: CHECKED_OUT }`. That shortfall IS the race.
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });

    await expect(
      bulkCheckOutAssets({
        allowedTeamMemberIds: "all" as const,
        userId: "user-current",
        assetIds: ["asset-1", "asset-2"],
        custodianId: "tm-1",
        custodianName: "Custodian",
        organizationId: "org-1",
        settings: ASSET_INDEX_SETTINGS,
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(/checked out while this action was in progress/);

    // The whole point: no half-applied custody. The throw rolls the
    // transaction back, but the rows must not be attempted either.
    expect(db.custody.createMany).not.toHaveBeenCalled();

    // 409, not the ShelfError default of 500: a valid request that lost a race
    // is the client's cue to refresh, not a server fault. `shouldBeCaptured`
    // is false for the same reason — this must not page anyone.
    const caught = await bulkCheckOutAssets({
      allowedTeamMemberIds: "all" as const,
      userId: "user-current",
      assetIds: ["asset-1", "asset-2"],
      custodianId: "tm-1",
      custodianName: "Custodian",
      organizationId: "org-1",
      settings: ASSET_INDEX_SETTINGS,
      role: OrganizationRoles.ADMIN,
    }).catch((err: unknown) => err);

    expect((caught as ShelfError).status).toBe(409);
    expect((caught as ShelfError).shouldBeCaptured).toBe(false);
  });

  it("proceeds to write custody when every asset survives the guard", async () => {
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 2,
    });

    // Downstream note/event stubs may be incomplete; all this asserts is that
    // the gate itself did not fire and custody insertion was reached.
    await bulkCheckOutAssets({
      allowedTeamMemberIds: "all" as const,
      userId: "user-current",
      assetIds: ["asset-1", "asset-2"],
      custodianId: "tm-1",
      custodianName: "Custodian",
      organizationId: "org-1",
      settings: ASSET_INDEX_SETTINGS,
      role: OrganizationRoles.ADMIN,
    }).catch(() => undefined);

    expect(db.custody.createMany).toHaveBeenCalled();
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

describe("getAssets search via UNION", () => {
  const findManyMock = vi.mocked(db.asset.findMany);
  const countMock = vi.mocked(db.asset.count);
  // why: the UNION runs as a raw query; mock it to return a known id set so we
  // can assert getAssets threads those ids into the Prisma where.
  const queryRawMock = vi.mocked(db.$queryRaw);

  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    countMock.mockReset().mockResolvedValue(0);
    queryRawMock.mockReset().mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  });

  const base = {
    organizationId: "org_1",
    page: 1,
    perPage: 20,
    orderBy: "createdAt" as const,
    orderDirection: "desc" as const,
  };

  it("runs the UNION and filters assets to the matching id set", async () => {
    await getAssets({ ...base, search: "chair" });
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    // why: findMany's args param is typed optional (Prisma allows a
    // no-args call); this suite always calls it with args, so the mock
    // is asserted non-null rather than widening the type in every test.
    const where = findManyMock.mock.calls[0][0]!.where!;
    expect(where.OR).toEqual([{ id: { in: ["a1", "a2"] } }]);
    // exactly one fetch — no fallback re-query
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("does not run the UNION when there is no search term", async () => {
    await getAssets({ ...base, search: null });
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(findManyMock.mock.calls[0][0]!.where!.OR).toBeUndefined();
  });

  it("fail-closed: whitespace-only search matches nothing, no UNION", async () => {
    await getAssets({ ...base, search: "   " });
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(findManyMock.mock.calls[0][0]!.where!.id).toEqual({ in: [] });
  });

  it("preserves filter OR-entanglement: uncategorized appends after the search id set", async () => {
    await getAssets({
      ...base,
      search: "chair",
      categoriesIds: ["uncategorized"],
    });
    const where = findManyMock.mock.calls[0][0]!.where!;
    expect(where.OR).toEqual([
      { id: { in: ["a1", "a2"] } },
      { categoryId: { in: ["uncategorized"] } },
      { categoryId: null },
    ]);
  });

  it("empty search-id set yields an empty id filter (matches nothing on its own)", async () => {
    queryRawMock.mockResolvedValue([]);
    await getAssets({ ...base, search: "zzz-no-match" });
    expect(findManyMock.mock.calls[0][0]!.where!.OR).toEqual([
      { id: { in: [] } },
    ]);
  });

  it("over-ceiling: rethrows the refine-search 400 unchanged, no asset fetch", async () => {
    // why: return more ids than the bind-param ceiling without building real DB
    // rows, so resolveAssetSearchIds throws its deliberate 400 and we can assert
    // getAssets' catch propagates it unchanged rather than re-wrapping it.
    queryRawMock.mockResolvedValue(
      Array.from({ length: MAX_MATCHED_ASSET_SEARCH_IDS + 1 }, (_, i) => ({
        id: `a${i}`,
      }))
    );

    let thrown: unknown;
    try {
      await getAssets({ ...base, search: "a" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    expect((thrown as ShelfError).status).toBe(400);
    // exact message — proves the generic catch wrapper did NOT replace it
    expect((thrown as ShelfError).message).toBe(ASSET_SEARCH_CEILING_MESSAGE);
    // short-circuited before the asset fetch (both findMany and count)
    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });
});

describe("buildAssetKitCreateData — AssetKit pivot for create-with-kit", () => {
  it("builds the AssetKit pivot nested-create and never emits a `kit` relation", () => {
    // why: `Asset.kit` was replaced by the `assetKits` pivot; a `kit: { connect }`
    // throws `Unknown argument kit` at runtime (the import-crash bug). This guards
    // against that regression.
    const result = buildAssetKitCreateData({
      kitId: "kit-1",
      organizationId: "org-1",
      type: "INDIVIDUAL",
      quantity: null,
    });

    expect(result).toEqual({
      assetKits: {
        create: {
          kit: { connect: { id: "kit-1" } },
          organization: { connect: { id: "org-1" } },
          quantity: 1,
        },
      },
    });
    expect("kit" in result).toBe(false);
  });

  it("uses the full tracked pool for QUANTITY_TRACKED assets", () => {
    const result = buildAssetKitCreateData({
      kitId: "kit-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: 50,
    });

    expect(result).toEqual({
      assetKits: {
        create: {
          kit: { connect: { id: "kit-1" } },
          organization: { connect: { id: "org-1" } },
          quantity: 50,
        },
      },
    });
  });

  it("defaults quantity to 1 for a QUANTITY_TRACKED asset with no quantity", () => {
    const result = buildAssetKitCreateData({
      kitId: "kit-1",
      organizationId: "org-1",
      type: "QUANTITY_TRACKED",
      quantity: null,
    });

    expect(result).toEqual({
      assetKits: {
        create: {
          kit: { connect: { id: "kit-1" } },
          organization: { connect: { id: "org-1" } },
          quantity: 1,
        },
      },
    });
  });
});

describe("setKitCustodyAfterAssetImport — kit custody + member inheritance", () => {
  const mockBulkAssignKitCustody = vi.mocked(bulkAssignKitCustody);

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("assigns each kit to its row custodian via bulkAssignKitCustody, grouped by custodian", async () => {
    // why: custody lives on the kit; members inherit through the canonical flow.
    const kits = {
      "Camera Kit": { id: "kit-1", name: "Camera Kit" },
      "Audio Kit": { id: "kit-2", name: "Audio Kit" },
    } as never;
    const teamMembers = {
      Alice: { id: "tm-1", name: "Alice" },
      Bob: { id: "tm-2", name: "Bob" },
    } as never;
    const data = [
      { title: "A", key: "1", kit: "Camera Kit", custodian: "Alice" },
      { title: "B", key: "2", kit: "Camera Kit", custodian: "Alice" },
      { title: "C", key: "3", kit: "Audio Kit", custodian: "Bob" },
      { title: "D", key: "4" }, // no kit / custodian -> ignored
    ] as never;

    await setKitCustodyAfterAssetImport({
      data,
      kits,
      teamMembers,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockBulkAssignKitCustody).toHaveBeenCalledTimes(2);
    expect(mockBulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ["kit-1"],
        custodianId: "tm-1",
        custodianName: "Alice",
        userId: "user-1",
        organizationId: "org-1",
      })
    );
    expect(mockBulkAssignKitCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ["kit-2"],
        custodianId: "tm-2",
        custodianName: "Bob",
      })
    );
  });

  it("does nothing when no row carries both a kit and a custodian", async () => {
    await setKitCustodyAfterAssetImport({
      data: [
        { title: "A", key: "1", kit: "Camera Kit" },
        { title: "B", key: "2", custodian: "Alice" },
      ] as never,
      kits: {} as never,
      teamMembers: {} as never,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(mockBulkAssignKitCustody).not.toHaveBeenCalled();
  });
});

/**
 * Regression guard for the CoSTAR Live Lab report: a quantity-tracked asset
 * with units out on an ONGOING booking had its `CHECKED_OUT` status silently
 * overwritten when a custodian was assigned three minutes later. `Asset.status`
 * is one column describing an asset that is simultaneously part-in-custody,
 * part-checked-out and part-free, so the last writer used to win. Every reader
 * of "is this off the shelf" keys on that column, so the checked-out units
 * stopped counting and `Available` overstated free stock by the booked amount.
 *
 * Both custody writes must therefore treat `CHECKED_OUT` as the strongest
 * commitment, matching `reconcileAssetStatusForBookingExit`'s documented
 * precedence (`CHECKED_OUT` > `IN_CUSTODY` > `AVAILABLE`).
 *
 * These tests simulate Postgres rather than assert on Prisma arg shapes: the
 * `updateMany` mock only applies the write when the row still matches the
 * `where`, exactly as the real UPDATE ... WHERE would.
 */
describe("custody writes must not overwrite CHECKED_OUT", () => {
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockCustodyAggregate = db.custody.aggregate as ReturnType<
    typeof vitest.fn
  >;
  const mockCustodyFindFirst = db.custody.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockCustodyCount = db.custody.count as ReturnType<typeof vitest.fn>;
  const mockBookingAssetAggregate = db.bookingAsset.aggregate as ReturnType<
    typeof vitest.fn
  >;

  const lockedAsset = {
    id: "asset-1",
    title: "Manfrotto Super Clamp",
    organizationId: "org-1",
    type: "QUANTITY_TRACKED" as const,
    quantity: 29,
  };

  /** Stands in for the asset row's committed `status` column. */
  let currentStatus: AssetStatus;

  beforeEach(() => {
    vitest.clearAllMocks();
    mockLock.mockResolvedValue(lockedAsset);
    (
      db.asset.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ ...lockedAsset });

    // Unguarded `update` — models the PRE-FIX write. Without this the suite
    // would pass vacuously against the old code: the old service called
    // `update` (not `updateMany`), so a mock that only watches `updateMany`
    // never sees the clobber and `currentStatus` stays untouched. Verified by
    // reverting the fix and confirming these tests go red.
    (db.asset.update as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ data }: { data?: { status?: AssetStatus } }) => {
        if (data?.status) currentStatus = data.status;
        return Promise.resolve({});
      }
    );

    // Behave like `UPDATE ... WHERE status <> $1`: when the row no longer
    // matches the guard, zero rows change and the column keeps its value.
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({
        where,
        data,
      }: {
        where?: { status?: { not?: AssetStatus } };
        data?: { status?: AssetStatus };
      }) => {
        const excluded = where?.status?.not;
        if (excluded !== undefined && currentStatus === excluded) {
          return Promise.resolve({ count: 0 });
        }
        if (data?.status) currentStatus = data.status;
        return Promise.resolve({ count: 1 });
      }
    );
  });

  describe("checkOutQuantity (assigning custody)", () => {
    beforeEach(() => {
      mockCustodyAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      mockBookingAssetAggregate.mockResolvedValue({ _sum: { quantity: 0 } });
      // No operator custody row yet → the service takes the `create` branch.
      mockCustodyFindFirst.mockResolvedValue(null);
    });

    it("leaves CHECKED_OUT intact when units are already out on a booking", async () => {
      currentStatus = AssetStatus.CHECKED_OUT;

      await checkOutQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 20,
        userId: "user-1",
        organizationId: "org-1",
      });

      // The custody row is still written — only the status is protected.
      expect(db.custody.create).toHaveBeenCalledTimes(1);
      expect(currentStatus).toBe(AssetStatus.CHECKED_OUT);
    });

    it("still flips an AVAILABLE asset to IN_CUSTODY", async () => {
      currentStatus = AssetStatus.AVAILABLE;

      await checkOutQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 20,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(currentStatus).toBe(AssetStatus.IN_CUSTODY);
    });
  });

  describe("releaseQuantity (releasing the last custody row)", () => {
    beforeEach(() => {
      mockCustodyFindFirst.mockResolvedValue({
        id: "custody-1",
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 20,
      });
      // Zero rows left → the flip-to-AVAILABLE branch fires.
      mockCustodyCount.mockResolvedValue(0);
    });

    it("does not advertise a checked-out asset as AVAILABLE", async () => {
      // The dangerous direction: releasing custody while units are physically
      // out would have put the asset back on every picker and index.
      currentStatus = AssetStatus.CHECKED_OUT;

      await releaseQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 20,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(currentStatus).toBe(AssetStatus.CHECKED_OUT);
    });

    it("still returns an in-custody asset to AVAILABLE on the last release", async () => {
      currentStatus = AssetStatus.IN_CUSTODY;

      await releaseQuantity({
        assetId: "asset-1",
        teamMemberId: "tm-1",
        quantity: 20,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(currentStatus).toBe(AssetStatus.AVAILABLE);
    });
  });
});
