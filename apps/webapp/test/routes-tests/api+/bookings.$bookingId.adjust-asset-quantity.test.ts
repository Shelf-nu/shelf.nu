/**
 * Route tests for `api+/bookings.$bookingId.adjust-asset-quantity.ts`: the
 * ownership guard, the locked re-read, and the optional `sources` field.
 *
 * SELF_SERVICE / BASE users carry `booking:update`, so without an explicit
 * ownership check they could change the booked quantity of a
 * QUANTITY_TRACKED asset on any booking in their org. The `sources` field
 * (JSON text) reaches the sources facade only after every route guard.
 */

import { AssetType, OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordEvent } from "~/modules/activity-event/service.server";
import { setManualSources } from "~/modules/booking/sources/booking-sources.server";
import { action } from "~/routes/api+/bookings.$bookingId.adjust-asset-quantity";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so route handlers can be invoked
// directly inside vitest without spinning up a full Remix runtime.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

const dbMocks = vi.hoisted(() => {
  // Re-read of the slice's booked quantity UNDER the asset lock (the TOCTOU
  // guard). Hoisted so tests can control the FRESH value per-scenario.
  const bookingAssetFindUnique = vi.fn();
  const bookingAssetUpdate = vi.fn().mockResolvedValue(undefined);
  // The booking row lock reads the booking's status.
  const queryRaw = vi.fn();
  const tx = {
    $queryRaw: queryRaw,
    bookingAsset: {
      findUnique: bookingAssetFindUnique,
      update: bookingAssetUpdate,
    },
    bookingAssetSource: { findMany: vi.fn().mockResolvedValue([]) },
    location: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return {
    bookingAssetFindFirst: vi.fn(),
    bookingAssetFindUnique,
    bookingAssetUpdate,
    queryRaw,
    tx,
    $transaction: vi.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
  };
});

const consumptionMocks = vi.hoisted(() => ({
  lockAssetForQuantityUpdate: vi.fn().mockResolvedValue(undefined),
  // The route validates via `assertAssetQuantityAvailable` (windowed guard).
  // Stub it to a no-op resolve so these ownership-guard tests exercise ONLY
  // the authorization branch — the availability math has its own coverage in
  // `availability.server.test.ts` / this route's `.availability.test.ts`. Mocking
  // the module here also keeps the real `availability.server` (and its heavy
  // `booking/service.server` import chain) out of this test's module graph.
  assertAssetQuantityAvailable: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: {
      findFirst: dbMocks.bookingAssetFindFirst,
    },
    $transaction: dbMocks.$transaction,
  },
}));

// why: lock + availability are asserted separately; their internals
// don't change between the guard's branches.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: consumptionMocks.lockAssetForQuantityUpdate,
}));

vi.mock("~/modules/asset/availability.server", () => ({
  assertAssetQuantityAvailable: consumptionMocks.assertAssetQuantityAvailable,
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the sources facade (locks, conversion, allocation, admission) has its
// own suite; here we assert what the route hands it and that a refusal
// reaches the caller.
vi.mock("~/modules/booking/sources/booking-sources.server", () => ({
  resizeSlices: vi.fn().mockResolvedValue(undefined),
  setManualSources: vi.fn().mockResolvedValue(undefined),
  setAutoSources: vi.fn().mockResolvedValue(undefined),
}));

// why: the event insert has its own suite; asserted by payload only.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));

// why: side effects (notes, notifications, user lookup) shouldn't
// influence the guard test outcome.
vi.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-current",
    firstName: "Test",
    lastName: "User",
    displayName: null,
  }),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);

function buildBookingAsset(bookingOverrides: {
  creatorId: string | null;
  custodianUserId: string | null;
}) {
  return {
    id: "ba-1",
    quantity: 5,
    asset: {
      id: "asset-1",
      title: "USB-C cable",
      type: AssetType.QUANTITY_TRACKED,
    },
    booking: {
      id: "booking-1",
      name: "Test booking",
      creatorId: bookingOverrides.creatorId,
      custodianUserId: bookingOverrides.custodianUserId,
      // `Booking.from`/`to` are required columns: every booking has dates.
      from: new Date("2026-09-10T09:00:00.000Z"),
      to: new Date("2026-09-12T17:00:00.000Z"),
    },
  };
}

function buildRequest(quantity = 7, assetId = "asset-1", sources?: string) {
  const formData = new FormData();
  formData.set("assetId", assetId);
  formData.set("quantity", String(quantity));
  if (sources !== undefined) formData.set("sources", sources);
  return new Request(
    "https://example.com/api/bookings/booking-1/adjust-asset-quantity",
    { method: "POST", body: formData }
  );
}

function buildArgs(request: Request): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-current" }),
    },
    request,
    params: { bookingId: "booking-1" },
  } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the locked re-read observes the same quantity the outside-tx
  // snapshot did (`buildBookingAsset` → 5). Tests that model a concurrent
  // change override this per-scenario.
  dbMocks.bookingAssetFindUnique.mockResolvedValue({ quantity: 5 });
  // A DRAFT booking: every role may change its items.
  dbMocks.queryRaw.mockResolvedValue([{ status: "DRAFT" }]);
});

