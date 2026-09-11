import { OrganizationRoles } from "@prisma/client";
import { action } from "~/routes/api+/mobile+/bookings.checkout";
import { createActionArgs } from "@mocks/remix";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
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

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  assertMobileCanUseBookings: vi.fn(),
  // why: the cross-user ownership guard resolves the caller's role through
  // this; mocking it is how each test picks SELF_SERVICE vs ADMIN.
  getMobileUserContext: vi.fn(),
}));

// why: external service — we mock the booking checkout to avoid database calls
vi.mock("~/modules/booking/service.server", () => ({
  checkoutBooking: vi.fn(),
}));

// why: the endpoint now loads the booking's from/to (so checkoutBooking's
// conflict guard fires) — mock the org-scoped lookup to avoid a DB call.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: workspace settings drive the explicit-check-out gate — mock to avoid DB
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: we need to control error formatting in the catch block
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn(),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
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
import { checkoutBooking } from "~/modules/booking/service.server";
import { makeShelfError } from "~/utils/error";

/** The workspace's explicit check-out switches, both off unless a test says. */
function explicitCheckout({
  admin = false,
  selfService = false,
}: { admin?: boolean; selfService?: boolean } = {}) {
  return {
    requireExplicitCheckoutForAdmin: admin,
    requireExplicitCheckoutForSelfService: selfService,
  };
}

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

// The booking's stored reservation window, returned by the org-scoped lookup.
const BOOKING_FROM = new Date("2026-07-01T09:00:00Z");
const BOOKING_TO = new Date("2026-07-01T17:00:00Z");

