/**
 * Regression tests for the mobile kit detail endpoint.
 *
 * Pins the Gap-3 (kit quantity awareness) contract: each `kit.assets[]`
 * member must additively carry `kitQuantity` (= `AssetKit.quantity`, the
 * units of that asset held by THIS kit), `unitOfMeasure`, and `type`. It also
 * pins the `totalValue` correctness fix — the kit-surface multiplier is the
 * per-membership `AssetKit.quantity`, NOT the asset's workspace-wide
 * `Asset.quantity` stock (see .claude/rules/quantity-semantics-per-surface.md).
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/kits.$kitId.ts} for the loader under test
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

import { loader } from "~/routes/api+/mobile+/kits.$kitId";
import { canUseBarcodes } from "~/utils/subscription.server";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary we want to assert against — the test's
// whole point is inspecting the shaped response, so `db.kit.findFirst` is
// stubbed to a fixed kit fixture rather than hitting a real Prisma client.
vi.mock("~/database/db.server", () => ({
  db: {
    kit: { findFirst: vi.fn() },
  },
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests). The route only calls
// these three gate functions, so only those are stubbed.
// why: `subscription.server` loads the Stripe client and the billing config at
// module load. Stubbing the capability helper also puts the add-on gate under
// explicit control, independent of the ambient `ENABLE_PREMIUM_FEATURES`.
vi.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vi.fn(() => true),
}));

vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  // why: the route resolves custody visibility from this; each test sets the
  // flag directly rather than constructing an org whose overrides imply it.
  getMobileUserContext: vi.fn(),
}));

const findFirstMock = vi.mocked(db.kit.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const requireMobilePermissionMock = vi.mocked(requireMobilePermission);
const canUseBarcodesMock = vi.mocked(canUseBarcodes);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);

const FAKE_USER_ID = "user-abc";
const FAKE_ORG_ID = "org-xyz";

/** Base kit fixture shared across tests — override `assetKits` per test. */
function buildKitFixture(assetKits: unknown[]) {
  return {
    id: "kit-1",
    name: "Camera Kit",
    description: null,
    status: "AVAILABLE",
    image: null,
    imageExpiration: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    category: null,
    location: null,
    qrCodes: [{ id: "qr-kit-1" }],
    // Code-resolution inputs. Default describes a workspace on the stock
    // QR_ID preference with no alternative codes.
    barcodes: [] as { id: string; type: string; value: string }[],
    organization: {
      currency: "USD",
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: false,
    },
    custody: null,
    assetKits,
  };
}

