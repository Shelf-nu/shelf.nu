/**
 * Test suite for GET /api/mobile/get-scanned-item/:qrId.
 *
 * The non-recording sibling of `/api/mobile/qr/:qrId`: it resolves a scanned
 * code to its asset/kit via the shared resolver but must NEVER write scan
 * provenance. The companion's audit scanner identifies codes here, and the
 * audit's own writer (`recordAuditScan`) records that scan, so a record here
 * would count it twice. The key assertion is that no scan is recorded.
 * The resolved asset carries custody filtered for the caller, as on the
 * asset detail.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/get-scanned-item.$qrId.ts}
 */
import { loader } from "~/routes/api+/mobile+/get-scanned-item.$qrId";
import { mobileUserContext } from "@helpers/mobile-user-context";
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

// why: external auth, we don't want to hit Supabase in tests. Only the auth,
// org-access and viewer-context lookups are stubbed; the real shape helpers
// run, so the custody assertions below see the actual flattening and the
// actual viewer filter. The photo re-sign step is a no-op for these fixtures
// (no photo to re-sign).
vitest.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vitest.importActual<
    typeof import("~/modules/api/mobile-auth.server")
  >("~/modules/api/mobile-auth.server");
  return {
    ...actual,
    requireMobileAuth: vitest.fn(),
    requireOrganizationAccess: vitest.fn(),
    // why: reads the caller's membership; the tests set custody visibility
    getMobileUserContext: vitest.fn(),
    // why: the workspace lapse gate has its own tests
    // (mobile-auth.server.workspace-lapse.test.ts); here it answers membership
    // from the mocked membership row, as the gate does for an active workspace.
    getMobileWorkspaceAccess: vitest.fn(
      async ({
        userId,
        organizationId,
      }: {
        userId: string;
        organizationId: string;
      }) => {
        const { db: mockedDb } = await import("~/database/db.server");
        const row = await mockedDb.userOrganization.findUnique({
          where: { userId_organizationId: { userId, organizationId } },
        });
        return { access: row ? "active" : "not-member" };
      }
    ),
  };
});

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
  recordScan: vitest.fn(),
  recordScanNonFatal: vitest.fn(),
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

import {
  getMobileUserContext,
  getMobileWorkspaceAccess,
  requireMobileAuth,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { recordScan, recordScanNonFatal } from "~/modules/scan/service.server";

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
 * A quantity-tracked asset held by two people, oldest custody first: a
 * colleague and the caller (`user-1`).
 */
const sharedAsset = {
  ...mockAsset,
  type: "QUANTITY_TRACKED",
  quantity: 20,
  custody: [
    custodyRow("tm-colleague", "Colleague One", "user-2", 3),
    custodyRow("tm-caller", "Test User", "user-1", 2),
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
    asViewer({ canSeeAllCustody: true });
  });

  it("resolves the asset WITHOUT recording a scan", async () => {
    const result = await run(createRequest());

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.qr.id).toBe("qr-1");
    expect(body.qr.asset.id).toBe("asset-1");
    // why: the defining property of this route — no provenance write ever
    expect(recordScanNonFatal).not.toHaveBeenCalled();
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown QR and still records nothing", async () => {
    (db.qr.findUnique as any).mockResolvedValue(null);

    const result = await run(createRequest());

    expect((result as unknown as Response).status).toBe(404);
    expect(recordScanNonFatal).not.toHaveBeenCalled();
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("tags a code whose workspace is inactive, so the audit scanner can title it", async () => {
    const message =
      "The workspace this code belongs to is inactive because its subscription has expired.";
    const inactiveError = Object.assign(new Error(message), { status: 403 });
    (getMobileWorkspaceAccess as any).mockResolvedValueOnce({
      access: "inactive",
      error: inactiveError,
    });
    (makeShelfError as any).mockReturnValueOnce({
      message,
      status: 403,
      title: "Workspace inactive",
    });

    const result = await run(createRequest());

    expect((result as unknown as Response).status).toBe(403);
    expect(await (result as unknown as Response).json()).toEqual({
      error: { message, reason: "workspace_inactive" },
    });
    expect(makeShelfError).toHaveBeenCalledWith(inactiveError);
    expect(db.asset.findFirst).not.toHaveBeenCalled();
  });

  describe("custody visibility", () => {
    beforeEach(() => {
      (db.asset.findFirst as any).mockResolvedValue(sharedAsset);
    });

    it("sends a caller without custody visibility only their own holding and a count of the others", async () => {
      asViewer({ canSeeAllCustody: false });

      const result = await run(createRequest());

      const body = await (result as unknown as Response).json();
      expect(body.qr.asset.custodyList).toEqual([
        {
          custodian: { id: "tm-caller", name: "Test User", userId: "user-1" },
          quantity: 2,
          releasableQuantity: 2,
        },
      ]);
      expect(body.qr.asset.custodyListOthersCount).toBe(1);
      expect(body.qr.asset.custody).toBeNull();
      const payload = JSON.stringify(body);
      expect(payload).not.toContain("Colleague One");
      expect(payload).not.toContain("user-2");
      expect(getMobileUserContext).toHaveBeenCalledWith("user-1", "org-1");
    });

    it("sends every holder to a caller who may see all custody", async () => {
      asViewer({ canSeeAllCustody: true });

      const result = await run(createRequest());

      const body = await (result as unknown as Response).json();
      expect(
        body.qr.asset.custodyList.map(
          (entry: { custodian: { id: string } }) => entry.custodian.id
        )
      ).toEqual(["tm-colleague", "tm-caller"]);
      expect(body.qr.asset.custodyListOthersCount).toBe(0);
      expect(body.qr.asset.custody).toEqual({
        custodian: {
          id: "tm-colleague",
          name: "Colleague One",
          userId: "user-2",
        },
      });
    });
  });
});
