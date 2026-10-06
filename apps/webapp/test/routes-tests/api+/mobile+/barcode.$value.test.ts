/**
 * Route test for the mobile barcode lookup: the asset photo it returns and the
 * scan it records.
 *
 * A barcode resolves in the caller's current workspace first and in another
 * workspace they belong to after. Either way the linked asset goes through the
 * shared re-sign-then-shape step, scoped to the workspace that OWNS the
 * barcode, so a lapsed photo arrives working and its write-back lands on the
 * right row. The scan is recorded in that owning workspace too: as a companion
 * scan with a note, or as an audit scan with none when the companion marks the
 * call `X-Scan-Context: audit`.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/barcode.$value.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  resignAndShapeMobileAsset,
} from "~/modules/api/mobile-auth.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { recordScanNonFatal } from "~/modules/scan/service.server";

import { loader } from "~/routes/api+/mobile+/barcode.$value";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the boundary for the workspace capability read and the
// sibling-workspace lookup; each test states the rows it needs.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUnique: vi.fn() },
    userOrganization: { findMany: vi.fn() },
    barcode: { findMany: vi.fn() },
  },
}));

// why: JWT validation and org access are out of scope, and the real module
// loads the Supabase admin client. The shared re-sign step has its own tests;
// here it tags the row so the response shows the asset went through it.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  MOBILE_ASSET_SELECT: {},
  MOBILE_KIT_SELECT: {},
  resignAndShapeMobileAsset: vi.fn((asset: { id: string }) =>
    Promise.resolve({ ...asset, photoResigned: true })
  ),
  shapeMobileKitResponse: (kit: unknown) => kit,
}));

// why: the barcode table lookup decides which workspace holds the code, so
// each test answers it directly.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: vi.fn(),
}));

// why: the add-on gate is billing state, not under test; every workspace here
// holds the add-on.
vi.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vi.fn(() => true),
}));

// why: the recording helper writes to the database; its own behaviour is
// covered in record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: vi.fn(),
}));

const ASSET_ROW = { id: "asset-1", title: "Tripod" };

/** A barcode linked to the tripod, as the lookup returns it. */
function barcodeRow() {
  return {
    id: "barcode-1",
    value: "TRIPOD01",
    type: "Code128",
    assetId: ASSET_ROW.id,
    kitId: null,
    asset: ASSET_ROW,
    kit: null,
  };
}

/**
 * Runs the loader for the tripod's barcode from workspace `org-1`.
 *
 * @param headers - extra request headers (scan context, GPS)
 */
async function get(headers: Record<string, string> = {}) {
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/barcode/TRIPOD01?orgId=org-1",
        { headers: { "user-agent": "ShelfCompanion/1.3.0", ...headers } }
      ),
      params: { value: "TRIPOD01" },
    })
  );
  assertIsDataWithResponseInit(response);
  return response.data as {
    barcode: {
      organizationId: string;
      asset: { id: string; photoResigned?: boolean } | null;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(db.organization.findUnique).mockResolvedValue({
    barcodesEnabled: true,
  } as never);
});

describe("GET /api/mobile/barcode/:value: asset photo", () => {
  it("re-signs the photo against the caller's workspace when it holds the barcode", async () => {
    vi.mocked(getBarcodeByValue).mockResolvedValue(barcodeRow() as never);

    const { barcode } = await get();

    expect(resignAndShapeMobileAsset).toHaveBeenCalledWith(ASSET_ROW, "org-1");
    expect(barcode.organizationId).toBe("org-1");
    expect(barcode.asset).toMatchObject({ id: "asset-1", photoResigned: true });
  });

  it("re-signs the photo against the other workspace that owns the barcode", async () => {
    vi.mocked(getBarcodeByValue)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(barcodeRow() as never);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: true } },
    ] as never);
    vi.mocked(db.barcode.findMany).mockResolvedValue([
      { organizationId: "org-2" },
    ] as never);

    const { barcode } = await get();

    expect(resignAndShapeMobileAsset).toHaveBeenCalledWith(ASSET_ROW, "org-2");
    expect(barcode.organizationId).toBe("org-2");
  });
});

describe("GET /api/mobile/barcode/:value: scan record", () => {
  it("records a companion barcode scan with a note on the asset", async () => {
    vi.mocked(getBarcodeByValue).mockResolvedValue(barcodeRow() as never);

    await get();

    expect(recordScanNonFatal).toHaveBeenCalledWith({
      codeType: "BARCODE",
      code: "TRIPOD01",
      source: "COMPANION",
      userAgent: "ShelfCompanion/1.3.0",
      userId: "user-1",
      barcodeId: "barcode-1",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
      writeNote: true,
    });
  });

  it("records an audit scan with no note when the companion marks the call", async () => {
    vi.mocked(getBarcodeByValue).mockResolvedValue(barcodeRow() as never);

    await get({ "X-Scan-Context": "audit" });

    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ source: "AUDIT", writeNote: false })
    );
  });

  it("stores the companion's position when it sends one", async () => {
    vi.mocked(getBarcodeByValue).mockResolvedValue(barcodeRow() as never);

    await get({ "X-Scan-Latitude": "52.37", "X-Scan-Longitude": "4.89" });

    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: "52.37", longitude: "4.89" })
    );
  });

  it("records the scan in the workspace that owns the barcode", async () => {
    vi.mocked(getBarcodeByValue)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(barcodeRow() as never);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([
      { organizationId: "org-2", organization: { barcodesEnabled: true } },
    ] as never);
    vi.mocked(db.barcode.findMany).mockResolvedValue([
      { organizationId: "org-2" },
    ] as never);

    await get();

    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-2" })
    );
  });

  it("records nothing for a barcode in none of the caller's workspaces", async () => {
    vi.mocked(getBarcodeByValue).mockResolvedValue(null as never);
    vi.mocked(db.userOrganization.findMany).mockResolvedValue([] as never);

    const response = await loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost:3000/api/mobile/barcode/NOPE?orgId=org-1"
        ),
        params: { value: "NOPE" },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(recordScanNonFatal).not.toHaveBeenCalled();
  });
});
