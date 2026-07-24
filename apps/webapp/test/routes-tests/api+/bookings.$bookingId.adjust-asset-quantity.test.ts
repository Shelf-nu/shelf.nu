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

const dbMocks = vi.hoisted(() => ({
  bookingAssetFindFirst: vi.fn(),
  // why: separate, clearable mocks (rather than inlining fresh vi.fn()s
  // inside the $transaction factory below) so quantity-guard tests can
  // configure the "current" quantity read under the lock and assert what
  // was actually persisted, independently of the ownership-guard tests
  // above which only assert $transaction call count.
  bookingAssetFindUniqueOrThrow: vi.fn().mockResolvedValue({ quantity: 5 }),
  bookingAssetUpdate: vi.fn().mockResolvedValue(undefined),
  $transaction: vi.fn(async (cb: any) =>
    cb({
      bookingAsset: {
        findUniqueOrThrow: dbMocks.bookingAssetFindUniqueOrThrow,
        update: dbMocks.bookingAssetUpdate,
      },
    })
  ),
}));

const consumptionMocks = vi.hoisted(() => ({
  computeBookingAvailableQuantity: vi
    .fn()
    .mockResolvedValue({ total: 10, inCustody: 0, available: 10 }),
  lockAssetForQuantityUpdate: vi.fn().mockResolvedValue(undefined),
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

vi.mock("~/modules/consumption-log/service.server", () => ({
  computeBookingAvailableQuantity:
    consumptionMocks.computeBookingAvailableQuantity,
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

/**
 * Regression tests for #2725: once a QUANTITY_TRACKED asset's pool is
 * over-reserved by OTHER bookings, `computeBookingAvailableQuantity`
 * returns a negative `available`, and the pre-fix guard compared the
 * submitted quantity against it unconditionally — rejecting every
 * positive submission, including a reduction, with no way to recover.
 * The fix only measures an INCREASE (relative to the current booked
 * quantity, re-read under the asset lock) against availability.
 */
describe("api/bookings/:bookingId/adjust-asset-quantity — directional availability guard", () => {
  beforeEach(() => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
    } as any);
  });

  it("reduces a booking's quantity even when the pool is oversubscribed (negative availability)", async () => {
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    // The row currently reserves 17 units (an over-reserved pool: total=10,
    // reserved elsewhere ~17 -> available = -7). The user reduces to 1.
    dbMocks.bookingAssetFindUniqueOrThrow.mockResolvedValue({ quantity: 17 });
    consumptionMocks.computeBookingAvailableQuantity.mockResolvedValue({
      total: 10,
      inCustody: 0,
      available: -7,
    });

    const response = (await action(
      buildArgs(buildRequest(1))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    // A reduction never oversubscribes the pool, so the fix must not even
    // consult availability for it.
    expect(
      consumptionMocks.computeBookingAvailableQuantity
    ).not.toHaveBeenCalled();
    expect(dbMocks.bookingAssetUpdate).toHaveBeenCalledWith({
      where: { id: "ba-1" },
      data: { quantity: 1 },
    });
  });

  it("still rejects an increase beyond remaining availability, with a clamped, explanatory message", async () => {
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    dbMocks.bookingAssetFindUniqueOrThrow.mockResolvedValue({ quantity: 17 });
    consumptionMocks.computeBookingAvailableQuantity.mockResolvedValue({
      total: 10,
      inCustody: 0,
      available: -7,
    });

    const response = (await action(
      buildArgs(buildRequest(20))
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(consumptionMocks.computeBookingAvailableQuantity).toHaveBeenCalled();
    expect(dbMocks.bookingAssetUpdate).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { message: string } };
    // Never a raw negative number in user-facing copy.
    expect(body.error.message).toContain("Only 0 available");
    expect(body.error.message).toContain("over-committed by 7 unit(s)");
  });

  it("allows an increase that fits within remaining availability", async () => {
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    dbMocks.bookingAssetFindUniqueOrThrow.mockResolvedValue({ quantity: 5 });
    consumptionMocks.computeBookingAvailableQuantity.mockResolvedValue({
      total: 10,
      inCustody: 0,
      available: 10,
    });

    const response = (await action(
      buildArgs(buildRequest(8))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(consumptionMocks.computeBookingAvailableQuantity).toHaveBeenCalled();
    expect(dbMocks.bookingAssetUpdate).toHaveBeenCalledWith({
      where: { id: "ba-1" },
      data: { quantity: 8 },
    });
  });

  it("treats a resubmitted, unchanged quantity as a pass-through (no availability read)", async () => {
    dbMocks.bookingAssetFindFirst.mockResolvedValue(
      buildBookingAsset({ creatorId: "user-current", custodianUserId: null })
    );
    dbMocks.bookingAssetFindUniqueOrThrow.mockResolvedValue({ quantity: 17 });
    consumptionMocks.computeBookingAvailableQuantity.mockResolvedValue({
      total: 10,
      inCustody: 0,
      available: -7,
    });

    const response = (await action(
      buildArgs(buildRequest(17))
    )) as unknown as Response;

    expect(response.status).toBe(200);
    expect(
      consumptionMocks.computeBookingAvailableQuantity
    ).not.toHaveBeenCalled();
  });
});
