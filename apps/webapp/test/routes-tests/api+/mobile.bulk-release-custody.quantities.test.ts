/**
 * The mobile bulk release-custody endpoint, from the per-unit angle.
 *
 * The companion's Scan tab sends one request per submit: whole assets in
 * `assetIds`, and a `quantities` map for its quantity-tracked rows. A release
 * names no custodian, so each per-unit release goes to the asset's single
 * operator holder. These pin the split, that every per-unit release is checked
 * before any is written, and that a body without the map is handled as before.
 *
 * The other angles (role forwarding, skipped count) live in
 * `mobile.bulk-release-custody.test.ts` beside this file.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/bulk-release-custody.ts}
 * @see {@link file://./../../../app/modules/custody/quantity-custody.server.ts}
 */
import { createActionArgs } from "@mocks/remix";
import {
  bulkCheckInAssets,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { createNote } from "~/modules/note/service.server";
import { action } from "~/routes/api+/mobile+/bulk-release-custody";
import { ShelfError } from "~/utils/error";

// @vitest-environment node

// why: mocking Remix's data() so the action returns a real Response
const createDataMock = vitest.hoisted(
  () => () =>
    vitest.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth, no Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vitest.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vitest.fn().mockResolvedValue(undefined),
  getMobileUserContext: vitest.fn().mockResolvedValue({
    role: "ADMIN",
    canUseBarcodes: false,
    canSeeAllCustody: true,
  }),
}));

// why: the rate limiter keeps in-process counters across tests
vitest.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vitest.fn().mockResolvedValue(undefined),
}));

// why: exercising the route's split and holder checks, not the custody writes
vitest.mock("~/modules/asset/service.server", () => ({
  bulkCheckInAssets: vitest
    .fn()
    .mockResolvedValue({ success: true, skippedQuantityTracked: 0 }),
  releaseQuantity: vitest.fn().mockResolvedValue({ consumed: 0, returned: 3 }),
}));

// why: the holder lookup reads operator custody rows straight off the table
const dbMocks = vitest.hoisted(() => ({
  custodyFindMany: vitest.fn(),
  assetFindFirst: vitest.fn(({ where }: { where: { id: string } }) =>
    Promise.resolve({ title: `Asset ${where.id}` })
  ),
}));
vitest.mock("~/database/db.server", () => ({
  db: {
    custody: { findMany: dbMocks.custodyFindMany },
    // A refused release names its asset.
    asset: { findFirst: dbMocks.assetFindFirst },
  },
}));

// why: index settings are forwarded to the bulk call, not under test
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vitest.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: each per-unit release writes an audit note and runs the low-stock
// check; their content is pinned in the shared module's suite
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn(),
}));
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  }),
}));
vitest.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vitest.fn(),
}));

/** An operator custody row as the shared holder lookup selects it. */
function holder(
  assetId: string,
  teamMemberId: string,
  quantity = 10,
  userId: string | null = null
) {
  return {
    assetId,
    quantity,
    asset: { title: `Asset ${assetId}` },
    custodian: {
      id: teamMemberId,
      name: `Member ${teamMemberId}`,
      user: userId
        ? { id: userId, firstName: null, lastName: null, displayName: null }
        : null,
    },
  };
}

async function submit(body: Record<string, unknown>) {
  const request = new Request(
    "http://localhost/api/mobile/bulk-release-custody?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const response = (await action(
    createActionArgs({ request })
  )) as unknown as Response;
  return { status: response.status, body: await response.json() };
}

