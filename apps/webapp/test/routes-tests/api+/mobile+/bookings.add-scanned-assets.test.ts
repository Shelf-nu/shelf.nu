/**
 * Contract tests for the mobile add-scanned-assets endpoint's `quantities` map.
 *
 * The companion sends `quantities: Record<assetId, units>` for every
 * QUANTITY_TRACKED asset scanned into a booking. The route must forward the
 * map to `addScannedAssetsToBooking` untouched, default it to `{}` for older
 * builds that never send one, and refuse a non-positive or fractional unit
 * count at the edge (a 4xx, never a call into the service).
 *
 * @see {@link file://./bookings.add-scanned-assets.ts} route under test
 */

import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import {
  noteBookedQuantityChange,
  setStandaloneBookedQuantity,
} from "~/modules/booking/booked-quantity.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";

import { action } from "~/routes/api+/mobile+/bookings.add-scanned-assets";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — the route reads the booking for its
// status/ownership gate and expands kits via asset.findMany. Mock only those.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    asset: { findMany: vi.fn() },
    // why: the route reads the booking's existing standalone slices to tell
    // "add" from "change the booked amount" before it touches the service.
    bookingAsset: { findMany: vi.fn() },
  },
}));

// why: the booked-amount change for an asset already on the booking is the
// shared helper's job (own suite); here we assert only WHAT the route hands
// it and that the service is not asked to insert a duplicate.
vi.mock("~/modules/booking/booked-quantity.server", () => ({
  setStandaloneBookedQuantity: vi.fn(),
  noteBookedQuantityChange: vi.fn(),
}));

// why: auth/permission/entitlement helpers are out of scope for these body
// contract tests — stub them to resolve, but keep `getMobileUserContext` a spy
// so each test can pick the caller's role. The real module is otherwise
// preserved.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    requireMobilePermission: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: rate limiting is infra, not the behavior under test — no-op it.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: the org-scope guard hits the database; its own tests cover it. Here it
// must simply let the caller's asset ids through.
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetsBelongToOrg: vi.fn().mockResolvedValue(undefined),
}));

// why: the service is the seam the route delegates to; spying on it lets us
// assert exactly which `quantities` the route forwards, and that a rejected
// body never reaches it.
vi.mock("~/modules/booking/service.server", () => ({
  addScannedAssetsToBooking: vi.fn(),
}));

const bookingFindFirstMock = vi.mocked(db.booking.findFirst);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const addScannedAssetsMock = vi.mocked(addScannedAssetsToBooking);
const bookingAssetFindManyMock = vi.mocked(db.bookingAsset.findMany);
const setBookedQuantityMock = vi.mocked(setStandaloneBookedQuantity);
const noteBookedQuantityMock = vi.mocked(noteBookedQuantityChange);

const CALLER_ID = "user-self";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const ASSET_ID = "asset-1";

/** Build a POST request for this endpoint with a JSON body. */
function makeArgs(body: Record<string, unknown>) {
  return createActionArgs({
    request: new Request(
      "http://localhost:3000/api/mobile/bookings/add-scanned-assets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    ),
  });
}

/** Point `getMobileUserContext` at a specific role for the next call. */
function withRole(role: OrganizationRoles) {
  getMobileUserContextMock.mockResolvedValue({
    role,
    roles: [role],
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);
  withRole(OrganizationRoles.ADMIN);

  // A DRAFT booking the caller holds — passes every status/ownership gate so
  // the body contract is the only variable.
  bookingFindFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    status: BookingStatus.DRAFT,
    from: new Date("2026-09-10T09:00:00.000Z"),
    to: new Date("2026-09-12T17:00:00.000Z"),
    custodianUserId: CALLER_ID,
  } as never);
  // No kits in these bodies, so kit expansion never runs; keep it inert.
  assetFindManyMock.mockResolvedValue([]);
  // Nothing on the booking yet, so every id is a fresh add.
  bookingAssetFindManyMock.mockResolvedValue([]);
  addScannedAssetsMock.mockResolvedValue(undefined as never);
  setBookedQuantityMock.mockResolvedValue({ previousQuantity: 1 });
  noteBookedQuantityMock.mockResolvedValue(undefined);
});

