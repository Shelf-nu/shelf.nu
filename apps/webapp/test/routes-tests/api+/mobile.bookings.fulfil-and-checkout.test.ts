/**
 * Tests for POST /api/mobile/bookings/fulfil-and-checkout: the explicit
 * check-out rule on the zero-scan case.
 *
 * A body that names no scanned unit performs a plain one-tap check-out through
 * this route, so the workspace's "require explicit check-out" switches must
 * refuse it for the covered roles exactly as the checkout route does, while a
 * body carrying scanned units (the fulfil scanner) stays open.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/bookings.fulfil-and-checkout.ts}
 * @see {@link file://./mobile.bookings.checkout.test.ts} — the checkout twin
 */
import { OrganizationRoles } from "@prisma/client";
import { createBookingSettings } from "@factories";
import { mobileUserContext } from "@helpers/mobile-user-context";
import { createActionArgs } from "@mocks/remix";
import { action } from "~/routes/api+/mobile+/bookings.fulfil-and-checkout";

// why: `data()` needs a router context; a plain Response carries the same
// status and body the assertions read.
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

// why: `data()` needs a router context; the mock above hands back a plain
// Response with the same status and body the assertions read.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: auth and org access are proven elsewhere; each case here picks the
// caller's roles through `getMobileUserContext`.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  assertMobileCanUseBookings: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: the sink the refusal must never reach.
vi.mock("~/modules/booking/service.server", () => ({
  fulfilModelRequestsAndCheckout: vi.fn(),
}));

// why: the booking window lookup; avoids a database.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    bookingModelRequest: { count: vi.fn() },
  },
}));

// why: the switch state under test, chosen per case.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: keep the route's own status codes visible instead of the error
// wrapper's mapping.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: { message: string; status?: number }) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  assertMobileCanUseBookings,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { fulfilModelRequestsAndCheckout } from "~/modules/booking/service.server";
import { makeShelfError, type ShelfError } from "~/utils/error";

const BOOKING_FROM = new Date("2026-07-01T09:00:00Z");
const BOOKING_TO = new Date("2026-07-01T17:00:00Z");

const FULFILLED_BOOKING = {
  id: "booking-1",
  name: "Test Booking",
  status: "ONGOING",
} as Awaited<ReturnType<typeof fulfilModelRequestsAndCheckout>>;

function createRequest(body: Record<string, unknown>, orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/bookings/fulfil-and-checkout?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/bookings/fulfil-and-checkout — explicit check-out rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as Awaited<ReturnType<typeof requireMobileAuth>>);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
    vi.mocked(assertMobileCanUseBookings).mockResolvedValue(undefined);
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      from: BOOKING_FROM,
      to: BOOKING_TO,
      creatorId: "user-1",
      custodianUserId: null,
    } as never);
    vi.mocked(db.bookingModelRequest.count).mockResolvedValue(0);
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings()
    );
    vi.mocked(fulfilModelRequestsAndCheckout).mockResolvedValue(
      FULFILLED_BOOKING
    );
    vi.mocked(makeShelfError).mockImplementation(
      (cause) => cause as ShelfError
    );
  });

  it("refuses a body on a booking with no open model requests when the Admin switch is on", async () => {
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckoutForAdmin: true })
    );

    const result = await action(
      createActionArgs({ request: createRequest({ bookingId: "booking-1" }) })
    );

    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("requires explicit check-out");
    expect(fulfilModelRequestsAndCheckout).not.toHaveBeenCalled();
  });

  it("judges the zero-scan body by the most privileged role of the membership", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      })
    );
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckoutForSelfService: true })
    );

    const result = await action(
      createActionArgs({ request: createRequest({ bookingId: "booking-1" }) })
    );

    // ADMIN wins, and only the Self Service switch is on, so this passes.
    expect((result as unknown as Response).status).toBe(200);
    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledTimes(1);
  });

  it("is not fooled by a body that names a blank kit id", async () => {
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckoutForAdmin: true })
    );

    const result = await action(
      createActionArgs({
        request: createRequest({ bookingId: "booking-1", kitIds: [""] }),
      })
    );

    expect((result as unknown as Response).status).toBe(403);
    expect(fulfilModelRequestsAndCheckout).not.toHaveBeenCalled();
  });

  it("stays open while the booking still has model requests to fulfil", async () => {
    vi.mocked(db.bookingModelRequest.count).mockResolvedValue(2);
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckoutForAdmin: true })
    );

    const result = await action(
      createActionArgs({
        request: createRequest({
          bookingId: "booking-1",
          assetIds: ["asset-1"],
        }),
      })
    );

    expect((result as unknown as Response).status).toBe(200);
    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "booking-1", assetIds: ["asset-1"] })
    );
  });

  it("lets the plain check-out through when no switch is on", async () => {
    const result = await action(
      createActionArgs({ request: createRequest({ bookingId: "booking-1" }) })
    );

    expect((result as unknown as Response).status).toBe(200);
    expect(fulfilModelRequestsAndCheckout).toHaveBeenCalledTimes(1);
  });
});
