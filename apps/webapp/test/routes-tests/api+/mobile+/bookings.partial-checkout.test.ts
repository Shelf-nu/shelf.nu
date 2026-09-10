/**
 * Validation contract for the mobile progressive check-out endpoint.
 *
 * The ids the app sends back are the ones it was given in the booking payload,
 * and asset ids do not all share a single shape — imported and seeded rows
 * carry ids no format check describes. So this route accepts any non-empty id
 * and lets the service prove it against the booking, which is the check that
 * actually protects anything. An id shaped differently from the majority must
 * reach the service rather than being turned away at the door.
 *
 * @see {@link file://./bookings.partial-checkout.ts} route under test
 * @see {@link file://./bookings.partial-checkin.ts} the twin it matches
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import { partialCheckoutBooking } from "~/modules/booking/service.server";

import { action } from "~/routes/api+/mobile+/bookings.partial-checkout";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary — the route reads the booking to gate the
// mutation on ownership. Nothing else here touches it.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: JWT validation, org-membership resolution and the permission gate are
// out of scope for a validation test; the rest of the module stays real.
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

// why: the service is the seam past the validator — spying on it is how
// "the payload was accepted" becomes observable.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    partialCheckoutBooking: vi.fn(),
  };
});

const partialCheckoutBookingMock = vi.mocked(partialCheckoutBooking);

const BOOKING_ID = "booking-1";
/** An id that carries no leading "c" — the shape a format check turned away. */
const IMPORTED_ASSET_ID = "a2oaa2njg9732b0m9lmhe5301";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
  vi.mocked(db.booking.findFirst).mockResolvedValue({
    creatorId: "user-1",
    custodianUserId: "user-1",
  } as never);
  partialCheckoutBookingMock.mockResolvedValue({
    checkedOutAssetCount: 1,
    remainingAssetCount: 0,
    isComplete: true,
    booking: { id: BOOKING_ID, name: "Load-in", status: "ONGOING" },
  } as never);
});

async function post(body: Record<string, unknown>) {
  return action(
    createActionArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/partial-checkout",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookingId: BOOKING_ID, ...body }),
        }
      ),
      params: {},
    })
  );
}

describe("POST /api/mobile/bookings/partial-checkout — which ids it accepts", () => {
  it("passes an asset id of any shape through to the service", async () => {
    const response = await post({ assetIds: [IMPORTED_ASSET_ID] });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
    expect(partialCheckoutBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: [IMPORTED_ASSET_ID] })
    );
  });

  it("passes a quantity payload of any shape through to the service", async () => {
    await post({
      checkouts: [
        {
          assetId: IMPORTED_ASSET_ID,
          bookingAssetId: "slice-without-a-c",
          quantity: 2,
        },
      ],
    });

    expect(partialCheckoutBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        checkouts: [
          {
            assetId: IMPORTED_ASSET_ID,
            bookingAssetId: "slice-without-a-c",
            quantity: 2,
          },
        ],
      })
    );
  });

  it("still refuses an empty id", async () => {
    const response = await post({ assetIds: [""] });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(partialCheckoutBookingMock).not.toHaveBeenCalled();
  });

  it("still refuses a quantity that is not a positive whole number", async () => {
    const response = await post({
      checkouts: [{ assetId: IMPORTED_ASSET_ID, quantity: 0 }],
    });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(partialCheckoutBookingMock).not.toHaveBeenCalled();
  });
});
