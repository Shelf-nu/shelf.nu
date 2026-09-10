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

// why: `subscription.server` loads the Stripe client and the billing config at
// module load. Stubbing the one capability helper also puts the add-on gate
// under explicit control, so these tests do not depend on the ambient
// `ENABLE_PREMIUM_FEATURES` value.
vitest.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vitest.fn(() => true),
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
import { canUseBarcodes } from "~/utils/subscription.server";

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
    sequentialId: "SAM-0017",
    description: null,
    status: "IN_CUSTODY",
    // Selected with the image columns so the shaper can resolve the cover-image
    // cascade; the response must expose the NAME only.
    assetModel: {
      name: "M8 Hex Bolt",
      image: "https://example.test/model.jpg",
      thumbnailImage: "https://example.test/model-thumb.jpg",
    },
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
    qrCodes: [{ id: "qr-abc123" }],
    // Code-resolution inputs. Defaults describe a workspace on the stock
    // QR_ID preference with no alternative codes; the display-code tests
    // below override exactly what they are about.
    preferredBarcodeId: null,
    barcodes: [],
    organization: {
      currency: "USD",
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: false,
    },
    notes: [],
    customFields: [],
  };
}

/** A `buildAsset()` with the code-resolution fields overridden. */
function buildAssetWithCodes(overrides: {
  qrIdDisplayPreference?: string;
  barcodesEnabled?: boolean;
  barcodes?: { id: string; type: string; value: string }[];
  preferredBarcodeId?: string | null;
  sequentialId?: string | null;
}) {
  const asset = buildAsset();
  return {
    ...asset,
    sequentialId:
      overrides.sequentialId === undefined
        ? asset.sequentialId
        : overrides.sequentialId,
    preferredBarcodeId: overrides.preferredBarcodeId ?? null,
    barcodes: overrides.barcodes ?? [],
    organization: {
      currency: "USD",
      qrIdDisplayPreference: overrides.qrIdDisplayPreference ?? "QR_ID",
      barcodesEnabled: overrides.barcodesEnabled ?? false,
    },
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

/**
 * The response is assembled by destructuring fields OFF the row and re-attaching
 * narrowed copies — the projection shape this repo gets wrong most often, and
 * one typecheck cannot see: dropping a key from the destructure or the return
 * literal leaves `validate` green and the field simply gone from the wire.
 */
describe("GET /api/mobile/assets/:assetId — payload projection", () => {
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

  it("sends the SAM ID, which the scanner's manual entry accepts", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    expect(body.asset.sequentialId).toBe("SAM-0017");
  });

  it("sends the model NAME only — no id, no image columns", async () => {
    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    // Exactly `{ name }`: an id has nothing to navigate to on mobile, and the
    // image columns would be a second source of truth for a cascade the shaper
    // has already resolved into mainImage/thumbnailImage.
    expect(body.asset.assetModel).toEqual({ name: "M8 Hex Bolt" });
  });

  it("returns a null model rather than omitting the field when the asset has none", async () => {
    (db.asset.findUnique as any).mockResolvedValue({
      ...buildAsset(),
      assetModel: null,
    });

    const result = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );

    const body = await (result as unknown as Response).json();

    expect(body.asset.assetModel).toBeNull();
  });
});

/**
 * Which identifier the detail screen is told to show.
 *
 * A workspace that labels its assets with Code 128 must see Code 128 here.
 * The screen cannot work this out for itself — it never receives the
 * workspace preference — so the endpoint resolves it, exactly as it resolves
 * the image cascade, and an installed build inherits the answer with no app
 * release.
 *
 * Same precedence as every web asset row: a per-asset override first, then
 * the workspace preference, then the Shelf QR.
 *
 * @see {@link file://../../../app/modules/barcode/display.ts} `resolveDisplayCode`
 */
