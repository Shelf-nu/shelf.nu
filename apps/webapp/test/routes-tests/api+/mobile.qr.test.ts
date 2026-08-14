/**
 * Test suite for GET /api/mobile/qr/:qrId.
 *
 * Covers QR→asset resolution and the scan-provenance write (who + when via
 * `createScan`) added so companion field scans appear in an asset's scan
 * history. Asserts provenance is recorded on a successful, in-org resolve;
 * NOT recorded on 404/403/401; the user-agent fallback; and that a
 * provenance failure is non-fatal (asset still resolves, error logged once).
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/qr.$qrId.ts}
 */
import { loader } from "~/routes/api+/mobile+/qr.$qrId";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

/**
 * Hoisted factory for the mocked React Router `data()` helper.
 *
 * why: mocking `data()` to return real `Response` objects so the loader's
 * single-fetch return path can be asserted (status + JSON body).
 */
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
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  // why: SAM/sequential resolution (added on main) scopes by the caller's org
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

// why: external database — we don't want to hit the real database in tests.
// asset/kit are read via org-scoped `findFirst` (main moved off `findUnique`).
vitest.mock("~/database/db.server", () => ({
  db: {
    qr: {
      findUnique: vitest.fn(),
    },
    userOrganization: {
      findUnique: vitest.fn(),
    },
    asset: {
      findFirst: vitest.fn(),
    },
    kit: {
      findFirst: vitest.fn(),
    },
  },
}));

// why: external service — we assert provenance is recorded without hitting the DB
vitest.mock("~/modules/scan/service.server", () => ({
  createScan: vitest.fn(),
}));

// why: we assert non-fatal logging without emitting real logs
vitest.mock("~/utils/logger", () => ({
  Logger: { error: vitest.fn() },
}));

// why: we control error formatting in the loader's catch block (return
// path) without pulling in the real logger/Sentry wiring
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
import { makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

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

/**
 * Builds an authenticated GET request for the QR endpoint.
 *
 * @param userAgent - optional User-Agent header; omit to assert the
 *   server-side `"mobile-companion"` fallback.
 * @returns a `Request` with a bearer token (and the UA header when given).
 */
function createQrRequest(userAgent?: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer test-token",
  };
  if (userAgent !== undefined) {
    headers["user-agent"] = userAgent;
  }
  return new Request("http://localhost:3000/api/mobile/qr/qr-1", { headers });
}

/**
 * Invokes the QR loader with the standard `qr-1` route param.
 *
 * @param request - the request from {@link createQrRequest}.
 * @returns the loader result (a `Response` via the mocked `data()`).
 */
function run(request: Request) {
  return loader(createLoaderArgs({ request, params: { qrId: "qr-1" } }));
}

describe("GET /api/mobile/qr/:qrId", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (db.qr.findUnique as any).mockResolvedValue(mockQr);
    (db.userOrganization.findUnique as any).mockResolvedValue({ id: "uo-1" });
    (db.asset.findFirst as any).mockResolvedValue(mockAsset);
    (createScan as any).mockResolvedValue({ id: "scan-1" });
  });

  it("resolves a QR to its linked asset and records scan provenance", async () => {
    const result = await run(createQrRequest("ShelfCompanion/1.0 iOS"));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.qr.id).toBe("qr-1");
    expect(body.qr.asset.id).toBe("asset-1");

    // why: who + when provenance must be written on a successful resolve
    expect(createScan).toHaveBeenCalledWith({
      userAgent: "ShelfCompanion/1.0 iOS",
      userId: "user-1",
      qrId: "qr-1",
      deleted: false,
    });
  });

  it("falls back to a channel user-agent when the header is absent", async () => {
    await run(createQrRequest());

    expect(createScan).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "mobile-companion" })
    );
  });

  it("does NOT record provenance when the QR is not found (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("does NOT record provenance when the QR has no organization (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue({
      ...mockQr,
      organizationId: null,
    });

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("does NOT record provenance for a cross-organization QR (403)", async () => {
    (db.userOrganization.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(403);
    expect(createScan).not.toHaveBeenCalled();
  });

  it("is non-fatal: a provenance failure still resolves the asset", async () => {
    (createScan as any).mockRejectedValue(new Error("scan-note write failed"));

    const result = await run(createQrRequest());

    // why: a provenance hiccup must never break the scanner
    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.qr.asset.id).toBe("asset-1");
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });

  it("handles auth errors from requireMobileAuth", async () => {
    const authError = new Error("Invalid or expired token");
    (authError as any).status = 401;
    (requireMobileAuth as any).mockRejectedValue(authError);
    (makeShelfError as any).mockReturnValue({
      message: "Invalid or expired token",
      status: 401,
    });

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(401);
    expect(createScan).not.toHaveBeenCalled();
  });
});
