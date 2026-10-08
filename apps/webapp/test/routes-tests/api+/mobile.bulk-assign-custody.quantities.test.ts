/**
 * The mobile bulk assign-custody endpoint, from the per-unit angle.
 *
 * The companion's Scan tab sends one request per submit: whole assets in
 * `assetIds`, and a `quantities` map for its quantity-tracked rows. These pin
 * the split, that every per-unit assignment is checked before any is written,
 * and that a body without the map is handled exactly as before.
 *
 * The other angles (select-all sentinel, role forwarding, 404 custodian) live
 * in `mobile.bulk-assign-custody.test.ts` beside this file.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/bulk-assign-custody.ts}
 * @see {@link file://./../../../app/modules/custody/quantity-custody.server.ts}
 */
import { createActionArgs } from "@mocks/remix";
import { computeCustodyAvailability } from "~/modules/asset/availability-primitives.server";
import {
  bulkCheckOutAssets,
  checkOutQuantity,
} from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { action } from "~/routes/api+/mobile+/bulk-assign-custody";
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
  // why: the caller's access is what the route reads; build it from the real
  // policy for an Administrator.
  getMobileUserContext: vitest.fn(async () =>
    (await import("@helpers/mobile-user-context")).mobileUserContext({
      roles: ["ADMIN"] as never,
    })
  ),
}));

// why: the rate limiter keeps in-process counters across tests
vitest.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vitest.fn().mockResolvedValue(undefined),
}));

// why: exercising the route's split and pre-flight, not the custody writes;
// `checkOutQuantity` reports a source with nothing to name, as for a pool at
// one location
vitest.mock("~/modules/asset/service.server", () => ({
  bulkCheckOutAssets: vitest
    .fn()
    .mockResolvedValue({ success: true, skippedQuantityTracked: 0 }),
  checkOutQuantity: vitest.fn().mockResolvedValue({
    source: {
      locationId: null,
      locationName: null,
      explicit: false,
      multiSource: false,
    },
  }),
}));

// why: the pre-flight's free-unit count is the availability leaf's job
vitest.mock("~/modules/asset/availability-primitives.server", () => ({
  computeCustodyAvailability: vitest.fn(),
}));

// why: the pre-flight reads each named asset's title and stock
const dbMocks = vitest.hoisted(() => ({ assetFindFirst: vitest.fn() }));
vitest.mock("~/database/db.server", () => ({
  db: { asset: { findFirst: dbMocks.assetFindFirst } },
}));

// why: custodian lookup without a database
vitest.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vitest.fn().mockResolvedValue({
    id: "custodian-1",
    name: "Jane Doe",
    user: null,
  }),
}));

// why: index settings are forwarded to the bulk call, not under test
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vitest.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: each per-unit assignment writes an audit note and runs the low-stock
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

/** Free units per asset id, as the availability leaf reports them. */
function freeUnits(free: Record<string, number>) {
  dbMocks.assetFindFirst.mockImplementation(
    ({ where }: { where: { id: string } }) =>
      Promise.resolve({
        title: `Asset ${where.id}`,
        quantity: 100,
        type: where.id.startsWith("qty-") ? "QUANTITY_TRACKED" : "INDIVIDUAL",
      })
  );
  vitest
    .mocked(computeCustodyAvailability)
    .mockImplementation((_db, { assetId }) =>
      Promise.resolve({
        inCustody: 0,
        inKits: 0,
        checkedOut: 0,
        available: free[assetId] ?? 0,
      })
    );
}

async function submit(body: Record<string, unknown>) {
  const request = new Request(
    "http://localhost/api/mobile/bulk-assign-custody?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custodianId: "custodian-1", ...body }),
    }
  );
  const response = (await action(
    createActionArgs({ request })
  )) as unknown as Response;
  return { status: response.status, body: await response.json() };
}

