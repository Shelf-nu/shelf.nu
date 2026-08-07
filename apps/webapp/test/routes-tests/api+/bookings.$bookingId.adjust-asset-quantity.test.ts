/**
 * Regression tests for the ownership guard on
 * `api+/bookings.$bookingId.adjust-asset-quantity.ts`.
 *
 * Covers the same cross-user IDOR scenario that hex-security flagged
 * in r3199039448: SELF_SERVICE / BASE users carry `booking:update`, so
 * without an explicit ownership check they could change the booked
 * quantity of a QUANTITY_TRACKED asset on any booking in their org.
 */

import { AssetType, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/api+/bookings.$bookingId.adjust-asset-quantity";
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
  return {
    bookingAssetFindFirst: vi.fn(),
    bookingAssetFindUnique,
    $transaction: vi.fn(async (cb: any) =>
      cb({
        bookingAsset: {
          findUnique: bookingAssetFindUnique,
          update: vi.fn().mockResolvedValue(undefined),
        },
      })
    ),
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
    },
  };
}

function buildRequest(quantity = 7, assetId = "asset-1") {
  const formData = new FormData();
  formData.set("assetId", assetId);
  formData.set("quantity", String(quantity));
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
});

describe("api/bookings/:bookingId/adjust-asset-quantity — ownership guard", () => {
  it("rejects SELF_SERVICE user adjusting someone else's booking with 403", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.BASE,
      isSelfServiceOrBase: true,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    dbMocks.bookingAssetFindFirst.mockResolvedValue(null);

    const response = (await action(
      buildArgs(buildRequest())
    )) as unknown as Response;

    expect(response.status).toBe(404);
    expect(dbMocks.$transaction).not.toHaveBeenCalled();
  });

  it("skips the ownership check entirely for ADMIN users", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

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
