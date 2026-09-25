/**
 * The optional `sourceLocations` field on the three mobile check-out
 * endpoints.
 *
 * A pool placed at several locations records where its units leave from. The
 * phone sends the picks as `{ [bookingAssetId or assetId]: locationId | null }`;
 * an app that predates the field sends nothing and must keep working, with
 * the server recording its default. These tests pin both halves at the route:
 * the picks reach the service intact, and a missing field reaches it as "no
 * answers" rather than being refused. The service's own handling (default,
 * 400 for a foreign location) is covered next to it.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.checkout.ts}
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.partial-checkout.ts}
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.fulfil-and-checkout.ts}
 * @see {@link file://../../../../app/modules/booking/checkout-source-location.server.test.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingSettings } from "@factories";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import type { SourceLocationSubmission } from "~/modules/booking/checkout-source-location";
import { fulfilAndCheckOut } from "~/modules/booking/fulfil-and-checkout.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import {
  checkoutBooking,
  partialCheckoutBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";

import { action as checkoutAction } from "~/routes/api+/mobile+/bookings.checkout";
import { action as fulfilAction } from "~/routes/api+/mobile+/bookings.fulfil-and-checkout";
import { action as partialAction } from "~/routes/api+/mobile+/bookings.partial-checkout";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: the routes read the booking to gate the mutation on ownership; that
// read is the only database access they make themselves.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: JWT validation, org membership and the permission gate are out of scope
// here; the rest of the module stays real.
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

// why: the explicit check-out switch decides whether the one-tap route runs;
// reading it for real needs the database.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: the services are the seam past each route's validator; spying on them
// is how "the field reached the service" becomes observable.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    checkoutBooking: vi.fn(),
    partialCheckoutBooking: vi.fn(),
  };
});

// why: same seam for the fulfil route, whose service composes several writes.
vi.mock("~/modules/booking/fulfil-and-checkout.server", () => ({
  fulfilAndCheckOut: vi.fn(),
}));

const BOOKING_ID = "booking-1";
const BOOKING_ROW = {
  from: new Date("2026-09-25T09:00:00Z"),
  to: new Date("2026-09-26T09:00:00Z"),
  creatorId: "user-1",
  custodianUserId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
  vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
    createBookingSettings()
  );
  vi.mocked(db.booking.findFirst).mockResolvedValue(BOOKING_ROW as never);
  vi.mocked(checkoutBooking).mockResolvedValue({
    id: BOOKING_ID,
    name: "Load-in",
    status: "ONGOING",
  } as never);
  vi.mocked(partialCheckoutBooking).mockResolvedValue({
    checkedOutAssetCount: 1,
    remainingAssetCount: 0,
    isComplete: true,
    booking: { id: BOOKING_ID, name: "Load-in", status: "ONGOING" },
  } as never);
  vi.mocked(fulfilAndCheckOut).mockResolvedValue({
    booking: { id: BOOKING_ID, name: "Load-in", status: "ONGOING" },
    remainingAssetCount: 0,
  });
});

/** POSTs a JSON body to one of the routes under test. */
function post(
  action: typeof checkoutAction,
  path: string,
  body: Record<string, unknown>
) {
  return action(
    createActionArgs({
      request: new Request(`http://localhost:3000/api/mobile/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId: BOOKING_ID, ...body }),
      }),
      params: {},
    })
  );
}

/** The answers the service received, as plain pairs. */
function receivedSources(
  mock:
    | typeof checkoutBooking
    | typeof partialCheckoutBooking
    | typeof fulfilAndCheckOut
): Array<[string, string | null]> {
  const [args] = vi.mocked(mock).mock.calls[0] as unknown as [
    { sourceLocations?: SourceLocationSubmission },
  ];
  return [...(args.sourceLocations ?? new Map()).entries()];
}

const ROUTES = [
  {
    name: "bookings/checkout",
    action: checkoutAction,
    path: "bookings/checkout",
    service: checkoutBooking,
    body: {},
  },
  {
    name: "bookings/partial-checkout",
    action: partialAction,
    path: "bookings/partial-checkout",
    service: partialCheckoutBooking,
    body: {
      checkouts: [{ assetId: "pool-1", bookingAssetId: "ba-1", quantity: 10 }],
    },
  },
  {
    name: "bookings/fulfil-and-checkout",
    action: fulfilAction,
    path: "bookings/fulfil-and-checkout",
    service: fulfilAndCheckOut,
    body: { assetIds: ["pool-1"] },
  },
] as const;

describe.each(ROUTES)("POST /api/mobile/$name sourceLocations", (route) => {
  it("hands the picks to the service, Unplaced as null", async () => {
    const response = await post(route.action, route.path, {
      ...route.body,
      sourceLocations: { "ba-1": "loc-studio", "pool-2": null },
    });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
    expect(receivedSources(route.service)).toEqual([
      ["ba-1", "loc-studio"],
      ["pool-2", null],
    ]);
  });

  it("accepts a check-out from an app that sends no field, with no answers", async () => {
    const response = await post(route.action, route.path, route.body);

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
    expect(route.service).toHaveBeenCalledTimes(1);
    expect(receivedSources(route.service)).toEqual([]);
  });

  it("refuses a malformed value before anything is written", async () => {
    const response = await post(route.action, route.path, {
      ...route.body,
      sourceLocations: { "ba-1": 42 },
    });

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(route.service).not.toHaveBeenCalled();
  });
});
