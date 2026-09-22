/**
 * Tests for `api+/assets.get-assets-for-bulk-qr-download`.
 *
 * The route renders up to 100 QR codes in one request. What it must not do is
 * ask the database for each one separately: the codes are read in a single
 * query, and only an asset that genuinely has none pays for a create. That is
 * the property pinned here, because nothing about the response shape would
 * reveal a hundred round trips.
 *
 * @see {@link file://../../../app/routes/api+/assets.get-assets-for-bulk-qr-download.ts}
 * @see {@link file://../../../app/modules/qr/utils.server.ts} generateQrObj
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const qrMocks = vi.hoisted(() => ({
  getQrByAssetId: vi.fn(),
  getQrByKitId: vi.fn(),
  createQr: vi.fn(),
}));

// why: the per-asset lookups are exactly what this route must stop making, so
// the assertion is that these are never reached — not that they return a value.
vi.mock("~/modules/qr/service.server", () => qrMocks);

// why: authorization and the select-all filter have their own coverage; here
// they only need to resolve so the handler reaches the QR reads.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn().mockResolvedValue({
    organizationId: "org-1",
    role: "ADMIN",
    canSeeAllCustody: true,
    // The loader reads these off the organization for the response, after the
    // QR work — omitting them makes the handler 500 on its last line while the
    // assertions below still pass.
    currentOrganization: {
      qrIdDisplayPreference: "qrId",
      showShelfBranding: true,
    },
  }),
}));
vi.mock("~/modules/team-member/service.server", () => ({
  scopeCustodianFilterIds: vi.fn().mockResolvedValue("all"),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn() },
    qr: { findMany: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  },
}));

import { db } from "~/database/db.server";
import { loader } from "~/routes/api+/assets.get-assets-for-bulk-qr-download";

const ASSET_COUNT = 20;
const assets = Array.from({ length: ASSET_COUNT }, (_, index) => ({
  id: `asset-${index}`,
  title: `Asset ${index}`,
  createdAt: new Date("2026-01-01"),
  sequentialId: `SAM-${index}`,
}));

const qrFor = (assetId: string) => ({
  id: `qr-${assetId}`,
  version: 0,
  errorCorrection: "L",
  assetId,
  kitId: null,
  userId: "user-1",
  organizationId: "org-1",
});

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
    (db.qr.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      assets.map((asset) => qrFor(asset.id))
    );
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (tx: typeof db) => unknown) => callback(db)
    );
  });

  it("reads every code in one query instead of one per asset", async () => {
    const response = (await runLoader()) as unknown as {
      data: { error?: unknown };
    };

    // Assert success first: the counts below would also hold for a handler
    // that threw after the reads.
    expect(response.data.error).toBeFalsy();
    expect(db.qr.findMany).toHaveBeenCalledTimes(1);
    // The per-asset lookup inside `generateQrObj` must not be reached, and no
    // asset here is missing a code, so nothing should be created either.
    expect(qrMocks.getQrByAssetId).not.toHaveBeenCalled();
    expect(qrMocks.createQr).not.toHaveBeenCalled();
  });

  it("creates only for the asset that has no code", async () => {
    // One asset is missing from the batched read.
    (db.qr.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      assets.slice(1).map((asset) => qrFor(asset.id))
    );
    (db.qr.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    qrMocks.createQr.mockResolvedValue(qrFor("asset-0"));

    await runLoader();

    expect(db.qr.findMany).toHaveBeenCalledTimes(1);
    expect(qrMocks.createQr).toHaveBeenCalledTimes(1);
    // Still no per-asset lookup: the batched read is authoritative.
    expect(qrMocks.getQrByAssetId).not.toHaveBeenCalled();
  });
});
