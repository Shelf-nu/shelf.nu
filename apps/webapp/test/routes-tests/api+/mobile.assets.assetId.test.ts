/**
 * Test suite for GET /api/mobile/assets/:assetId — custody visibility.
 *
 * Pins the server-side custody-visibility parity fix: viewers without
 * custody-view permission (SELF_SERVICE/BASE without the org override) must
 * only receive their OWN `custodyList` entries plus a hidden-holders count
 * (`custodyListOthersCount`), and the legacy single `custody` field is
 * nulled unless the viewer can see all custody or IS the primary custodian —
 * mirroring the web (quantity-custody-list.tsx:121-126 and
 * assets.$assetId.overview.tsx:1826-1836 + asset-custody-card.tsx:63).
 *
 * The filtering helpers from `mobile-custody-visibility.server` are NOT
 * mocked, so the real visibility logic is exercised end to end through the
 * loader.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/assets.$assetId.ts}
 */
import { loader } from "~/routes/api+/mobile+/assets.$assetId";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
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

// why: external auth — we don't want to hit Supabase in tests. The whole
// module is mocked to keep Supabase out, so the pure shape helper must be
// re-provided; it mirrors the real one (flatten pivots + build custodyList).
// The per-custodian aggregation is skipped because the fixtures below carry
// exactly one custody row per custodian.
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  getMobileUserContext: vitest.fn(),
  shapeMobileAssetResponse: (asset: any) => {
    const { assetKits, assetLocations, custody, ...rest } = asset;
    const kit = assetKits[0]?.kit ?? null;
    return {
      ...rest,
      kitId: kit?.id ?? null,
      kit,
      location: assetLocations[0]?.location ?? null,
      custody: custody[0] ? { custodian: custody[0].custodian } : null,
      custodyList: custody.map((c: any) => ({
        custodian: { id: c.custodian.id, name: c.custodian.name },
        quantity: c.quantity,
      })),
    };
  },
}));

// why: external database — we don't want to hit the real database in tests
vitest.mock("~/database/db.server", () => ({
  db: {
    asset: { findUnique: vitest.fn() },
  },
}));

// why: the quantity-rows fetcher hits the database AND drags the heavy
// booking-service (scanner/lottie) import graph into the test — mock it and
// feed the pure `getQuantityData` reducer a minimal quantity-aware shape
vitest.mock("~/modules/asset/quantity-breakdown.server", () => ({
  getAssetQuantityRows: vitest.fn().mockResolvedValue({
    type: "QUANTITY_TRACKED",
    quantity: 10,
    custody: [{ quantity: 5 }, { quantity: 3 }, { quantity: 1 }],
    bookingAssets: [],
  }),
}));

// why: we need to control error formatting without running real error logic
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

/**
 * A QUANTITY_TRACKED asset with three holders: two other people (one with a
 * linked user, one non-registered) and the caller (`user-1`). The caller's
 * row is deliberately NOT first, so the legacy `custody` (= custody[0])
 * belongs to someone else.
 */
function buildAsset() {
  return {
    id: "asset-1",
    title: "Bolts",
    description: null,
    status: "IN_CUSTODY",
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
    availableToBook: true,
    valuation: null,
    type: "QUANTITY_TRACKED",
    quantity: 10,
    minQuantity: null,
    unitOfMeasure: "pcs",
    consumptionType: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    userId: "owner-user",
    category: null,
    assetLocations: [],
    custody: [
      {
        createdAt: new Date("2026-01-01T10:00:00Z"),
        quantity: 5,
        custodian: {
          id: "tm-alice",
          name: "Alice Holder",
          userId: "user-9",
          user: {
            firstName: "Alice",
            lastName: "Holder",
            email: "alice@example.com",
            profilePicture: null,
          },
        },
      },
      {
        createdAt: new Date("2026-01-01T11:00:00Z"),
        quantity: 3,
        custodian: {
          id: "tm-me",
          name: "Test User",
          userId: "user-1",
          user: {
            firstName: "Test",
            lastName: "User",
            email: "test@example.com",
            profilePicture: null,
          },
        },
      },
      {
        createdAt: new Date("2026-01-01T12:00:00Z"),
        quantity: 1,
        custodian: {
          id: "tm-nrm",
          name: "Bob NonRegistered",
          userId: null,
          user: null,
        },
      },
    ],
    assetKits: [],
    tags: [],
    qrCodes: [],
    organization: { currency: "USD" },
    notes: [],
    customFields: [],
  };
}

function createDetailRequest(orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/assets/asset-1?orgId=${orgId}`,
    {
      headers: { Authorization: "Bearer token" },
    }
  );
}

describe("GET /api/mobile/assets/:assetId — custody visibility", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: true,
    });

    (db.asset.findUnique as any).mockResolvedValue(buildAsset());
  });

  it("shows a self-service caller only their own custody rows + the hidden count", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
    });

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();

    // Only the caller's own entry survives the filter
    expect(body.asset.custodyList).toEqual([
      { custodian: { id: "tm-me", name: "Test User" }, quantity: 3 },
    ]);
    // Two other holders were hidden
    expect(body.asset.custodyListOthersCount).toBe(2);

    // Legacy custody (= custody[0]) belongs to Alice, not the caller —
    // hidden, matching the web's CustodyCard hasPermission behavior
    expect(body.asset.custody).toBeNull();

    // Hard privacy assertion: nothing about the hidden holders leaks
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Alice");
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("Bob NonRegistered");
  });

  it("keeps the legacy custody visible when the restricted caller IS the primary custodian", async () => {
    (getMobileUserContext as any).mockResolvedValue({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canUseAudits: false,
      canSeeAllCustody: false,
    });
    // Reorder so the caller's row is the primary (oldest) one
    const asset = buildAsset();
    asset.custody = [asset.custody[1], asset.custody[0], asset.custody[2]];
    (db.asset.findUnique as any).mockResolvedValue(asset);

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    // The caller may always see their OWN custody record (web:
    // userCanViewSpecificCustody), so the legacy field stays populated
    expect(body.asset.custody).not.toBeNull();
    expect(body.asset.custody.custodian.id).toBe("tm-me");

    expect(body.asset.custodyList).toEqual([
      { custodian: { id: "tm-me", name: "Test User" }, quantity: 3 },
    ]);
    expect(body.asset.custodyListOthersCount).toBe(2);
  });

  it("returns the full custody list to callers who can see all custody", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    const body = await (result as unknown as Response).json();

    expect(body.asset.custodyList).toHaveLength(3);
    expect(body.asset.custodyListOthersCount).toBe(0);
    // Legacy custody stays the primary (oldest) record
    expect(body.asset.custody.custodian.id).toBe("tm-alice");
  });
});
