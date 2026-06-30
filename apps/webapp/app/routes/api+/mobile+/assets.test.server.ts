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
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";

import { loader } from "./assets";

import { assertIsDataWithResponseInit } from "../../../../test/helpers/assertions";

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
