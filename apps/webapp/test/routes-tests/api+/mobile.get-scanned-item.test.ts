/**
 * Test suite for GET /api/mobile/get-scanned-item/:qrId.
 *
 * The non-recording sibling of `/api/mobile/qr/:qrId`: it resolves a scanned
 * code to its asset/kit via the shared resolver but must NEVER write scan
 * provenance (mirrors the web's `get-scanned-item` resolve; used by the audit
 * scanner so audit lookups don't pollute an asset's "last scanned" history).
 * The key assertion is that `createScan` is never called.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/get-scanned-item.$qrId.ts}
 */
import { loader } from "~/routes/api+/mobile+/get-scanned-item.$qrId";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

/** Hoisted factory for the mocked React Router `data()` helper. */
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  MOBILE_ASSET_SELECT: {
    id: true,
    title: true,
    status: true,
    mainImage: true,
    category: { select: { name: true } },
    location: { select: { name: true } },
  },
  MOBILE_KIT_SELECT: { id: true, name: true },
  // why: the whole module is mocked to keep Supabase out of these tests, so the
  // pure shape helpers must be provided too. These mirror the real ones (flatten
  // the quantities pivot shape into the flat shape the companion expects).
  shapeMobileAssetResponse: (asset: any) => {
    const { assetKits, assetLocations, custody, ...rest } = asset;
    const kit = assetKits[0]?.kit ?? null;
    return {
      ...rest,
      kitId: kit?.id ?? null,
      kit,
      location: assetLocations[0]?.location ?? null,
      custody: custody[0] ?? null,
    };
  },
  shapeMobileKitResponse: (kit: any) => kit ?? null,
}));

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    qr: { findUnique: vitest.fn() },
    userOrganization: { findUnique: vitest.fn() },
    asset: { findFirst: vitest.fn() },
    kit: { findFirst: vitest.fn() },
  },
}));

// why: the whole point of this route is that it never records — assert it
vitest.mock("~/modules/scan/service.server", () => ({
  createScan: vitest.fn(),
}));

// why: control error formatting in the catch path without real logger/Sentry
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { createScan } from "~/modules/scan/service.server";

const mockUser = { id: "user-1", email: "test@example.com" };
// quantities pivot shape (flattened back to the legacy flat shape the companion
// expects by shapeMobileAssetResponse).
const mockAsset = {
  id: "asset-1",
  title: "Test Laptop",
  status: "AVAILABLE",
  mainImage: null,
  availableToBook: true,
  category: { name: "Electronics" },
  assetKits: [],
  assetLocations: [{ location: { id: "loc-1", name: "Office A" } }],
  custody: [],
};
const mockQr = {
  id: "qr-1",
  assetId: "asset-1",
  kitId: null,
  organizationId: "org-1",
};

function createRequest() {
  return new Request("http://localhost:3000/api/mobile/get-scanned-item/qr-1", {
    headers: { Authorization: "Bearer test-token" },
  });
}

function run(request: Request) {
  return loader(createLoaderArgs({ request, params: { qrId: "qr-1" } }));
}

describe("GET /api/mobile/get-scanned-item/:qrId", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (db.qr.findUnique as any).mockResolvedValue(mockQr);
    (db.userOrganization.findUnique as any).mockResolvedValue({ id: "uo-1" });
    (db.asset.findFirst as any).mockResolvedValue(mockAsset);
  });

  it("resolves the asset WITHOUT recording a scan", async () => {
    const result = await run(createRequest());

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.qr.id).toBe("qr-1");
    expect(body.qr.asset.id).toBe("asset-1");
    // why: the defining property of this route — no provenance write ever
    expect(createScan).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown QR and still records nothing", async () => {
    (db.qr.findUnique as any).mockResolvedValue(null);

    const result = await run(createRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(createScan).not.toHaveBeenCalled();
  });
});
