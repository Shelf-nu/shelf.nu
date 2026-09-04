/**
 * Behaviour tests for the mobile adjust-asset-quantity endpoint.
 *
 * The route resizes one booking's STANDALONE slice of a quantity-tracked
 * asset. These tests pin what a caller observes: the response payload, the
 * arguments the shared availability guard receives (the guard's own math is
 * covered in `availability.server.test.ts`), the pivot-row write, the two
 * activity notes (and their absence on a no-op save), and every refusal —
 * INDIVIDUAL asset, missing slice, closed booking, non-owner SELF_SERVICE
 * caller, and an availability shortfall.
 *
 * The ownership guard is the REAL `validateBookingOwnership`, not a stub, so
 * the SELF_SERVICE cases prove the gate rejects on ownership rather than on
 * the role alone.
 *
 * @see {@link file://./bookings.adjust-asset-quantity.ts} route under test
 * @see {@link file://./../bookings.$bookingId.adjust-asset-quantity.ts} web twin
 */

import { AssetType, BookingStatus, OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { assertAssetQuantityAvailable } from "~/modules/asset/availability.server";
import { createSystemBookingNote } from "~/modules/booking-note/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { createNotes } from "~/modules/note/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { ShelfError } from "~/utils/error";

import { action } from "~/routes/api+/mobile+/bookings.adjust-asset-quantity";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — the route reads the slice for its
// gates, then re-reads and writes it inside a transaction. The transaction
// runs its callback against a stub client so the in-tx reads/writes are
// observable without a database.
vi.mock("~/database/db.server", () => ({
  db: {
    bookingAsset: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// why: auth/permission/entitlement helpers are out of scope here — stub them
// to resolve, but keep `getMobileUserContext` a spy so each test can pick the
// caller's role. The real module is otherwise preserved.
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

// why: the row lock is a raw `SELECT ... FOR UPDATE`; it needs a real
// connection and has no observable result beyond serialising writers.
vi.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vi.fn().mockResolvedValue(undefined),
}));

// why: the availability guard is the seam the route delegates the
// oversubscription decision to. Spying on it lets us assert the arguments
// the route hands it and simulate a shortfall, without the real module's
// query chain.
vi.mock("~/modules/asset/availability.server", () => ({
  assertAssetQuantityAvailable: vi.fn().mockResolvedValue(undefined),
}));

// why: the two activity feeds are side effects we assert on (written on a
// real change, skipped on a no-op), not behaviour we want to run.
vi.mock("~/modules/note/service.server", () => ({
  createNotes: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vi.fn().mockResolvedValue(undefined),
}));

// why: the actor lookup only feeds the note text; a fixed user keeps the
// note assertions deterministic.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-self",
    firstName: "Sam",
    lastName: "Scanner",
    displayName: null,
  }),
}));

const findFirstMock = vi.mocked(db.bookingAsset.findFirst);
const transactionMock = vi.mocked(db.$transaction);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const availabilityGuardMock = vi.mocked(assertAssetQuantityAvailable);
const lockMock = vi.mocked(lockAssetForQuantityUpdate);
const createNotesMock = vi.mocked(createNotes);
const createSystemBookingNoteMock = vi.mocked(createSystemBookingNote);
const getUserByIDMock = vi.mocked(getUserByID);

const CALLER_ID = "user-self";
const OTHER_ID = "user-other";
const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const ASSET_ID = "asset-1";
const SLICE_ID = "ba-1";
const BOOKING_FROM = new Date("2026-09-10T09:00:00.000Z");
const BOOKING_TO = new Date("2026-09-12T17:00:00.000Z");

