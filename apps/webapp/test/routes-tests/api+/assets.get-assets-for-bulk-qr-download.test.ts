/**
 * Tests for `api+/assets.get-assets-for-bulk-qr-download`.
 *
 * The route returns the data for up to 1,500 vector QR labels in one request.
 * What it must not do is ask the database for each code separately: the codes
 * ride along on the single asset query, and an asset with none is skipped
 * rather than created. That is the property pinned here, because nothing about
 * the response shape would reveal a thousand round trips.
 *
 * @see {@link file://../../../app/routes/api+/assets.get-assets-for-bulk-qr-download.ts}
 * @see {@link file://../../../app/modules/asset/bulk-operations-helper.server.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const qrMocks = vi.hoisted(() => ({
  getQrByAssetId: vi.fn(),
  getQrByKitId: vi.fn(),
  createQr: vi.fn(),
}));

// why: the per-asset lookups and creates are exactly what this route must not
// make, so the assertion is that these are never reached.
vi.mock("~/modules/qr/service.server", () => qrMocks);

const bulkMocks = vi.hoisted(() => ({
  resolveAssetIdsForBulkOperation: vi.fn(),
}));

// why: the advanced-filter SQL has its own coverage in
// bulk-operations-helper.server.test.ts; here we pin that "select all"
// delegates to it rather than building a simple-mode where clause.
vi.mock("~/modules/asset/bulk-operations-helper.server", () => bulkMocks);

// why: reads the member's saved index settings from the database; only the
// mode matters here.
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi
    .fn()
    .mockResolvedValue({ mode: "ADVANCED", columns: [] }),
}));

// why: reads the member's format preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: authorization and the select-all filter have their own coverage; here
// they only need to resolve so the handler reaches the QR reads.
vi.mock("~/utils/roles.server", async () => {
  const { accessFor } = await import("@helpers/role-access");
  return {
    requirePermission: vi.fn().mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      access: accessFor(["ADMIN"]),
      // The loader reads these off the organization for the response, after the
      // QR work; omitting them makes the handler 500 on its last line while the
      // assertions below still pass.
      currentOrganization: {
        qrIdDisplayPreference: "qrId",
        showShelfBranding: true,
      },
    }),
  };
});
// why: the paid-feature gate and the branding tier lookup read subscription
// state from the database and Stripe; both have their own coverage.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/subscription.server")>()),
  assertUserCanExportAssets: vi.fn().mockResolvedValue(undefined),
  canHideShelfBranding: vi.fn().mockReturnValue(true),
}));
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn().mockResolvedValue({}),
}));
// why: the select-all path narrows a custodian filter through this, and it hits
// the database. The stand-in keeps the real contract for a member who sees all
// custody: it returns the requested ids, never the "all" sentinel.
vi.mock("~/modules/team-member/service.server", () => ({
  scopeCustodianFilterIds: vi.fn(
    async ({ teamMemberIds }: { teamMemberIds?: string[] | null }) =>
      teamMemberIds ?? []
  ),
}));

// why: the query COUNT is the assertion, so the delegates have to be
// observable — `asset.findMany` is the one read; `qr.*` and `$queryRaw` belong
// to per-asset lookups or the locked create, which must never be reached.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn() },
    qr: { findMany: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  },
}));

import { accessFor } from "@helpers/role-access";
import { db } from "~/database/db.server";
import {
  loader,
  MAX_BULK_QR_EXPORT,
} from "~/routes/api+/assets.get-assets-for-bulk-qr-download";
import { requirePermission } from "~/utils/roles.server";

const ASSET_COUNT = 20;
const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
  id: `asset-${index}`,
  title: `Asset ${index}`,
  sequentialId: `SAM-${index}`,
  preferredBarcodeId: null,
  qrCodes: [{ id: `qr-asset-${index}` }],
  barcodes: [],
}));

const runLoader = () =>
  loader({
    request: new Request(
      "http://localhost/api/assets/get-assets-for-bulk-qr-download?assetIds=" +
        assets.map((a) => a.id).join(",")
    ),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as LoaderFunctionArgs);

describe("bulk QR download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(assets);
  });

  it("reads every code through the one asset query, never one per asset", async () => {
    const response = (await runLoader()) as unknown as {
      data: { error?: unknown; assets: unknown[] };
    };

    // Assert success first: the counts below would also hold for a handler
    // that threw after the reads.
    expect(response.data.error).toBeFalsy();
    expect(response.data.assets).toHaveLength(ASSET_COUNT);
    expect(db.asset.findMany).toHaveBeenCalledTimes(1);
    expect(db.qr.findMany).not.toHaveBeenCalled();
    expect(qrMocks.getQrByAssetId).not.toHaveBeenCalled();
    expect(qrMocks.createQr).not.toHaveBeenCalled();
  });

  it("skips an asset that has no code instead of creating one", async () => {
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { ...assets[0], qrCodes: [] },
      ...assets.slice(1),
    ]);

    const response = (await runLoader()) as unknown as {
      data: { skippedAssetCount: number; labelsCsv: string };
    };

    expect(response.data.skippedAssetCount).toBe(1);
    // The skipped asset is absent from labels.csv too, so rows match images.
    expect(response.data.labelsCsv).not.toContain("Asset 0");
    expect(qrMocks.createQr).not.toHaveBeenCalled();
  });

  it("returns a labels.csv row per asset, in the same order as the images", async () => {
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        ...assets[0],
        category: { name: "Cameras" },
        assetLocations: [{ location: { name: "Studio" } }],
      },
      { ...assets[1], category: null, assetLocations: [] },
    ]);

    const response = (await runLoader()) as unknown as {
      data: {
        error?: unknown;
        assets: Array<Record<string, unknown>>;
        labelsCsv: string;
      };
    };

    expect(response.data.error).toBeFalsy();
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          category: { select: { name: true } },
          assetLocations: expect.objectContaining({ take: 1 }),
        }),
      })
    );
    // Category and location travel only in the CSV, not the label payload.
    expect(response.data.assets[0]).not.toHaveProperty("category");
    expect(response.data.assets[0]).not.toHaveProperty("assetLocations");
    // No shortener in the test environment: codes encode this server's /qr.
    expect(
      response.data.labelsCsv.replace(/^\uFEFF/, "").split("\r\n")
    ).toEqual([
      '"Asset name","SAM ID","QR ID","QR URL","Category","Location"',
      '"Asset 0","SAM-0","qr-asset-0","http://localhost:3000/qr/qr-asset-0","Cameras","Studio"',
      '"Asset 1","SAM-1","qr-asset-1","http://localhost:3000/qr/qr-asset-1","",""',
    ]);
  });
});

const runSelectAll = (query: string) =>
  loader({
    request: new Request(
      "http://localhost/api/assets/get-assets-for-bulk-qr-download?assetIds=all-selected&" +
        query
    ),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as LoaderFunctionArgs);

describe("bulk QR download select-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves advanced-mode filters through the bulk helper", async () => {
    bulkMocks.resolveAssetIdsForBulkOperation.mockResolvedValue([
      "asset-0",
      "asset-1",
    ]);
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      assets.slice(0, 2)
    );

    const response = (await runSelectAll("status=is:AVAILABLE")) as unknown as {
      data: { error?: unknown };
    };

    expect(response.data.error).toBeFalsy();
    expect(bulkMocks.resolveAssetIdsForBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["all-selected"],
        currentSearchParams: expect.stringContaining("status=is%3AAVAILABLE"),
        settings: expect.objectContaining({ mode: "ADVANCED" }),
      })
    );
    // The filter syntax never reaches Prisma: assets are read by resolved id.
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["asset-0", "asset-1"] }, organizationId: "org-1" },
      })
    );
  });

  it("lets a member who sees all custody filter by custody", async () => {
    bulkMocks.resolveAssetIdsForBulkOperation.mockResolvedValue(["asset-0"]);
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      assets.slice(0, 1)
    );

    await runSelectAll("custody=is:in-custody");

    // The helper refuses a `custody` filter unless told "all"; an empty list
    // would turn an admin's valid filtered download into an empty one.
    expect(bulkMocks.resolveAssetIdsForBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({ allowedTeamMemberIds: "all" })
    );
  });

  it("resolves in simple mode for a role without the advanced index", async () => {
    // A demoted member's saved mode can still be ADVANCED, and advanced search
    // matches custodian names, which BASE may not be allowed to see.
    (requirePermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      organizationId: "org-1",
      role: "BASE",
      access: accessFor(["BASE"]),
      currentOrganization: {
        qrIdDisplayPreference: "qrId",
        showShelfBranding: true,
      },
    });
    bulkMocks.resolveAssetIdsForBulkOperation.mockResolvedValue([]);
    (db.asset.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runSelectAll("s=Jane");

    expect(bulkMocks.resolveAssetIdsForBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ mode: "SIMPLE" }),
        // A restricted role never gets the unrestricted custody sentinel.
        allowedTeamMemberIds: [],
      })
    );
  });

  it("refuses more than the export cap as a 400 the user can act on", async () => {
    bulkMocks.resolveAssetIdsForBulkOperation.mockResolvedValue(
      Array.from({ length: MAX_BULK_QR_EXPORT + 1 }, (_, index) => `asset-${index}`)
    );

    const response = (await runSelectAll("")) as unknown as {
      data: { error?: { message?: string } };
      init: { status?: number } | null;
    };

    expect(response.init?.status).toBe(400);
    expect(response.data.error?.message).toMatch(/limited to 1500 assets/);
    expect(db.asset.findMany).not.toHaveBeenCalled();
  });
});
