import { OrganizationRoles } from "@prisma/client";
import { createBookingSettings } from "@factories";
import { mobileUserContext } from "@helpers/mobile-user-context";
import { createActionArgs } from "@mocks/remix";
import { action } from "~/routes/api+/mobile+/bookings.checkin";

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
  // why: the explicit-check-in gate and the ownership guard read the caller's
  // role through this; mocking it is how each test picks the role.
  getMobileUserContext: vi.fn(),
}));

// why: the route loads creatorId/custodianUserId for the ownership guard; mock
// the org-scoped lookup rather than hitting a database.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: external service — we mock the booking checkin to avoid database calls
vi.mock("~/modules/booking/service.server", () => ({
  checkinBooking: vi.fn(),
}));

// why: workspace settings drive the explicit-check-in gate — mock to avoid DB
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: we need to control error formatting in the catch block
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
import { checkinBooking } from "~/modules/booking/service.server";
import { makeShelfError, type ShelfError } from "~/utils/error";

/**
 * The row the route's org-scoped lookup returns: the booking's two ownership
 * links. Owned by the caller unless a test says otherwise.
 */
function bookingRow(
  owners: { creatorId: string; custodianUserId: string | null } = {
    creatorId: "user-1",
    custodianUserId: null,
  }
) {
  // why: the route selects these two columns; a full Booking adds nothing.
  return owners as never;
}

/** What `checkinBooking` returns, cut to the fields the route answers with. */
const CHECKED_IN_BOOKING = {
  id: "booking-1",
  name: "Test Booking",
  status: "COMPLETE",
} as Awaited<ReturnType<typeof checkinBooking>>;

function createCheckinRequest(body: Record<string, unknown>, orgId = "org-1") {
  return new Request(
    `http://localhost/api/mobile/bookings/checkin?orgId=${orgId}`,
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

describe("POST /api/mobile/bookings/checkin", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // The route reads only the caller's id from the auth result.
    vi.mocked(requireMobileAuth).mockResolvedValue({
      user: { id: "user-1" },
    } as Awaited<ReturnType<typeof requireMobileAuth>>);
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
    vi.mocked(assertMobileCanUseBookings).mockResolvedValue(undefined);
    // Default: an ADMIN caller who owns the booking, and explicit check-in NOT
    // required, so the quick check-in goes through.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(bookingRow());
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings()
    );
    vi.mocked(checkinBooking).mockResolvedValue(CHECKED_IN_BOOKING);
    // The route answers with the thrown error's own message and status.
    vi.mocked(makeShelfError).mockImplementation(
      (cause) => cause as ShelfError
    );
  });

  it("should checkin a booking and return booking data", async () => {
    const request = createCheckinRequest({ bookingId: "booking-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.success).toBe(true);
    expect(body.booking).toEqual({
      id: "booking-1",
      name: "Test Booking",
      status: "COMPLETE",
    });

    expect(checkinBooking).toHaveBeenCalledWith({
      id: "booking-1",
      organizationId: "org-1",
      hints: { timeZone: "UTC", locale: "en-US" },
      userId: "user-1",
    });
  });

  it("should return 403 when user lacks checkin permission", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValue(
      Object.assign(new Error("Permission denied"), { status: 403 })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");

    expect(checkinBooking).not.toHaveBeenCalled();
  });

  it("blocks quick check-in (403) when the workspace requires explicit check-in for the role", async () => {
    // Admin in a workspace that mandates explicit (scan/select) check-in for
    // admins — quick "check in all" must be refused, mirroring the web policy.
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckinForAdmin: true })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(403);
    // The quick check-in must NOT run — the user is forced to scan/select.
    expect(checkinBooking).not.toHaveBeenCalled();
  });

  it("answers 404 for a booking outside the workspace even when the check-in switch is on", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
    );
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckinForAdmin: true })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    const request = createCheckinRequest({ bookingId: "missing" });
    const result = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    // The booking is validated first; the policy is never consulted for a
    // booking the caller cannot see, so the settings are not read either.
    expect(result.status).toBe(404);
    expect(getBookingSettingsForOrganization).not.toHaveBeenCalled();
    expect(checkinBooking).not.toHaveBeenCalled();
  });

  it("settles ownership before the check-in policy for a SELF_SERVICE user on someone else's booking", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckinForSelfService: true })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow({ creatorId: "someone-else", custodianUserId: null })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    const result = (await action(
      createActionArgs({ request })
    )) as unknown as Response;

    expect(result.status).toBe(403);
    expect((await result.json()).error.message).not.toMatch(
      /explicit check-in/
    );
    expect(getBookingSettingsForOrganization).not.toHaveBeenCalled();
    expect(checkinBooking).not.toHaveBeenCalled();
  });

  it("refuses a SELF_SERVICE user checking in someone else's booking", async () => {
    // SELF_SERVICE holds `booking:checkin`, so the role gate above passes for
    // ANY booking id in the organization, and `checkinBooking` does not check
    // ownership itself. Only the ownership guard stops this.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.SELF_SERVICE] })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow({ creatorId: "someone-else", custodianUserId: "someone-else" })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    // The assertion that matters: the check-in never happens.
    expect(checkinBooking).not.toHaveBeenCalled();
  });

  it("still lets ADMIN check in a booking they do not own", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow({ creatorId: "someone-else", custodianUserId: "someone-else" })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    expect(checkinBooking).toHaveBeenCalled();
  });

  it("does not block a real ADMIN whose roles array starts with SELF_SERVICE", async () => {
    // `getMobileUserContext.role` is roles[0], so a membership ordered
    // [SELF_SERVICE, ADMIN] resolves to SELF_SERVICE — the guard would refuse
    // an actual admin. The guard reads the whole array instead.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      })
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(
      bookingRow({ creatorId: "someone-else", custodianUserId: "someone-else" })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    expect(checkinBooking).toHaveBeenCalled();
  });

  it("judges the explicit check-in policy by the most privileged role", async () => {
    // [SELF_SERVICE, ADMIN] is an admin, and the loader offers "Check In All"
    // to it when only the Self Service switch is on. The route must agree
    // rather than refuse by the array's first role.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      })
    );
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
      createBookingSettings({ requireExplicitCheckinForSelfService: true })
    );

    const request = createCheckinRequest({ bookingId: "booking-1" });
    await action(createActionArgs({ request }));

    expect(checkinBooking).toHaveBeenCalled();
  });
});
