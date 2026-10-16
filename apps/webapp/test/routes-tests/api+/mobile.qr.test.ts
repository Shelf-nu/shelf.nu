/**
 * Test suite for GET /api/mobile/qr/:qrId.
 *
 * Covers QR / SAM ID / SAM-shaped barcode resolution and the scan record
 * (via `recordScanNonFatal`) that puts companion field scans in an asset's
 * scan history. Asserts what is recorded for each code type on a successful,
 * in-org resolve; that nothing is recorded on 404/403/401; the user-agent
 * fallback; and that the route stays up when recording yields nothing. That
 * a failed record is swallowed and logged is pinned in
 * `app/modules/scan/record-scan.test.ts`.
 *
 * Also pins the custody the resolved asset carries: the same per-viewer
 * filter as the asset detail (`/api/mobile/assets/:assetId`), read for the
 * workspace that owns the code.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/qr.$qrId.ts}
 */
import { loader } from "~/routes/api+/mobile+/qr.$qrId";
import { mobileUserContext } from "@helpers/mobile-user-context";
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

// why: external auth, we don't want to hit Supabase in tests. Only the auth,
// org-access and viewer-context lookups are stubbed; the real shape helpers
// run, so the custody assertions below see the actual flattening and the
// actual viewer filter, not a hand-mirrored stub. The photo re-sign step is a
// no-op for these fixtures (no photo to re-sign).
vitest.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vitest.importActual<
    typeof import("~/modules/api/mobile-auth.server")
  >("~/modules/api/mobile-auth.server");
  return {
    ...actual,
    requireMobileAuth: vitest.fn(),
    // why: SAM/sequential resolution scopes by the caller's org
    requireOrganizationAccess: vitest.fn(),
    // why: reads the caller's membership; the tests set custody visibility
    getMobileUserContext: vitest.fn(),
  };
});

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
    organization: {
      findUnique: vitest.fn(),
    },
  },
}));

// why: the barcode lookup reads the database; the SAM-shaped fallback case
// controls what it finds.
vitest.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: vitest.fn(),
}));

// why: the add-on gate depends on deployment config; these cases hold it.
vitest.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vitest.fn(() => true),
}));

// why: the recording helper writes to the database; its own behaviour is
// covered in record-scan.test.ts. Here we assert what the route asks it for.
vitest.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: vitest.fn(),
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

import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { getBarcodeByValue } from "~/modules/barcode/service.server";
import { recordScanNonFatal } from "~/modules/scan/service.server";
import { makeShelfError } from "~/utils/error";

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

/** One operator-assigned custody row, as `MOBILE_ASSET_SELECT` returns it. */
function custodyRow(
  custodianId: string,
  name: string,
  userId: string | null,
  quantity: number
) {
  return {
    quantity,
    kitCustodyId: null,
    custodian: { id: custodianId, name, userId },
  };
}

/**
 * A quantity-tracked asset held by three people, oldest custody first: a
 * colleague, the caller (`user-1`), and a team member without an account.
 */
const sharedAsset = {
  ...mockAsset,
  type: "QUANTITY_TRACKED",
  quantity: 20,
  custody: [
    custodyRow("tm-colleague", "Colleague One", "user-2", 3),
    custodyRow("tm-caller", "Test User", "user-1", 2),
    custodyRow("tm-no-account", "Warehouse Shelf", null, 4),
  ],
};

/** Sets whether the caller may see every holder's custody in the workspace. */
function asViewer({ canSeeAllCustody }: { canSeeAllCustody: boolean }) {
  const context = mobileUserContext();
  vitest.mocked(getMobileUserContext).mockResolvedValue({
    ...context,
    access: {
      ...context.access,
      custody: { ...context.access.custody, seeAll: canSeeAllCustody },
    },
  } as Awaited<ReturnType<typeof getMobileUserContext>>);
}

/**
 * Builds an authenticated GET request for the QR endpoint.
 *
 * @param userAgent - optional User-Agent header; omit to assert the
 *   server-side `"mobile-companion"` fallback.
 * @returns a `Request` with a bearer token (and the UA header when given).
 */
function createQrRequest(userAgent?: string, code = "qr-1") {
  const headers: Record<string, string> = {
    Authorization: "Bearer test-token",
  };
  if (userAgent !== undefined) {
    headers["user-agent"] = userAgent;
  }
  return new Request(`http://localhost:3000/api/mobile/qr/${code}`, {
    headers,
  });
}

/**
 * Invokes the QR loader with a scanned code as the route param.
 *
 * @param request - the request from {@link createQrRequest}.
 * @param code - the scanned value; `qr-1` unless a case says otherwise.
 * @returns the loader result (a `Response` via the mocked `data()`).
 */