describe("POST /api/mobile/bookings/add-scanned-assets — already on the booking", () => {
  /** The standalone slice the booking already holds of a quantity-tracked asset. */
  const existingSlice = {
    id: "slice-1",
    assetId: ASSET_ID,
    quantity: 2,
    asset: { title: "Cords", type: "QUANTITY_TRACKED", unitOfMeasure: "pcs" },
  };

  it("changes the booked amount instead of inserting a duplicate", async () => {
    bookingAssetFindManyMock.mockResolvedValue([existingSlice] as never);
    setBookedQuantityMock.mockResolvedValue({ previousQuantity: 2 });

    const response = await action(
      makeArgs({
        bookingId: BOOKING_ID,
        assetIds: [ASSET_ID],
        quantities: { [ASSET_ID]: 5 },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({
      success: true,
      added: 0,
      updated: 1,
    });
    expect(setBookedQuantityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingAssetId: "slice-1",
        assetId: ASSET_ID,
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        quantity: 5,
        window: {
          from: new Date("2026-09-10T09:00:00.000Z"),
          to: new Date("2026-09-12T17:00:00.000Z"),
        },
      })
    );
    expect(noteBookedQuantityMock).toHaveBeenCalledWith(
      expect.objectContaining({ previousQuantity: 2, quantity: 5 })
    );
    // Nothing new to insert, so the service is never asked to.
    expect(addScannedAssetsMock).not.toHaveBeenCalled();
  });

  it("leaves an already-booked asset alone when no quantity is named", async () => {
    bookingAssetFindManyMock.mockResolvedValue([existingSlice] as never);

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetIds: [ASSET_ID] })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({
      success: true,
      added: 0,
      updated: 0,
    });
    expect(setBookedQuantityMock).not.toHaveBeenCalled();
    expect(addScannedAssetsMock).not.toHaveBeenCalled();
  });

  it("adds the new ids and changes the existing one in the same call", async () => {
    bookingAssetFindManyMock.mockResolvedValue([existingSlice] as never);

    const response = await action(
      makeArgs({
        bookingId: BOOKING_ID,
        assetIds: [ASSET_ID, "asset-2"],
        quantities: { [ASSET_ID]: 4, "asset-2": 3 },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({
      success: true,
      added: 1,
      updated: 1,
    });
    expect(setBookedQuantityMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: ASSET_ID, quantity: 4 })
    );
    expect(addScannedAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["asset-2"],
        quantities: { [ASSET_ID]: 4, "asset-2": 3 },
      })
    );
  });
});

describe("POST /api/mobile/bookings/add-scanned-assets — quantities", () => {
  it("forwards the caller's quantities map to the service", async () => {
    const response = await action(
      makeArgs({
        bookingId: BOOKING_ID,
        assetIds: [ASSET_ID],
        quantities: { [ASSET_ID]: 3 },
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({ success: true });
    expect(addScannedAssetsMock).toHaveBeenCalledTimes(1);
    expect(addScannedAssetsMock).toHaveBeenCalledWith({
      assetIds: [ASSET_ID],
      kitIds: [],
      bookingId: BOOKING_ID,
      organizationId: ORG_ID,
      userId: CALLER_ID,
      quantities: { [ASSET_ID]: 3 },
    });
  });

  it("defaults quantities to an empty map when the body omits it", async () => {
    // Older companion builds never send `quantities`; the service books one
    // unit per asset for any id missing from the map.
    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetIds: [ASSET_ID] })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({ success: true });
    expect(addScannedAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({ quantities: {} })
    );
  });

  it.each([
    ["zero", 0],
    ["a fraction", 1.5],
  ])(
    "rejects %s units with a 4xx without reaching the service",
    async (_label, units) => {
      const response = await action(
        makeArgs({
          bookingId: BOOKING_ID,
          assetIds: [ASSET_ID],
          quantities: { [ASSET_ID]: units },
        })
      );

      assertIsDataWithResponseInit(response);
      expect(response.init?.status).toBe(400);
      expect(addScannedAssetsMock).not.toHaveBeenCalled();
    }
  );
});
