/**
 * Regression tests for the mobile assets list endpoint.
 *
 * Covers the `myCustody=true` filter — Phase 2/4 widened `Asset.custody` from
 * 1:1 to 1:many, so this loader's where clause MUST wrap the custodian
 * traversal in `{ some: ... }`. Without `some:`, Prisma rejects the where at
 * runtime and the companion's Custody tab returns 500 (the bug this test
 * pins against).
 *
 * Also exercises the back-compat response shape: the loader must pipe assets
 * through `shapeMobileAssetResponse` so the in-App-Store companion (since
 * 2026-05-20) keeps receiving the legacy flat `kit` / `kitId` / `location` /
 * single-or-null `custody` shape rather than the new pivot arrays. That
 * flattening keeps only the FIRST kit membership, so the kit cases below pin
 * both halves of what makes the resulting label honest: a deterministic order
 * on the pivot, and the `kitCount` that says the named kit is one of several.
 *
 * @see {@link file://./assets.ts} for the loader under test
 * @see {@link file://./../../../modules/api/mobile-auth.server.ts} for the helper + select
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { canUseBarcodes } from "~/utils/subscription.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";

import { loader } from "~/routes/api+/mobile+/assets";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary we want to assert against — the test's
// whole point is to inspect the `where` clause Prisma receives, so we mock
// `db.asset.findMany` + `count` to a jest spy. (vi.mock calls hoist above the
// imports above at runtime, so importing `db` doesn't load the real module.)
// `$queryRaw` is mocked too — the search resolver now runs the shared
// org-scoped UNION as a raw query instead of a Prisma multi-table OR.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    // The loader reads the workspace's code preference once per page, to
    // resolve which identifier each row shows.
    organization: { findUniqueOrThrow: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

// why: `subscription.server` loads the Stripe client and billing config at
// module load. Stubbing the capability helper also puts the add-on gate under
// explicit control, independent of the ambient `ENABLE_PREMIUM_FEATURES`.
vi.mock("~/utils/subscription.server", () => ({
  canUseBarcodes: vi.fn(() => true),
}));

// why: auth + org-access are out of scope for these route-shape tests; stub
// them to always resolve to a fixed user + org so the loader can run.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  // Pull in the real `shapeMobileAssetResponse` so the response-shape
  // assertion exercises the actual helper, not a stub. Only the auth +
  // org-access functions need stubbing.
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    // why: the route now resolves custody visibility here. Default the
    // existing shape assertions to "may see all" so they keep measuring the
    // shaper, not the custody gate — which has its own tests below.
    getMobileUserContext: vi.fn().mockResolvedValue({
      canSeeAllCustody: true,
    }),
  };
});

const findManyMock = vi.mocked(db.asset.findMany);
const countMock = vi.mocked(db.asset.count);
const queryRawMock = vi.mocked(db.$queryRaw);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);

const FAKE_USER_ID = "user-abc";
const FAKE_ORG_ID = "org-xyz";

beforeEach(() => {
  vi.clearAllMocks();

  requireMobileAuthMock.mockResolvedValue({
    user: { id: FAKE_USER_ID },
    // why: loader only reads `.user.id` — keep the rest minimal.
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(FAKE_ORG_ID);

  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);
  // Default workspace: the stock QR_ID preference, no alternative codes. The
  // display-code tests override exactly what they are about.
  vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
    qrIdDisplayPreference: "QR_ID",
    barcodesEnabled: false,
  } as never);
  // why: default to no search matches — tests that exercise search override
  // this to a known id set.
  queryRawMock.mockResolvedValue([]);
});

describe("GET /api/mobile/assets", () => {
  it("uses `some:` to traverse the 1:many Custody relation when myCustody=true", async () => {
    // Regression: the original code used the 1:1 syntax
    // `custody: { custodian: { userId } }` which Prisma rejects on the now
    // 1:many `Asset.custody[]` relation. Must be wrapped in `some:`.
    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?myCustody=true"
      ),
    });

    await loader(args);

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const findManyCall = findManyMock.mock.calls[0]![0]!;
    expect(findManyCall.where).toMatchObject({
      organizationId: FAKE_ORG_ID,
      custody: {
        some: {
          custodian: { userId: FAKE_USER_ID },
        },
      },
    });
  });

  it("omits the custody filter entirely when myCustody is not set", async () => {
    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    await loader(args);

    const findManyCall = findManyMock.mock.calls[0]![0]!;
    expect(findManyCall.where).not.toHaveProperty("custody");
  });

  it("flattens assetKits / assetLocations / custody pivots in the response", async () => {
    // why: anchors the response contract for the in-App-Store companion —
    // it reads `asset.kit`, `asset.kitId`, `asset.location`,
    // `asset.custody?.custodian` as flat single-or-null fields. The loader
    // must shape pivot arrays into that flat form via
    // `shapeMobileAssetResponse`.
    findManyMock.mockResolvedValueOnce([
      {
        id: "asset-1",
        title: "Drill",
        status: "AVAILABLE",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
        availableToBook: true,
        category: { id: "cat-1", name: "Tools" },
        assetKits: [{ kit: { id: "kit-1", name: "Toolkit" } }],
        assetLocations: [{ location: { id: "loc-1", name: "Workshop" } }],
        custody: [{ custodian: { id: "tm-1", name: "Alice" } }],
      },
      // No-pivot variant — every flattened field must be null.
      {
        id: "asset-2",
        title: "Hammer",
        status: "AVAILABLE",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
        availableToBook: true,
        category: null,
        assetKits: [],
        assetLocations: [],
        custody: [],
      },
    ] as never);

    countMock.mockResolvedValueOnce(2);

    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    const response = await loader(args);
    assertIsDataWithResponseInit(response);
    const body = response.data as {
      assets: Array<{
        id: string;
        kit: { id: string; name: string } | null;
        kitId: string | null;
        location: { id: string; name: string } | null;
        custody: { custodian: { id: string; name: string } } | null;
        mainImageExpiration: unknown;
        thumbnailImage: unknown;
      }>;
    };

    expect(body.assets[0]).toMatchObject({
      id: "asset-1",
      kit: { id: "kit-1", name: "Toolkit" },
      kitId: "kit-1",
      location: { id: "loc-1", name: "Workshop" },
      custody: { custodian: { id: "tm-1", name: "Alice" } },
    });
    // List-only extras survive the helper round-trip.
    expect(body.assets[0]).toHaveProperty("mainImageExpiration");
    expect(body.assets[0]).toHaveProperty("thumbnailImage");

    expect(body.assets[1]).toMatchObject({
      id: "asset-2",
      kit: null,
      kitId: null,
      location: null,
      custody: null,
    });
  });

  it("orders kit memberships oldest-first so a row always names the same kit", async () => {
    // `shapeMobileAssetResponse` takes `assetKits[0]`, and only INDIVIDUAL
    // assets are capped at one membership — so an unordered relation lets a
    // quantity-tracked asset name a different kit on each refresh. Oldest
    // first (id breaking same-transaction ties) is the primary kit the web
    // asset index picks, so the two surfaces agree.
    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    await loader(args);

    expect(findManyMock.mock.calls[0]![0]!.select).toMatchObject({
      assetKits: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    });
  });

  it("reports how many kits an asset belongs to alongside the named one", async () => {
    // The row can only show one name, so `kitCount` is what stops it from
    // presenting the primary kit of three as the asset's only kit.
    findManyMock.mockResolvedValueOnce([
      {
        id: "asset-multi",
        title: "Gaffer tape",
        status: "AVAILABLE",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
        availableToBook: true,
        category: null,
        type: "QUANTITY_TRACKED",
        quantity: 30,
        assetKits: [
          { kit: { id: "kit-1", name: "Camera Kit" } },
          { kit: { id: "kit-2", name: "Audio Kit" } },
        ],
        assetLocations: [],
        custody: [],
      },
      {
        id: "asset-single",
        title: "Tripod",
        status: "AVAILABLE",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
        availableToBook: true,
        category: null,
        assetKits: [{ kit: { id: "kit-1", name: "Camera Kit" } }],
        assetLocations: [],
        custody: [],
      },
      {
        id: "asset-kitless",
        title: "Clapperboard",
        status: "AVAILABLE",
        mainImage: null,
        mainImageExpiration: null,
        thumbnailImage: null,
        availableToBook: true,
        category: null,
        assetKits: [],
        assetLocations: [],
        custody: [],
      },
    ] as never);
    countMock.mockResolvedValueOnce(3);

    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/assets"),
      })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as {
      assets: Array<{
        id: string;
        kit: { id: string; name: string } | null;
        kitCount: number;
      }>;
    };

    // The named kit is the first membership the (ordered) select returned.
    expect(body.assets[0]).toMatchObject({
      kit: { id: "kit-1", name: "Camera Kit" },
      kitCount: 2,
    });
    expect(body.assets[1]).toMatchObject({ kitCount: 1 });
    expect(body.assets[2]).toMatchObject({ kit: null, kitCount: 0 });
  });

  it("sends mainImageExpiration only when the asset's own image won the cascade", async () => {
    // why: expiration describes the asset's OWN signed URL only. A model
    // cover is a public URL that never expires, and the row's date can be
    // stale residue from a removed own image — a client-side expiry check
    // fed that pairing discards a valid image. This pins the source gate.
    findManyMock.mockResolvedValueOnce([
      // Own image: the signed URL and its expiration travel together.
      {
        id: "asset-own",
        title: "Own image",
        status: "AVAILABLE",
        mainImage: "https://supabase.test/sign/assets/own.png",
        thumbnailImage: "https://supabase.test/sign/assets/own-thumbnail.png",
        mainImageExpiration: "2026-08-01T00:00:00.000Z",
        availableToBook: true,
        category: null,
        assetModel: null,
        assetKits: [],
        assetLocations: [],
        custody: [],
      },
      // Inherited image: stale per-asset expiration residue must NOT ship
      // next to the model's never-expiring public URL.
      {
        id: "asset-inherited",
        title: "Inherited image",
        status: "AVAILABLE",
        mainImage: null,
        thumbnailImage: null,
        mainImageExpiration: "2026-08-01T00:00:00.000Z",
        availableToBook: true,
        category: null,
        assetModel: {
          image: "https://supabase.test/public/files/model.png",
          thumbnailImage:
            "https://supabase.test/public/files/model-thumbnail.png",
        },
        assetKits: [],
        assetLocations: [],
        custody: [],
      },
    ] as never);

    // why: the loader runs findMany + count in parallel for the pagination
    // envelope; the count must match the two mocked rows above.
    countMock.mockResolvedValueOnce(2);

    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    const response = await loader(args);
    assertIsDataWithResponseInit(response);
    const body = response.data as {
      assets: Array<{
        id: string;
        mainImage: string | null;
        imageSource: string;
        mainImageExpiration: string | null;
      }>;
    };

    expect(body.assets[0]).toMatchObject({
      id: "asset-own",
      mainImage: "https://supabase.test/sign/assets/own.png",
      imageSource: "asset",
      mainImageExpiration: "2026-08-01T00:00:00.000Z",
    });
    expect(body.assets[1]).toMatchObject({
      id: "asset-inherited",
      mainImage: "https://supabase.test/public/files/model.png",
      imageSource: "model",
      mainImageExpiration: null,
    });
  });
});

describe("GET /api/mobile/assets — status filter", () => {
  it("returns 400 for an unknown status instead of silently unfiltering", async () => {
    // Regression: an unrecognized status used to reach Prisma and 500;
    // a later guard silently dropped the filter, which returned the FULL
    // list under what the client believes is a filtered request. The
    // contract is a loud 400.
    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?status=toString"
      ),
    });

    const response = await loader(args);
    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(
      (response.data as { error: { message: string } }).error.message
    ).toContain("Invalid status filter");
    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });

  it("makes AVAILABLE QT-aware via the shared fragment", async () => {
    // A QUANTITY_TRACKED row's status flips as soon as ANY unit is
    // allocated even while free stock remains — raw equality would hide it
    // from the Available pill. Mirrors getAssets.
    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?status=AVAILABLE"
      ),
    });

    await loader(args);

    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where.AND).toEqual([
      {
        OR: [
          { type: "INDIVIDUAL", status: "AVAILABLE" },
          { type: "QUANTITY_TRACKED" },
        ],
      },
    ]);
    expect(where).not.toHaveProperty("status");
  });

  it("keeps raw equality for non-AVAILABLE statuses", async () => {
    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?status=IN_CUSTODY"
      ),
    });

    await loader(args);

    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ status: "IN_CUSTODY" });
    expect(where).not.toHaveProperty("AND");
  });
});

describe("GET /api/mobile/assets — search", () => {
  it("resolves a search via the shared UNION into a single query", async () => {
    // The endpoint now runs one query: the org-scoped UNION resolves the
    // matching asset ids (mocked via db.$queryRaw), and those ids are ANDed
    // into the same findMany/count call — no narrow/fallback re-query.
    queryRawMock.mockResolvedValueOnce([{ id: "asset-1" }, { id: "asset-2" }]);
    countMock.mockResolvedValueOnce(2);

    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?search=tripod"
      ),
    });

    await loader(args);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({
      organizationId: FAKE_ORG_ID,
      id: { in: ["asset-1", "asset-2"] },
    });
  });

  it("id-shaped searches also resolve via the single UNION query (superset, pre-approved)", async () => {
    // Previously ID-shaped terms took a narrow indexed fast path with a
    // full-clause fallback on zero rows. The UNION always searches all 10
    // sources in one query, so an ID-shaped search now returns the full
    // (more correct) result set directly — no second query.
    queryRawMock.mockResolvedValueOnce([{ id: "asset-9" }]);
    countMock.mockResolvedValueOnce(1);

    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?search=SAM-0001"
      ),
    });

    await loader(args);

    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ id: { in: ["asset-9"] } });
  });

  it("does not run the UNION or filter by id for an empty search", async () => {
    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    await loader(args);

    expect(queryRawMock).not.toHaveBeenCalled();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where).not.toHaveProperty("id");
  });

  it("matches nothing (not everything) for whitespace/comma-only search", async () => {
    // In a debounced type-ahead a single typed space must not flash the
    // full unfiltered list.
    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?search=%20%2C%20"
      ),
    });

    await loader(args);

    expect(queryRawMock).not.toHaveBeenCalled();
    expect(findManyMock).toHaveBeenCalledTimes(1);
    const where = findManyMock.mock.calls[0]![0]!.where!;
    expect(where).toMatchObject({ id: { in: [] } });
  });

  it("pages deterministically with an id tiebreaker", async () => {
    const args = createLoaderArgs({
      request: new Request("http://localhost:3000/api/mobile/assets"),
    });

    await loader(args);

    expect(findManyMock.mock.calls[0]![0]!.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("GET /api/mobile/assets — custody visibility", () => {
  /** One asset held by a colleague, shaped as the select returns it. */
  const colleaguesAsset = {
    id: "asset-1",
    title: "Camera",
    status: "IN_CUSTODY",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    assetModel: null,
    availableToBook: true,
    category: null,
    type: "INDIVIDUAL",
    quantity: null,
    minQuantity: null,
    unitOfMeasure: null,
    consumptionType: null,
    assetKits: [],
    assetLocations: [],
    custody: [
      {
        quantity: 1,
        kitCustodyId: null,
        custodian: {
          id: "tm-colleague",
          name: "Colleague Name",
          userId: "someone-else",
        },
      },
    ],
  };

  beforeEach(() => {
    findManyMock.mockResolvedValue([colleaguesAsset] as never);
    vi.mocked(db.asset.count).mockResolvedValue(1 as never);
  });

  it("hides a colleague's custody from a viewer who may not see all custody", async () => {
    // The mobile asset DETAIL route gated this; the list did not, so the same
    // holder name was readable one endpoint over.
    vi.mocked(getMobileUserContext).mockResolvedValue({
      canSeeAllCustody: false,
    } as Awaited<ReturnType<typeof getMobileUserContext>>);

    const response = await loader(createLoaderArgs({}));
    const body = (response as any).data ?? (await (response as any).json());

    expect(body.assets[0].custody).toBeNull();
    expect(body.assets[0].custodyList).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Colleague Name");
  });

  it("keeps the viewer's OWN custody visible to a restricted viewer", async () => {
    // The direction the other two cases miss. Hiding here would take an item
    // away from the person actually holding it, and the gate is supposed to
    // reject on OWNERSHIP, not on the role alone.
    // why: same fixture as above with the custodian re-pointed at the caller —
    // isolates ownership as the only variable.
    findManyMock.mockResolvedValue([
      {
        ...colleaguesAsset,
        custody: [
          {
            ...colleaguesAsset.custody[0],
            custodian: {
              ...colleaguesAsset.custody[0].custodian,
              userId: FAKE_USER_ID,
            },
          },
        ],
      },
    ] as never);
    vi.mocked(getMobileUserContext).mockResolvedValue({
      canSeeAllCustody: false,
    } as Awaited<ReturnType<typeof getMobileUserContext>>);

    const response = await loader(createLoaderArgs({}));
    const body = (response as any).data ?? (await (response as any).json());

    expect(body.assets[0].custody).not.toBeNull();
    expect(body.assets[0].custodyList).toHaveLength(1);
  });

  it("keeps custody visible for a viewer who may see all of it", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue({
      canSeeAllCustody: true,
    } as Awaited<ReturnType<typeof getMobileUserContext>>);

    const response = await loader(createLoaderArgs({}));
    const body = (response as any).data ?? (await (response as any).json());

    expect(body.assets[0].custody?.custodian?.name).toBe("Colleague Name");
  });
});

