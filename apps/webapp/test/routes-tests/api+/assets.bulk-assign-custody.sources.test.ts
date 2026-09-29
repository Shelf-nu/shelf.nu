/**
 * The bulk assign-custody endpoint, from the source-location angle.
 *
 * The web scanner submits a `sourceLocations` map next to `quantities` for
 * pools placed at two or more locations. The route forwards each entry to
 * `checkOutQuantity` and, like the pool-wide availability, checks the chosen
 * location's room up front, so a refusal still arrives before any of the
 * scan's per-asset transactions has committed.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-assign-custody.ts}
 * @see {@link file://./assets.bulk-release-custody.quantities.test.ts} - the release twin
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkOutQuantity } from "~/modules/asset/service.server";
import { action } from "~/routes/api+/assets.bulk-assign-custody";
import { requirePermission } from "~/utils/roles.server";

// why: mocking Remix's data() so the action returns a real Response
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (data: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the pre-flight reads the asset's title and total, and a location's
// name for the refusal message; no database in route tests.
const dbMocks = vi.hoisted(() => ({
  assetFindFirst: vi.fn(),
  locationFindFirst: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: dbMocks.assetFindFirst },
    location: { findFirst: dbMocks.locationFindFirst },
  },
}));

// why: the pool-wide ceiling has its own tests; here it is always roomy so
// only the per-location check can refuse.
vi.mock("~/modules/asset/availability-primitives.server", () => ({
  computeCustodyAvailability: vi.fn().mockResolvedValue({ available: 100 }),
}));

// why: the pool's placements and custody come from the database; each test
// states them plainly.
const sourcesMock = vi.hoisted(() => vi.fn());
vi.mock("~/modules/asset/custody-source.server", () => ({
  loadCustodySources: sourcesMock,
}));

// why: exercising the route's forwarding and refusal, not the writes
vi.mock("~/modules/asset/service.server", () => ({
  bulkCheckOutAssets: vi.fn().mockResolvedValue({ skippedQuantityTracked: 0 }),
  checkOutQuantity: vi.fn().mockResolvedValue({}),
}));

// why: authorization is asserted at the service layer; here it only needs to resolve
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the custodian lookup and select-all narrowing read the database
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn().mockResolvedValue({ id: "tm-1" }),
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
}));

// why: index settings and timezone are forwarded to the bulk call, not under test
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const mockCheckOut = vi.mocked(checkOutQuantity);

/** A pool of 4 placed 2 at Camera Room and 2 at Studio, 1 out from Studio. */
const twoLocationPool = {
  state: {
    total: 4,
    placements: [
      { locationId: "loc-camera", quantity: 2 },
      { locationId: "loc-studio", quantity: 2 },
    ],
    operatorCustody: [{ locationId: "loc-studio", quantity: 1 }],
  },
  rows: [],
};

function makeRequest(
  quantities: Record<string, number>,
  sourceLocations?: Record<string, string>
) {
  const formData = new FormData();
  Object.keys(quantities).forEach((id, index) =>
    formData.set(`assetIds[${index}]`, id)
  );
  formData.set("custodian", JSON.stringify({ id: "tm-1", name: "Ahmed" }));
  formData.set("quantities", JSON.stringify(quantities));
  if (sourceLocations) {
    formData.set("sourceLocations", JSON.stringify(sourceLocations));
  }
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("https://example.com/api/assets/bulk-assign-custody", {
      method: "POST",
      body: formData,
    }),
    params: {},
  } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: false,
    canSeeAllCustody: true,
  } as Awaited<ReturnType<typeof requirePermission>>);
  dbMocks.assetFindFirst.mockResolvedValue({ title: "Spanner", quantity: 4 });
  dbMocks.locationFindFirst.mockResolvedValue({ name: "Studio" });
  sourcesMock.mockResolvedValue(twoLocationPool);
});

describe("api/assets/bulk-assign-custody: source locations", () => {
  it("forwards each scanned pool's source to checkOutQuantity", async () => {
    const response = (await action(
      makeRequest({ pool: 2, other: 1 }, { pool: "loc-camera" })
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(mockCheckOut).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "pool", locationId: "loc-camera" })
    );
    // A row without a picker sends no entry: the service resolves it.
    expect(
      mockCheckOut.mock.calls.find((c) => c[0].assetId === "other")?.[0]
        .locationId
    ).toBeUndefined();
  });

  it("refuses before writing anything when the location has too few left", async () => {
    const response = (await action(
      makeRequest({ pool: 2 }, { pool: "loc-studio" })
    )) as unknown as Response;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain(
      '"Spanner" (asked for 2, 1 left at Studio)'
    );
    expect(mockCheckOut).not.toHaveBeenCalled();
  });

  it("measures the unplaced units for the unplaced choice", async () => {
    // Fully placed: nothing is unplaced, so any amount is refused up front.
    const response = (await action(
      makeRequest({ pool: 1 }, { pool: "unplaced" })
    )) as unknown as Response;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("(asked for 1, 0 unplaced left)");
    expect(mockCheckOut).not.toHaveBeenCalled();
  });

  it("rejects a malformed sources field", async () => {
    const formData = new FormData();
    formData.set("assetIds[0]", "pool");
    formData.set("custodian", JSON.stringify({ id: "tm-1", name: "Ahmed" }));
    formData.set("quantities", JSON.stringify({ pool: 1 }));
    formData.set("sourceLocations", JSON.stringify(["loc-camera"]));

    const response = (await action({
      context: { getSession: () => ({ userId: "user-1" }) },
      request: new Request(
        "https://example.com/api/assets/bulk-assign-custody",
        { method: "POST", body: formData }
      ),
      params: {},
    } as unknown as ActionFunctionArgs)) as unknown as Response;

    expect(response.status).toBe(400);
    expect(mockCheckOut).not.toHaveBeenCalled();
  });
});