describe("api/bookings/:bookingId/adjust-asset-quantity — ownership guard", () => {
  it("rejects SELF_SERVICE user adjusting someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "someone-else",
        custodianUserId: "another-someone",
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("rejects BASE user adjusting someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.BASE] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "someone-else",
        custodianUserId: null,
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("allows SELF_SERVICE user to adjust their own (creator) booking", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "user-current",
        custodianUserId: null,
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it("allows SELF_SERVICE user when they're the custodian (not creator)", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "admin-user",
        custodianUserId: "user-current",
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when bookingAsset isn't found in this org", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(null);

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(404);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("skips the ownership check entirely for ADMIN users", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "another-user",
        custodianUserId: "yet-another",
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it("skips the ownership check entirely for OWNER users", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.OWNER] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({
        creatorId: "another-user",
        custodianUserId: null,
      })
    );

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(dbMocks.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("api/bookings/:bookingId/adjust-asset-quantity — TOCTOU re-read", () => {
  it("measures availability against the re-read quantity under the lock, not the stale snapshot", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );

    // Outside-tx snapshot reports 5 units (stale HIGH).
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    // A concurrent request already lowered the real booked qty to 2 before
    // this request acquired the lock and re-read.
    dbMocks.bookingAssetFindUnique.mockResolvedValue({ quantity: 2 });

    await action(buildArgs(buildRequest(4)));

    // The directional guard must see currentQuantity = 2 (the FRESH value): a
    // submission of 4 is then a genuine INCREASE (2 → 4), not a reduction
    // masked by the stale 5 that would skip the availability check entirely.
    expect(consumptionMocks.assertAssetQuantityAvailable).toHaveBeenCalledWith(
      expect.objectContaining({ currentQuantity: 2, requestedQuantity: 4 })
    );
  });

  it("returns 404 when the slice vanishes under the lock (concurrent removal)", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );

    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    // The row was deleted by a concurrent request between the outside-tx read
    // and the locked re-read.
    dbMocks.bookingAssetFindUnique.mockResolvedValue(null);

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(404);
    // Once the row is gone, neither the availability guard nor the write runs.
    expect(
      consumptionMocks.assertAssetQuantityAvailable
    ).not.toHaveBeenCalled();
  });
});

describe("api/bookings/:bookingId/adjust-asset-quantity: sources field", () => {
  const MANUAL = {
    mode: "MANUAL",
    sources: [
      { locationId: "loc-1", quantity: 2 },
      { locationId: null, quantity: 3 },
    ],
  };

  beforeEach(() => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
  });

  it("hands a MANUAL split to the facade inside the transaction", async () => {
    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", JSON.stringify(MANUAL)))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(setManualSources).toHaveBeenCalledWith(
      dbMocks.tx,
      expect.objectContaining({
        organizationId: expect.any(String),
        bookingId: "booking-1",
        sliceId: "ba-1",
        sources: MANUAL.sources,
      })
    );
  });

  it("400s a malformed split before opening the transaction", async () => {
    const duplicate = JSON.stringify({
      mode: "MANUAL",
      sources: [
        { locationId: "loc-1", quantity: 2 },
        { locationId: "loc-1", quantity: 3 },
      ],
    });

    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", duplicate))
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("400s text that is not JSON", async () => {
    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", "{oops"))
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("passes the facade's refusal of a foreign location through and records nothing", async () => {
    vi.mocked(setManualSources).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "One of the chosen locations does not hold this asset.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", JSON.stringify(MANUAL)))
    )) as unknown as Response;

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "One of the chosen locations does not hold this asset."
    );
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("403s any change on a closed booking", async () => {
    dbMocks.queryRaw.mockResolvedValue([{ status: "COMPLETE" }]);

    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", JSON.stringify({ mode: "AUTO" })))
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(setManualSources).not.toHaveBeenCalled();
  });

  it("keeps the ownership guard in front of a sources change", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "someone-else", custodianUserId: null })
    );

    const response = (await action(
      buildArgs(buildRequest(5, "asset-1", JSON.stringify(MANUAL)))
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
    expect(setManualSources).not.toHaveBeenCalled();
  });
});

describe("api/bookings/:bookingId/adjust-asset-quantity: status rule", () => {
  it("refuses a SELF_SERVICE owner on a RESERVED booking like the mobile route does", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.SELF_SERVICE] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    // The gate reads the LOCKED status, not the outside-tx snapshot.
    dbMocks.queryRaw.mockResolvedValue([{ status: "RESERVED" }]);

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "Quantities cannot be changed on this booking in its current status."
    );
    expect(dbMocks.bookingAssetUpdate).not.toHaveBeenCalled();
  });

  it("lets an ADMIN change a RESERVED booking", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    dbMocks.queryRaw.mockResolvedValue([{ status: "RESERVED" }]);

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(200);
  });
});