describe("POST /api/mobile/bulk-assign-custody with quantities", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    freeUnits({ "qty-1": 10, "qty-2": 5 });
  });

  it("assigns the named units and sends only whole assets to the bulk call", async () => {
    const { status, body } = await submit({
      assetIds: ["asset-1", "qty-1"],
      quantities: { "qty-1": 3 },
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      skippedQuantityTracked: 0,
      movedQuantityAssetIds: ["qty-1"],
    });
    expect(checkOutQuantity).toHaveBeenCalledTimes(1);
    expect(checkOutQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "qty-1",
        teamMemberId: "custodian-1",
        quantity: 3,
        organizationId: "org-1",
        custodyAssign: "anyone",
      })
    );
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-1"] })
    );
    // One audit note per per-unit assignment.
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("skips the bulk call when every asset carries a quantity", async () => {
    const { status, body } = await submit({
      assetIds: ["qty-1", "qty-2"],
      quantities: { "qty-1": 2, "qty-2": 5 },
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      skippedQuantityTracked: 0,
      movedQuantityAssetIds: ["qty-1", "qty-2"],
    });
    expect(checkOutQuantity).toHaveBeenCalledTimes(2);
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });

  it("writes nothing and names the asset when it asks for more than is free", async () => {
    const { status, body } = await submit({
      assetIds: ["asset-1", "qty-1", "qty-2"],
      quantities: { "qty-1": 3, "qty-2": 6 },
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe(
      'Nothing was assigned. "Asset qty-2" (asked for 6, 5 free).'
    );
    expect(checkOutQuantity).not.toHaveBeenCalled();
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it("runs the whole-asset call before any per-unit write", async () => {
    await submit({
      assetIds: ["asset-1", "qty-1"],
      quantities: { "qty-1": 3 },
    });

    // The bulk call validates and writes in one transaction, so if it refuses,
    // no units have been handed over yet.
    expect(
      vitest.mocked(bulkCheckOutAssets).mock.invocationCallOrder[0]
    ).toBeLessThan(vitest.mocked(checkOutQuantity).mock.invocationCallOrder[0]);
  });

  it("refuses a unit count for an asset that is not tracked by quantity", async () => {
    const { status, body } = await submit({
      assetIds: ["qty-1", "asset-1"],
      quantities: { "qty-1": 2, "asset-1": 1 },
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe(
      'Nothing was assigned. "Asset asset-1" (not tracked by quantity).'
    );
    expect(checkOutQuantity).not.toHaveBeenCalled();
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });

  it("reports by asset a unit write refused after the check, and keeps the rest", async () => {
    vitest.mocked(checkOutQuantity).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        label: "Assets",
        status: 400,
        message: "Cannot check out 2 units. Only 1 units are available.",
      })
    );

    const { status, body } = await submit({
      assetIds: ["asset-1", "qty-1", "qty-2"],
      quantities: { "qty-1": 2, "qty-2": 1 },
    });

    expect(status).toBe(200);
    expect(body).toEqual({
      success: true,
      skippedQuantityTracked: 0,
      movedQuantityAssetIds: ["qty-2"],
      refusedQuantities: [
        {
          assetId: "qty-1",
          title: "Asset qty-1",
          message: "Cannot check out 2 units. Only 1 units are available.",
        },
      ],
    });
    // The other unit row still went.
    expect(checkOutQuantity).toHaveBeenCalledTimes(2);
  });

  it("assigns once for an asset scanned under two codes", async () => {
    await submit({
      assetIds: ["qty-1", "qty-1"],
      quantities: { "qty-1": 2 },
    });

    expect(checkOutQuantity).toHaveBeenCalledTimes(1);
  });

  it("handles a body without quantities exactly as before", async () => {
    const { status } = await submit({ assetIds: ["asset-1", "qty-1"] });

    expect(status).toBe(200);
    expect(checkOutQuantity).not.toHaveBeenCalled();
    expect(bulkCheckOutAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-1", "qty-1"] })
    );
  });

  it.each([
    ["zero", { "qty-1": 0 }],
    ["a fraction", { "qty-1": 1.5 }],
    ["a string", { "qty-1": "3" }],
    ["a list", [3]],
  ])("refuses a quantity that is %s", async (_label, quantities) => {
    const { status } = await submit({ assetIds: ["qty-1"], quantities });

    expect(status).toBe(400);
    expect(checkOutQuantity).not.toHaveBeenCalled();
    expect(bulkCheckOutAssets).not.toHaveBeenCalled();
  });
});