/** The base fixture with its code-resolution inputs overridden. */
function buildKitWithCodes(overrides: {
  qrIdDisplayPreference?: string;
  barcodesEnabled?: boolean;
  barcodes?: { id: string; type: string; value: string }[];
}) {
  const kit = buildKitFixture([]);
  return {
    ...kit,
    barcodes: overrides.barcodes ?? [],
    organization: {
      currency: "USD",
      qrIdDisplayPreference: overrides.qrIdDisplayPreference ?? "QR_ID",
      barcodesEnabled: overrides.barcodesEnabled ?? false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  requireMobileAuthMock.mockResolvedValue({
    user: { id: FAKE_USER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(FAKE_ORG_ID);
  requireMobilePermissionMock.mockResolvedValue(undefined);
  getMobileUserContextMock.mockResolvedValue({
    canSeeAllCustody: true,
  } as Awaited<ReturnType<typeof getMobileUserContext>>);
});

describe("GET /api/mobile/kits/:kitId", () => {
  it("carries per-membership kitQuantity/unitOfMeasure/type and values by kit units, not workspace stock", async () => {
    // QUANTITY_TRACKED member: 5 units held by this kit, but 100 units of
    // workspace stock — the kit-surface multiplier must be the kit slice
    // quantity (5), not the workspace stock (100).
    const qtMember = {
      quantity: 5, // AssetKit.quantity — units of this asset in this kit
      asset: {
        id: "asset-qt",
        title: "Batteries",
        status: "AVAILABLE",
        valuation: 10,
        quantity: 100, // Asset.quantity — workspace stock (must NOT be used)
        unitOfMeasure: "pcs",
        type: "QUANTITY_TRACKED",
        mainImage: null,
        thumbnailImage: null,
        category: null,
        assetLocations: [],
      },
    };
    // INDIVIDUAL member: AssetKit.quantity is always 1.
    const individualMember = {
      quantity: 1,
      asset: {
        id: "asset-individual",
        title: "Tripod",
        status: "AVAILABLE",
        valuation: 20,
        quantity: null,
        unitOfMeasure: null,
        type: "INDIVIDUAL",
        mainImage: null,
        thumbnailImage: null,
        category: null,
        assetLocations: [],
      },
    };

    findFirstMock.mockResolvedValueOnce(
      buildKitFixture([qtMember, individualMember]) as never
    );

    const args = createLoaderArgs({
      request: new Request(
        `http://localhost:3000/api/mobile/kits/kit-1?orgId=${FAKE_ORG_ID}`
      ),
      params: { kitId: "kit-1" },
    });

    const response = await loader(args);
    assertIsDataWithResponseInit(response);
    const body = response.data as {
      kit: {
        totalValue: number;
        assets: Array<{
          id: string;
          kitQuantity: number;
          unitOfMeasure: string | null;
          type: string;
          valuation: number | null;
        }>;
      };
    };

    const qtAsset = body.kit.assets.find((a) => a.id === "asset-qt");
    expect(qtAsset).toMatchObject({
      kitQuantity: 5,
      unitOfMeasure: "pcs",
      type: "QUANTITY_TRACKED",
    });

    const individualAsset = body.kit.assets.find(
      (a) => a.id === "asset-individual"
    );
    expect(individualAsset).toMatchObject({
      kitQuantity: 1,
      unitOfMeasure: null,
      type: "INDIVIDUAL",
    });

    // 10 × 5 (kit units) + 20 × 1 (individual) = 70.
    // NOT 10 × 100 (workspace stock) + 20 × 1 = 1020.
    expect(body.kit.totalValue).toBe(70);
  });
});

describe("GET /api/mobile/kits/:kitId — custody visibility", () => {
  /** Kit fixture holding custody by a named colleague, with their email. */
  function kitInColleaguesCustody() {
    return {
      ...buildKitFixture([]),
      custody: {
        createdAt: new Date("2026-01-01"),
        custodian: {
          id: "tm-colleague",
          name: "Colleague",
          userId: "someone-else",
          user: {
            firstName: "Colleague",
            lastName: "Name",
            email: "colleague@example.com",
          },
        },
      },
    };
  }

  it("nulls a colleague's custody for a viewer who may not see all custody", async () => {
    // `kit: read` is held by BASE and SELF_SERVICE, and this select reaches
    // `custodian.user.email` — so without a gate the whole identity shipped.
    getMobileUserContextMock.mockResolvedValue({
      canSeeAllCustody: false,
    } as Awaited<ReturnType<typeof getMobileUserContext>>);
    findFirstMock.mockResolvedValue(kitInColleaguesCustody() as never);

    const response = await loader(
      createLoaderArgs({ params: { kitId: "kit-1" } })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as { kit: { custody: any } };

    expect(body.kit.custody).toBeNull();
    expect(JSON.stringify(body)).not.toContain("colleague@example.com");
  });

  it("keeps the viewer's OWN custody visible", async () => {
    getMobileUserContextMock.mockResolvedValue({
      canSeeAllCustody: false,
    } as Awaited<ReturnType<typeof getMobileUserContext>>);
    const own = kitInColleaguesCustody();
    own.custody.custodian.userId = FAKE_USER_ID;
    findFirstMock.mockResolvedValue(own as never);

    const response = await loader(
      createLoaderArgs({ params: { kitId: "kit-1" } })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as { kit: { custody: any } };

    // Over-redacting here would hide a kit from the person actually holding it.
    expect(body.kit.custody).not.toBeNull();
  });

  it("keeps custody visible for a viewer who may see all of it", async () => {
    findFirstMock.mockResolvedValue(kitInColleaguesCustody() as never);

    const response = await loader(
      createLoaderArgs({ params: { kitId: "kit-1" } })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as { kit: { custody: any } };

    expect(body.kit.custody?.custodian?.name).toBe("Colleague");
  });
});

/**
 * Which identifier the kit detail screen is told to show.
 *
 * Same contract and resolver as the asset detail endpoint. Kits carry no SAM
 * ID and no per-kit override, so a workspace preferring SAM IDs resolves to
 * the Shelf QR and the result is marked as a fallback.
 *
 * @see {@link file://./../../../../app/modules/barcode/display.ts} `resolveDisplayCode`
 */
describe("GET /api/mobile/kits/:kitId — display code", () => {
  /** Runs the loader against a fixture and returns the shaped kit. */
  async function loadKit(fixture: unknown) {
    findFirstMock.mockResolvedValueOnce(fixture as never);
    const response = await loader(
      createLoaderArgs({
        request: new Request(
          `http://localhost:3000/api/mobile/kits/kit-1?orgId=${FAKE_ORG_ID}`
        ),
        params: { kitId: "kit-1" },
      })
    );
    assertIsDataWithResponseInit(response);
    return (
      response.data as {
        kit: {
          displayCode: {
            value: string;
            label: string;
            type: string;
            isFallback: boolean;
          } | null;
          barcodes: { id: string; type: string; value: string }[];
          organization: { currency: string };
        };
      }
    ).kit;
  }

  it("sends the workspace's Code 128 value, not the Shelf QR", async () => {
    canUseBarcodesMock.mockReturnValue(true);

    const kit = await loadKit(
      buildKitWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
        barcodes: [{ id: "bc-k1", type: "Code128", value: "KIT-000042" }],
      })
    );

    expect(kit.displayCode).toEqual({
      value: "KIT-000042",
      label: "Code 128",
      type: "Code128",
      isFallback: false,
    });
    expect(kit.barcodes).toEqual([
      { id: "bc-k1", type: "Code128", value: "KIT-000042" },
    ]);
  });

  it("falls back to the QR for a SAM ID preference, since kits have no SAM ID", async () => {
    // why: `Kit` has no `sequentialId` column. The fallback must be MARKED so
    // the screen can explain itself rather than appearing to ignore the
    // workspace setting.
    canUseBarcodesMock.mockReturnValue(true);

    const kit = await loadKit(
      buildKitWithCodes({ qrIdDisplayPreference: "SAM_ID" })
    );

    expect(kit.displayCode).toEqual({
      value: "qr-kit-1",
      label: "QR Code ID",
      type: "QR_ID",
      isFallback: true,
    });
  });

  it("withholds barcode rows from a workspace without the add-on", async () => {
    canUseBarcodesMock.mockReturnValue(false);

    const kit = await loadKit(
      buildKitWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: false,
        barcodes: [{ id: "bc-k1", type: "Code128", value: "KIT-000042" }],
      })
    );

    expect(kit.barcodes).toEqual([]);
    expect(kit.displayCode).toMatchObject({ type: "QR_ID", isFallback: true });
  });

  it("keeps organization narrowed to currency, leaking no workspace settings", async () => {
    canUseBarcodesMock.mockReturnValue(true);

    const kit = await loadKit(
      buildKitWithCodes({
        qrIdDisplayPreference: "Code128",
        barcodesEnabled: true,
      })
    );

    expect(kit.organization).toEqual({ currency: "USD" });
  });
});
