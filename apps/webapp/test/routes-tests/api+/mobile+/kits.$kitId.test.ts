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
    qrCodes: [],
    organization: { currency: "USD" },
    custody: null,
    assetKits,
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