describe("POST /api/mobile/bulk-release-custody with quantities", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("releases the named units from the single holder and sends only whole assets to the bulk call", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("qty-1", "tm-1")]);

    const { status, body } = await submit({
      assetIds: ["asset-1", "qty-1"],
      quantities: { "qty-1": 3 },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, skippedQuantityTracked: 0 });
    expect(releaseQuantity).toHaveBeenCalledTimes(1);
    expect(releaseQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "qty-1",
        teamMemberId: "tm-1",
        quantity: 3,
        organizationId: "org-1",
        role: "ADMIN",
      })
    );
    expect(bulkCheckInAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-1"] })
    );
    // Only operator-assigned rows are holders; kit custody goes with the kit.
    expect(dbMocks.custodyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kitCustodyId: null }),
      })
    );
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("skips the bulk call when every asset carries a quantity", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("qty-1", "tm-1"),
      holder("qty-2", "tm-2"),
    ]);

    const { status } = await submit({
      assetIds: ["qty-1", "qty-2"],
      quantities: { "qty-1": 2, "qty-2": 4 },
    });

    expect(status).toBe(200);
    expect(releaseQuantity).toHaveBeenCalledTimes(2);
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
  });

  it("writes nothing when one asset asks for more units than its holder has", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("qty-1", "tm-1", 10),
      holder("qty-2", "tm-2", 2),
    ]);

    const { status, body } = await submit({
      assetIds: ["asset-1", "qty-1", "qty-2"],
      quantities: { "qty-1": 3, "qty-2": 5 },
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe(
      'Nothing was released. "Asset qty-2" has only 2 unit(s) in custody.'
    );
    expect(releaseQuantity).not.toHaveBeenCalled();
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
  });

  it("refuses by name when an asset is held by more than one person", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("qty-1", "tm-1"),
      holder("qty-1", "tm-2"),
    ]);

    const { status, body } = await submit({
      assetIds: ["qty-1"],
      quantities: { "qty-1": 1 },
    });

    expect(status).toBe(400);
    expect(body.error.message).toContain(
      '"Asset qty-1" is held by more than one person.'
    );
    expect(releaseQuantity).not.toHaveBeenCalled();
  });

  it("writes nothing when an asset has no operator-held units", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([]);

    const { status } = await submit({
      assetIds: ["asset-1", "qty-1"],
      quantities: { "qty-1": 1 },
    });

    expect(status).toBe(400);
    expect(releaseQuantity).not.toHaveBeenCalled();
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
  });

  it("refuses before any write when a self-service user names someone else's units", async () => {
    vitest.mocked(getMobileUserContext).mockResolvedValueOnce({
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canSeeAllCustody: false,
    } as never);
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("qty-1", "tm-self", 5, "user-1"),
      holder("qty-2", "tm-other", 5, "user-other"),
    ]);

    const { status } = await submit({
      assetIds: ["asset-1", "qty-1", "qty-2"],
      quantities: { "qty-1": 1, "qty-2": 1 },
    });

    expect(status).toBe(403);
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
    expect(releaseQuantity).not.toHaveBeenCalled();
  });

  it("reports by asset a release refused after the check, and keeps the rest", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("qty-1", "tm-1"),
      holder("qty-2", "tm-2"),
    ]);
    vitest.mocked(releaseQuantity).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        label: "Assets",
        status: 400,
        message: "Cannot release 3 units. Only 1 unit in custody.",
      })
    );

    const { status, body } = await submit({
      assetIds: ["qty-1", "qty-2"],
      quantities: { "qty-1": 3, "qty-2": 1 },
    });

    expect(status).toBe(200);
    expect(body.refusedQuantities).toEqual([
      {
        assetId: "qty-1",
        title: "Asset qty-1",
        message: "Cannot release 3 units. Only 1 unit in custody.",
      },
    ]);
    expect(releaseQuantity).toHaveBeenCalledTimes(2);
  });

  it("handles a body without quantities exactly as before", async () => {
    const { status } = await submit({ assetIds: ["asset-1", "qty-1"] });

    expect(status).toBe(200);
    expect(dbMocks.custodyFindMany).not.toHaveBeenCalled();
    expect(releaseQuantity).not.toHaveBeenCalled();
    expect(bulkCheckInAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-1", "qty-1"] })
    );
  });
});
