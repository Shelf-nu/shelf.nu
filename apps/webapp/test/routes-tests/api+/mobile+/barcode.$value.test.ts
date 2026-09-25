/**
 * Route test for the asset photo the mobile barcode lookup returns.
 *
 * A barcode resolves in the caller's current workspace first and in another
 * workspace they belong to after. Either way the linked asset goes through the
 * shared re-sign-then-shape step, scoped to the workspace that OWNS the
 * barcode, so a lapsed photo arrives working and its write-back lands on the
 * right row.
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

/** Runs the loader for the tripod's barcode from workspace `org-1`. */
async function get() {
  const response = await loader(
    createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/barcode/TRIPOD01?orgId=org-1"
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

describe("GET /api/mobile/barcode/:value — asset photo", () => {
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