/** The client the mocked transaction hands to the route's callback. */
const tx = {
  bookingAsset: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

/** Build a POST request for this endpoint with a JSON body. */
function makeArgs(body: Record<string, unknown>) {
  return createActionArgs({
    request: new Request(
      "http://localhost:3000/api/mobile/bookings/adjust-asset-quantity",
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

/**
 * The slice as `bookingAsset.findFirst` returns it: a 2-unit standalone
 * reservation of a quantity-tracked asset on a DRAFT booking the caller
 * created and holds. Overrides narrow each test to a single variable.
 */
function buildSlice(
  overrides: {
    quantity?: number;
    assetType?: AssetType;
    bookingStatus?: BookingStatus;
    creatorId?: string | null;
    custodianUserId?: string | null;
  } = {}
) {
  return {
    id: SLICE_ID,
    quantity: overrides.quantity ?? 2,
    asset: {
      id: ASSET_ID,
      title: "USB-C cable",
      type: overrides.assetType ?? AssetType.QUANTITY_TRACKED,
      unitOfMeasure: "pcs",
    },
    booking: {
      id: BOOKING_ID,
      name: "Field day",
      status: overrides.bookingStatus ?? BookingStatus.DRAFT,
      from: BOOKING_FROM,
      to: BOOKING_TO,
      creatorId:
        overrides.creatorId === undefined ? CALLER_ID : overrides.creatorId,
      custodianUserId:
        overrides.custodianUserId === undefined
          ? CALLER_ID
          : overrides.custodianUserId,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuthMock.mockResolvedValue({
    user: { id: CALLER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(ORG_ID);
  withRole(OrganizationRoles.ADMIN);

  findFirstMock.mockResolvedValue(buildSlice() as never);
  // The re-read under the lock sees the same 2 units the snapshot did.
  tx.bookingAsset.findUnique.mockResolvedValue({ quantity: 2 });
  tx.bookingAsset.update.mockResolvedValue(undefined);
  transactionMock.mockImplementation((async (
    callback: (client: typeof tx) => Promise<unknown>
  ) => callback(tx)) as never);
});

describe("POST /api/mobile/bookings/adjust-asset-quantity", () => {
  it("raises the slice to the requested quantity and writes both activity notes", async () => {
    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
    expect(response.data).toEqual({
      success: true,
      quantity: 5,
      previousQuantity: 2,
    });

    // The guard is asked about THIS booking's window with the booking itself
    // excluded, comparing the fresh in-tx quantity against the request.
    expect(lockMock).toHaveBeenCalledWith(tx, ASSET_ID, ORG_ID);
    expect(availabilityGuardMock).toHaveBeenCalledTimes(1);
    expect(availabilityGuardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: ASSET_ID,
        organizationId: ORG_ID,
        tx,
        window: { from: BOOKING_FROM, to: BOOKING_TO },
        excludeBookingId: BOOKING_ID,
        currentQuantity: 2,
        requestedQuantity: 5,
      })
    );

    expect(tx.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: SLICE_ID },
      data: { quantity: 5 },
    });

    // Asset feed + booking feed, both naming the delta.
    expect(createNotesMock).toHaveBeenCalledTimes(1);
    expect(createNotesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE",
        userId: CALLER_ID,
        assetIds: [ASSET_ID],
        organizationId: ORG_ID,
        content: expect.stringContaining("from **2** to **5**"),
      })
    );
    expect(createSystemBookingNoteMock).toHaveBeenCalledTimes(1);
    expect(createSystemBookingNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: BOOKING_ID,
        organizationId: ORG_ID,
        content: expect.stringContaining("**USB-C cable** from **2** to **5**"),
      })
    );
  });

  it("writes no notes when the requested quantity equals the current one", async () => {
    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 2 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toEqual({
      success: true,
      quantity: 2,
      previousQuantity: 2,
    });
    expect(getUserByIDMock).not.toHaveBeenCalled();
    expect(createNotesMock).not.toHaveBeenCalled();
    expect(createSystemBookingNoteMock).not.toHaveBeenCalled();
  });

  it("400s for an INDIVIDUAL asset without opening the transaction", async () => {
    findFirstMock.mockResolvedValue(
      buildSlice({ assetType: AssetType.INDIVIDUAL }) as never
    );

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("404s when the asset has no standalone slice on the booking", async () => {
    findFirstMock.mockResolvedValue(null);

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("403s on a COMPLETE booking", async () => {
    findFirstMock.mockResolvedValue(
      buildSlice({ bookingStatus: BookingStatus.COMPLETE }) as never
    );

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("403s a SELF_SERVICE user on a booking they neither created nor hold", async () => {
    withRole(OrganizationRoles.SELF_SERVICE);
    findFirstMock.mockResolvedValue(
      buildSlice({ creatorId: OTHER_ID, custodianUserId: OTHER_ID }) as never
    );

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(403);
    expect(
      (response.data as { error: { message: string } }).error.message
    ).toContain("not authorized");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("lets a SELF_SERVICE custodian adjust their own DRAFT booking", async () => {
    // The direction the refusal above cannot prove: the gate rejects on
    // ownership, not on the role.
    withRole(OrganizationRoles.SELF_SERVICE);
    findFirstMock.mockResolvedValue(
      buildSlice({ creatorId: OTHER_ID, custodianUserId: CALLER_ID }) as never
    );

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toMatchObject({ success: true, quantity: 5 });
    expect(tx.bookingAsset.update).toHaveBeenCalledTimes(1);
  });

  it("surfaces an availability shortfall with the guard's own status and message", async () => {
    availabilityGuardMock.mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        title: "Insufficient availability",
        message: "Only 3 pcs available.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await action(
      makeArgs({ bookingId: BOOKING_ID, assetId: ASSET_ID, quantity: 5 })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(
      (response.data as { error: { message: string } }).error.message
    ).toBe("Only 3 pcs available.");
    // The refusal happens before the write, and nothing is logged for it.
    expect(tx.bookingAsset.update).not.toHaveBeenCalled();
    expect(createNotesMock).not.toHaveBeenCalled();
    expect(createSystemBookingNoteMock).not.toHaveBeenCalled();
  });
});
