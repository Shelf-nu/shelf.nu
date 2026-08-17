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
 * single-or-null `custody` shape rather than the new pivot arrays.
 *
 * @see {@link file://./assets.ts} for the loader under test
 * @see {@link file://./../../../modules/api/mobile-auth.server.ts} for the helper + select
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
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
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
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
  it("re-queries with the full clause when an ID-shaped search matches nothing", async () => {
    // The only two-query sequence in this loader. A regression here is
    // silent (users just get zero results — the exact complaint that
    // opened this ticket), so pin the mechanism: narrow first, full on
    // zero rows, mirroring getAssets' fallback.
    countMock.mockResolvedValueOnce(0).mockResolvedValueOnce(2);

    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?search=SAM-0001"
      ),
    });

    await loader(args);

    expect(findManyMock).toHaveBeenCalledTimes(2);
    const first = findManyMock.mock.calls[0]![0]!.where!;
    const second = findManyMock.mock.calls[1]![0]!.where!;
    // Narrow clause: flat OR over the 5 indexed columns.
    expect(first.OR).toHaveLength(5);
    expect(JSON.stringify(first)).not.toContain("customFields");
    // Full clause: one 10-branch group per term, heavy branches included.
    expect(second.OR).toHaveLength(1);
    const fullGroup = (second.OR as Array<{ OR: unknown[] }>)[0]!;
    expect(fullGroup.OR).toHaveLength(10);
    expect(JSON.stringify(second)).toContain("customFields");
  });

  it("does not re-query when the narrow ID search finds rows", async () => {
    countMock.mockResolvedValueOnce(3);

    const args = createLoaderArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/assets?search=21035"
      ),
    });

    await loader(args);

    expect(findManyMock).toHaveBeenCalledTimes(1);
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