/**
 * Which identifier each list row shows.
 *
 * The list is where an operator matches a shelf full of printed labels against
 * the app, so a workspace that labels its assets with Code 128 must see Code
 * 128 on the rows — not the SAM ID the rows used to hardcode.
 *
 * Resolved server-side, once per page, by the same resolver every web asset
 * row uses.
 *
 * @see {@link file://./../../../../app/modules/barcode/display.ts} `resolveDisplayCode`
 */
describe("GET /api/mobile/assets — display code", () => {
  /** One list row carrying the code-resolution inputs the loader selects. */
  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: "asset-1",
      title: "Drill",
      status: "AVAILABLE",
      sequentialId: "SAM-0017",
      mainImage: null,
      mainImageExpiration: null,
      thumbnailImage: null,
      availableToBook: true,
      category: null,
      assetKits: [],
      assetLocations: [],
      custody: [],
      preferredBarcodeId: null,
      qrCodes: [{ id: "qr-abc123" }],
      barcodes: [] as { id: string; type: string; value: string }[],
      ...overrides,
    };
  }

  /** Runs the loader over one row and returns it as the response shaped it. */
  async function loadRow(fixture: unknown) {
    findManyMock.mockResolvedValueOnce([fixture] as never);
    countMock.mockResolvedValueOnce(1);
    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/assets"),
      })
    );
    assertIsDataWithResponseInit(response);
    return (
      response.data as {
        assets: {
          displayCode: {
            value: string;
            label: string;
            isFallback: boolean;
          } | null;
        }[];
      }
    ).assets[0];
  }

  it("shows the workspace's Code 128 value on the row, not the SAM ID", async () => {
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      qrIdDisplayPreference: "Code128",
      barcodesEnabled: true,
    } as never);
    vi.mocked(canUseBarcodes).mockReturnValue(true);

    const asset = await loadRow(
      row({ barcodes: [{ id: "bc-1", type: "Code128", value: "CODE-000128" }] })
    );

    expect(asset.displayCode).toEqual({
      value: "CODE-000128",
      label: "Code 128",
      type: "Code128",
      isFallback: false,
    });
  });

  it("shows the SAM ID when that is the workspace preference", async () => {
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      qrIdDisplayPreference: "SAM_ID",
      barcodesEnabled: false,
    } as never);
    vi.mocked(canUseBarcodes).mockReturnValue(false);

    const asset = await loadRow(row());

    expect(asset.displayCode).toMatchObject({
      value: "SAM-0017",
      label: "SAM ID",
      isFallback: false,
    });
  });

  it("marks a preference this row cannot satisfy", async () => {
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      qrIdDisplayPreference: "Code128",
      barcodesEnabled: true,
    } as never);
    vi.mocked(canUseBarcodes).mockReturnValue(true);

    const asset = await loadRow(row({ barcodes: [] }));

    expect(asset.displayCode).toMatchObject({
      value: "qr-abc123",
      isFallback: true,
    });
  });

  it("reads the workspace preference once per page, not once per row", async () => {
    // why: the preference is per-workspace. Resolving it per row would issue
    // `perPage` identical queries on every list load.
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: false,
    } as never);
    findManyMock.mockResolvedValueOnce([
      row(),
      row({ id: "asset-2" }),
    ] as never);
    countMock.mockResolvedValueOnce(2);

    await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/assets"),
      })
    );

    expect(db.organization.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });
});