function createCheckoutRequest(body: Record<string, unknown>, orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/bookings/checkout?orgId=${orgId}`,
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

describe("POST /api/mobile/bookings/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    // Default: the caller owns the booking, so the ownership guard is a
    // no-op and the pre-existing cases still test what they were written for.
    (getMobileUserContext as any).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );
    // Default: explicit check-out is not required, so the one-tap path is open.
    (getBookingSettingsForOrganization as any).mockResolvedValue(
      explicitCheckout()
    );
    // The route answers with the error's own message and status.
    (makeShelfError as any).mockImplementation(
      (cause: { message: string; status?: number }) => ({
        message: cause.message,
        status: cause.status ?? 500,
      })
    );
    (db.booking.findFirst as any).mockResolvedValue({
      from: BOOKING_FROM,
      to: BOOKING_TO,
      // Owned by the caller so the ownership guard is a no-op here.
      creatorId: "user-1",
      custodianUserId: null,
    });
    (assertMobileCanUseBookings as any).mockResolvedValue(undefined);
  });

  it("should checkout a booking and pass its window so the conflict guard fires", async () => {
    (checkoutBooking as any).mockResolvedValue({
      id: "booking-1",
      name: "Test Booking",
      status: "ONGOING",
    });

    const request = createCheckoutRequest({ bookingId: "booking-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.booking).toEqual({
      id: "booking-1",
      name: "Test Booking",
      status: "ONGOING",
    });

    // Regression guard: the booking's from/to MUST be forwarded, otherwise
    // checkoutBooking's `if (from && to)` conflict check is skipped and a
    // reserved/overlapping asset is silently double-booked.
    expect(checkoutBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      hints: { timeZone: "UTC", locale: "en-US" },
      userId: "user-1",
      from: BOOKING_FROM,
      to: BOOKING_TO,
    });
  });

  it("returns 404 when the booking is not in the workspace", async () => {
    (db.booking.findFirst as any).mockResolvedValue(null);

    const request = createCheckoutRequest({ bookingId: "missing" });
    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(404);
    expect(checkoutBooking).not.toHaveBeenCalled();
  });

  it("should return 403 when user lacks checkout permission", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);
    (makeShelfError as any).mockReturnValue({
      message: "Permission denied",
      status: 403,
    });

    const request = createCheckoutRequest({ bookingId: "booking-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");

    expect(checkoutBooking).not.toHaveBeenCalled();
  });

  it("refuses a SELF_SERVICE user checking out someone else's booking", async () => {
    // SELF_SERVICE holds `booking:checkout`, so the role gate above passes for
    // ANY booking id in the organization. Only the ownership guard stops this.
    (getMobileUserContext as any).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );
    (db.booking.findFirst as any).mockResolvedValue({
      from: BOOKING_FROM,
      to: BOOKING_TO,
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });

    const request = createCheckoutRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    // The assertion that matters: the checkout never happens.
    expect(checkoutBooking).not.toHaveBeenCalled();
  });

  it("still lets ADMIN check out a booking they do not own", async () => {
    // The guard is a no-op for ADMIN/OWNER — it must not break admin workflows.
    (getMobileUserContext as any).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );
    (db.booking.findFirst as any).mockResolvedValue({
      from: BOOKING_FROM,
      to: BOOKING_TO,
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });

    const request = createCheckoutRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    expect(checkoutBooking).toHaveBeenCalled();
  });

  it("does not block a real ADMIN whose roles array starts with SELF_SERVICE", async () => {
    // `getMobileUserContext.role` is roles[0], so a membership ordered
    // [SELF_SERVICE, ADMIN] resolves to SELF_SERVICE — the guard would refuse
    // an actual admin. The guard reads the whole array instead.
    (getMobileUserContext as any).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      })
    );
    (db.booking.findFirst as any).mockResolvedValue({
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });

    const request = createCheckoutRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    expect(checkoutBooking).toHaveBeenCalled();
  });
  describe("explicit check-out requirement", () => {
    const EXPLICIT_MESSAGE =
      "This workspace requires explicit check-out. Scan or select the assets to check them out.";

    it("refuses an ADMIN's one-tap check-out (403) when admins must check out explicitly", async () => {
      (getMobileUserContext as any).mockResolvedValue(
        mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
      );
      (getBookingSettingsForOrganization as any).mockResolvedValue(
        explicitCheckout({ admin: true })
      );

      const request = createCheckoutRequest({ bookingId: "booking-1" });
      const result = (await action(
        createActionArgs({ request })
      )) as unknown as Response;

      expect(result.status).toBe(403);
      expect((await result.json()).error.message).toBe(EXPLICIT_MESSAGE);
      // The one-tap check-out must NOT run: the user scans or selects instead.
      expect(checkoutBooking).not.toHaveBeenCalled();
    });

    it("refuses a SELF_SERVICE user's one-tap check-out when their switch is on", async () => {
      (getBookingSettingsForOrganization as any).mockResolvedValue(
        explicitCheckout({ selfService: true })
      );

      const request = createCheckoutRequest({ bookingId: "booking-1" });
      const result = (await action(
        createActionArgs({ request })
      )) as unknown as Response;

      expect(result.status).toBe(403);
      expect((await result.json()).error.message).toBe(EXPLICIT_MESSAGE);
      expect(checkoutBooking).not.toHaveBeenCalled();
    });

    it("lets the OWNER check out in one tap whatever the switches say", async () => {
      (getMobileUserContext as any).mockResolvedValue(
        mobileUserContext({ roles: [OrganizationRoles.OWNER] })
      );
      (getBookingSettingsForOrganization as any).mockResolvedValue(
        explicitCheckout({ admin: true, selfService: true })
      );
      (checkoutBooking as any).mockResolvedValue({
        id: "booking-1",
        name: "Test Booking",
        status: "ONGOING",
      });

      const request = createCheckoutRequest({ bookingId: "booking-1" });
      const result = (await action(
        createActionArgs({ request })
      )) as unknown as Response;

      expect(result.status).toBe(200);
      expect(checkoutBooking).toHaveBeenCalledTimes(1);
    });

    it("lets an ADMIN through when only the Self Service switch is on", async () => {
      (getMobileUserContext as any).mockResolvedValue(
        mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
      );
      (getBookingSettingsForOrganization as any).mockResolvedValue(
        explicitCheckout({ selfService: true })
      );

      const request = createCheckoutRequest({ bookingId: "booking-1" });
      await action(createActionArgs({ request }));

      expect(checkoutBooking).toHaveBeenCalledTimes(1);
    });

    it("judges a multi-role membership by its most privileged role", async () => {
      // [SELF_SERVICE, ADMIN] is an admin: the Self Service switch does not
      // apply, even though SELF_SERVICE comes first in the array.
      (getMobileUserContext as any).mockResolvedValue(
        mobileUserContext({
          roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
        })
      );
      (getBookingSettingsForOrganization as any).mockResolvedValue(
        explicitCheckout({ selfService: true })
      );

      const request = createCheckoutRequest({ bookingId: "booking-1" });
      await action(createActionArgs({ request }));

      expect(checkoutBooking).toHaveBeenCalledTimes(1);
    });
  });
});