function run(request: Request, code = "qr-1") {
  return loader(createLoaderArgs({ request, params: { qrId: code } }));
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
    (recordScanNonFatal as any).mockResolvedValue({ id: "scan-1" });
    asViewer({ canSeeAllCustody: true });
  });

  describe("custody visibility", () => {
    beforeEach(() => {
      (db.asset.findFirst as any).mockResolvedValue(sharedAsset);
    });

    it("sends a caller without custody visibility only their own holding and a count of the others", async () => {
      asViewer({ canSeeAllCustody: false });

      const result = await run(createQrRequest());

      const body = await (result as unknown as Response).json();
      expect(body.qr.asset.custodyList).toEqual([
        {
          custodian: { id: "tm-caller", name: "Test User", userId: "user-1" },
          quantity: 2,
          releasableQuantity: 2,
        },
      ]);
      expect(body.qr.asset.custodyListOthersCount).toBe(2);
      // The single custody is the oldest holder's, and that is the colleague.
      expect(body.qr.asset.custody).toBeNull();
      const payload = JSON.stringify(body);
      expect(payload).not.toContain("Colleague One");
      expect(payload).not.toContain("user-2");
      expect(payload).not.toContain("Warehouse Shelf");
      expect(getMobileUserContext).toHaveBeenCalledWith("user-1", "org-1");
    });

    it("keeps the single custody for a caller without custody visibility who is its holder", async () => {
      asViewer({ canSeeAllCustody: false });
      (db.asset.findFirst as any).mockResolvedValue({
        ...sharedAsset,
        custody: [
          custodyRow("tm-caller", "Test User", "user-1", 2),
          custodyRow("tm-colleague", "Colleague One", "user-2", 3),
        ],
      });

      const result = await run(createQrRequest());

      const body = await (result as unknown as Response).json();
      expect(body.qr.asset.custody).toEqual({
        custodian: { id: "tm-caller", name: "Test User", userId: "user-1" },
      });
      expect(body.qr.asset.custodyList).toHaveLength(1);
      expect(body.qr.asset.custodyListOthersCount).toBe(1);
    });

    it("sends every holder to a caller who may see all custody", async () => {
      asViewer({ canSeeAllCustody: true });

      const result = await run(createQrRequest());

      const body = await (result as unknown as Response).json();
      expect(
        body.qr.asset.custodyList.map(
          (entry: { custodian: { id: string } }) => entry.custodian.id
        )
      ).toEqual(["tm-colleague", "tm-caller", "tm-no-account"]);
      expect(body.qr.asset.custodyListOthersCount).toBe(0);
      expect(body.qr.asset.custody).toEqual({
        custodian: {
          id: "tm-colleague",
          name: "Colleague One",
          userId: "user-2",
        },
      });
    });

    it("reads custody visibility in the workspace that owns the code", async () => {
      // A QR id is global, so the code can belong to another of the caller's
      // workspaces, where their role and that workspace's settings apply.
      (db.qr.findUnique as any).mockResolvedValue({
        ...mockQr,
        organizationId: "org-2",
      });

      await run(createQrRequest());

      expect(getMobileUserContext).toHaveBeenCalledWith("user-1", "org-2");
    });
  });

  it("resolves a QR to its linked asset and records scan provenance", async () => {
    const result = await run(createQrRequest("ShelfCompanion/1.0 iOS"));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.qr.id).toBe("qr-1");
    expect(body.qr.asset.id).toBe("asset-1");

    // why: who + when provenance must be written on a successful resolve
    expect(recordScanNonFatal).toHaveBeenCalledWith({
      codeType: "QR",
      code: "qr-1",
      qrId: "qr-1",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
      source: "COMPANION",
      userAgent: "ShelfCompanion/1.0 iOS",
      userId: "user-1",
      writeNote: true,
    });
  });

  it("records a SAM ID scan against the asset, with a note", async () => {
    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    const result = await run(
      createQrRequest(undefined, "sam-0001"),
      "sam-0001"
    );

    expect((result as unknown as Response).status).toBe(200);
    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        codeType: "SAM_ID",
        // As scanned, not as normalized.
        code: "sam-0001",
        assetId: "asset-1",
        organizationId: "org-1",
        source: "COMPANION",
        writeNote: true,
      })
    );
  });

  it("records a SAM-shaped barcode as the barcode it is", async () => {
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (db.asset.findFirst as any).mockResolvedValue(null);
    (db.organization.findUnique as any).mockResolvedValue({
      barcodesEnabled: true,
    });
    (getBarcodeByValue as any).mockResolvedValue({
      id: "barcode-1",
      value: "SAM-0001",
      assetId: "asset-1",
      kitId: null,
      asset: mockAsset,
      kit: null,
    });

    const result = await run(
      createQrRequest(undefined, "SAM-0001"),
      "SAM-0001"
    );

    expect((result as unknown as Response).status).toBe(200);
    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({
        codeType: "BARCODE",
        code: "SAM-0001",
        barcodeId: "barcode-1",
        assetId: "asset-1",
        organizationId: "org-1",
        source: "COMPANION",
      })
    );
  });

  it("falls back to a channel user-agent when the header is absent", async () => {
    await run(createQrRequest());

    expect(recordScanNonFatal).toHaveBeenCalledWith(
      expect.objectContaining({ userAgent: "mobile-companion" })
    );
  });

  it("does NOT record provenance when the QR is not found (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(recordScanNonFatal).not.toHaveBeenCalled();
  });

  it("does NOT record provenance when the QR has no organization (404)", async () => {
    (db.qr.findUnique as any).mockResolvedValue({
      ...mockQr,
      organizationId: null,
    });

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(recordScanNonFatal).not.toHaveBeenCalled();
  });

  it("does NOT record provenance for a cross-organization QR (403)", async () => {
    (db.userOrganization.findUnique as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    expect((result as unknown as Response).status).toBe(403);
    expect(recordScanNonFatal).not.toHaveBeenCalled();
  });

  it("still resolves the asset when recording yields nothing", async () => {
    // A failed record comes back as null from the non-fatal wrapper.
    (recordScanNonFatal as any).mockResolvedValue(null);

    const result = await run(createQrRequest());

    // why: a provenance hiccup must never break the scanner
    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();
    expect(body.qr.asset.id).toBe("asset-1");
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
    expect(recordScanNonFatal).not.toHaveBeenCalled();
  });
});
