/**
 * Response-contract tests for the mobile kit detail endpoint.
 *
 * - Each `kit.assets[]` member carries `kitQuantity` (= `AssetKit.quantity`,
 *   the units of that asset held by THIS kit), `unitOfMeasure`, and `type`.
 * - `totalValue` multiplies by the per-membership `AssetKit.quantity`, NOT the
 *   asset's workspace-wide `Asset.quantity` stock (see
 *   .claude/rules/quantity-semantics-per-surface.md).
 * - Custody is nulled for a viewer who may not see the holder.
 * - The kit's `image` is a signed URL the app cannot renew, so the kit goes
 *   through `refreshExpiredKitImages` before it is sent: a lapsed URL arrives
 *   re-signed, with the `imageExpiration` the helper returned.
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
import { refreshExpiredKitImages } from "~/modules/kit/service.server";

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

// why: re-signing calls Supabase Storage and writes the new URL back to the
// kit row. The helper has its own contract; the kit-image case below pins what
// the route does with it, and every other case gets its kit back untouched.
vi.mock("~/modules/kit/service.server", () => ({
  refreshExpiredKitImages: vi.fn((kits: unknown[]) => Promise.resolve(kits)),
}));

const findFirstMock = vi.mocked(db.kit.findFirst);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const requireMobilePermissionMock = vi.mocked(requireMobilePermission);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const refreshExpiredKitImagesMock = vi.mocked(refreshExpiredKitImages);

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

describe("GET /api/mobile/kits/:kitId — kit image", () => {
  it("sends a lapsed kit image re-signed, with its new expiry", async () => {
    const storedKit = {
      ...buildKitFixture([]),
      organizationId: FAKE_ORG_ID,
      image: "https://example.test/sign/kits/camera.png?token=lapsed",
      imageExpiration: new Date("2020-01-01T00:00:00.000Z"),
    };
    findFirstMock.mockResolvedValueOnce(storedKit as never);
    const resignedImage =
      "https://example.test/sign/kits/camera.png?token=fresh";
    const newExpiration = new Date("2099-01-01T00:00:00.000Z");
    refreshExpiredKitImagesMock.mockResolvedValueOnce([
      { ...storedKit, image: resignedImage, imageExpiration: newExpiration },
    ]);

    const response = await loader(
      createLoaderArgs({ params: { kitId: "kit-1" } })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as { kit: Record<string, unknown> };

    // The kit goes to the helper as the query returned it — `organizationId`
    // included, since the helper scopes its write-back by it.
    expect(refreshExpiredKitImagesMock).toHaveBeenCalledWith([storedKit]);
    expect(body.kit).toMatchObject({
      id: "kit-1",
      image: resignedImage,
      imageExpiration: newExpiration,
    });
    // Selected for the write-back only; the app's kit shape has no such field.
    expect(body.kit).not.toHaveProperty("organizationId");
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
    // `custodian.user.email` — without the gate the whole identity is sent.
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