describe("GET /api/mobile/assets/:assetId — display code", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseBarcodes: true,
      canUseAudits: false,
      canSeeAllCustody: true,
    });
    (canUseBarcodes as any).mockReturnValue(true);
  });

  /** Runs the loader and returns the parsed `asset` payload. */
  async function loadAsset() {
    const response = await loader(
      createLoaderArgs({
        request: createDetailRequest(),
        params: { assetId: "asset-1" },
      })
    );
    const body = await (response as unknown as Response).json();
    return body.asset;
  }

  it("sends the workspace's Code 128 value, not the Shelf QR", async () => {
    // why: this is the reported bug — a workspace that prints Code 128 labels
    // was shown the native Shelf QR on the asset detail screen.
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
        barcodes: [{ id: "bc-1", type: "Code128", value: "CODE-000128" }],
      })
    );

    const asset = await loadAsset();

    expect(asset.displayCode).toEqual({
      value: "CODE-000128",
      label: "Code 128",
      type: "Code128",
      isFallback: false,
    });
  });

  it("marks a preference it could not honour instead of silently showing the QR", async () => {
    // why: workspace wants Code 128 but this asset has none. The value has to
    // fall back to the QR, and the screen must be able to say so.
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
        barcodes: [],
      })
    );

    const asset = await loadAsset();

    expect(asset.displayCode).toEqual({
      value: "qr-abc123",
      label: "QR Code ID",
      type: "QR_ID",
      isFallback: true,
    });
  });

  it("lets a per-asset override outrank the workspace preference", async () => {
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
        preferredBarcodeId: "bc-2",
        barcodes: [
          { id: "bc-1", type: "Code128", value: "CODE-000128" },
          { id: "bc-2", type: "Code39", value: "OVERRIDE-9" },
        ],
      })
    );

    const asset = await loadAsset();

    expect(asset.displayCode).toMatchObject({
      value: "OVERRIDE-9",
      label: "Code 39",
    });
  });

  it("sends the SAM ID when that is the workspace preference", async () => {
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({ qrIdDisplayPreference: "SAM_ID" })
    );

    const asset = await loadAsset();

    expect(asset.displayCode).toMatchObject({
      value: "SAM-0017",
      label: "SAM ID",
      isFallback: false,
    });
  });

  it("sends the QR id on the stock preference", async () => {
    (db.asset.findUnique as any).mockResolvedValue(buildAsset());

    const asset = await loadAsset();

    expect(asset.displayCode).toMatchObject({
      value: "qr-abc123",
      label: "QR Code ID",
      isFallback: false,
    });
  });

  it("withholds barcode rows and the preference from a workspace without the add-on", async () => {
    // why: barcode rows are add-on data. Without the add-on the workspace must
    // neither receive them nor resolve through them, matching every other
    // mobile barcode surface.
    (canUseBarcodes as any).mockReturnValue(false);
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: false,
        barcodes: [{ id: "bc-1", type: "Code128", value: "CODE-000128" }],
      })
    );

    const asset = await loadAsset();

    expect(asset.barcodes).toEqual([]);
    expect(asset.displayCode).toMatchObject({
      value: "qr-abc123",
      type: "QR_ID",
      isFallback: true,
    });
  });

  it("ships the asset's barcodes so the screen can offer a code switcher", async () => {
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
        barcodes: [{ id: "bc-1", type: "Code128", value: "CODE-000128" }],
      })
    );

    const asset = await loadAsset();

    expect(asset.barcodes).toEqual([
      { id: "bc-1", type: "Code128", value: "CODE-000128" },
    ]);
  });

  it("keeps organization narrowed to currency, leaking no workspace settings", async () => {
    // why: the select was widened to resolve the code. The response must not
    // start carrying workspace configuration the companion never asked for.
    (db.asset.findUnique as any).mockResolvedValue(
      buildAssetWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
      })
    );

    const asset = await loadAsset();

    expect(asset.organization).toEqual({ currency: "USD" });
    expect(asset.preferredBarcodeId).toBeUndefined();
  });
});
