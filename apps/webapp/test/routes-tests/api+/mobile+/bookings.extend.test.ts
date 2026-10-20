/**
 * POST /api/mobile/bookings/extend: what a direct request from the phone is
 * held to before the shared `extendBooking` service runs, and what it answers.
 *
 * The `booking:extend` permission, the workspace lookup, ownership, the status
 * gate, the shared extend schema, the declared time zone and the service's
 * end-date rules each refuse with their own message. A clash the
 * service reports names the clashing bookings in the message, the only field
 * the phone reads. On success the response carries the end date the service
 * stored.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.extend.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";
import { ShelfError } from "~/utils/error";

// why: data() must return a real Response so the status and body are assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: external auth; each case picks the caller's roles through the context
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn().mockResolvedValue(undefined),
  assertMobileCanUseBookings: vi.fn().mockResolvedValue(undefined),
  getMobileUserContext: vi.fn(),
}));

// why: rate limiting is infrastructure, not under test
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: the org-scoped booking lookup feeds every gate; no database in tests
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: extendBooking writes, emails and schedules; it is the sink whose input
// and result the route is judged on
vi.mock("~/modules/booking/service.server", () => ({
  extendBooking: vi.fn(),
}));

// why: workspace settings come from the database; off and unlimited, so only
// the date rules under test can refuse
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi
    .fn()
    .mockResolvedValue({ enabled: false, weeklySchedule: {}, overrides: [] }),
}));
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    bufferStartTime: 0,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
  }),
}));

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { extendBooking } from "~/modules/booking/service.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { action } from "~/routes/api+/mobile+/bookings.extend";

// @vitest-environment node

/** An ONGOING booking owned by user-1 that currently ends 2030-05-31 06:30 UTC. */
const ONGOING_BOOKING = {
  id: "booking-1",
  status: "ONGOING",
  from: new Date("2030-05-30T06:30:00.000Z"),
  to: new Date("2030-05-31T06:30:00.000Z"),
  creatorId: "user-1",
  custodianUserId: "user-1",
};

/**
 * POSTs `body` to the endpoint as user-1 in org-1.
 *
 * @param body - The JSON request body
 * @returns The response status and parsed JSON body
 */
async function post(body: Record<string, unknown>) {
  const response = await (action({
    request: new Request(
      "http://localhost/api/mobile/bookings/extend?orgId=org-1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer t",
        },
        body: JSON.stringify(body),
      }
    ),
    params: {},
    context: {},
  } as never) as unknown as Promise<Response>);
  return { status: response.status, body: await response.json() };
}

/** Extends booking-1 to 14:30 Kuala Lumpur time on 2030-06-01 (06:30 UTC). */
function extendToKualaLumpurAfternoon() {
  return post({
    bookingId: "booking-1",
    endDate: "2030-06-01T14:30",
    timeZone: "Asia/Kuala_Lumpur",
  });
}

describe("POST /api/mobile/bookings/extend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.OWNER] }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(ONGOING_BOOKING as never);
  });

  it("gates on booking:extend and refuses before touching the booking", async () => {
    vi.mocked(requireMobilePermission).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "You are not authorized to extend bookings.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(403);
    expect(body.error.message).toBe(
      "You are not authorized to extend bookings."
    );
    expect(requireMobilePermission).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      entity: PermissionEntity.booking,
      action: PermissionAction.extend,
    });
    expect(db.booking.findFirst).not.toHaveBeenCalled();
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("answers 404 for a booking that is not in the caller's workspace", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(404);
    expect(body).toEqual({
      error: { message: "Booking not found in this workspace." },
    });
    expect(vi.mocked(db.booking.findFirst).mock.calls[0]?.[0]?.where).toEqual({
      id: "booking-1",
      organizationId: "org-1",
    });
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("refuses SELF_SERVICE on someone else's booking even with the see-toggle on", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE],
        workspace: { selfServiceCanSeeBookings: true },
      }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      ...ONGOING_BOOKING,
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    } as never);

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(403);
    expect(body.error.message).toBe(
      "You are not authorized to extend this booking."
    );
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("refuses a booking that has not started", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      ...ONGOING_BOOKING,
      status: "RESERVED",
    } as never);

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(400);
    expect(body.error.message).toBe(
      "Extending booking is not allowed for current status."
    );
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("passes the service's refusal of an end equal to the current end through as a 400", async () => {
    // The rule lives in the service, for web and phone alike; the phone sees
    // its message and status unchanged.
    vi.mocked(extendBooking).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "The booking already ends at that date.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(400);
    expect(body.error.message).toBe("The booking already ends at that date.");
  });

  it("refuses a new end in the past with the shared schema's message", async () => {
    const { status, body } = await post({
      bookingId: "booking-1",
      endDate: "2020-01-01T10:00",
      timeZone: "Asia/Kuala_Lumpur",
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe("Start date must be in the future");
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("refuses a time zone that is not an IANA zone", async () => {
    const { status, body } = await post({
      bookingId: "booking-1",
      endDate: "2030-06-01T14:30",
      timeZone: "Mars/Olympus",
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe("Time zone must be a valid IANA zone");
    expect(extendBooking).not.toHaveBeenCalled();
  });

  it("extends to the wall clock decoded in the declared zone and returns the stored end", async () => {
    // The service hands back a Date unlike the one it was given, so the
    // response can only match it by reading the result.
    vi.mocked(extendBooking).mockResolvedValue({
      id: "booking-1",
      name: "Site survey",
      status: "ONGOING",
      to: new Date("2030-06-01T05:30:00.000Z"),
    } as never);

    const { status, body } = await extendToKualaLumpurAfternoon();

    expect(status).toBe(200);
    expect(body).toEqual({
      booking: {
        id: "booking-1",
        name: "Site survey",
        status: "ONGOING",
        to: "2030-06-01T05:30:00.000Z",
      },
    });
    expect(extendBooking).toHaveBeenCalledTimes(1);
    const args = vi.mocked(extendBooking).mock.calls[0][0];
    expect(args.id).toBe("booking-1");
    expect(args.organizationId).toBe("org-1");
    expect(args.userId).toBe("user-1");
    expect(args.newEndDate).toEqual(new Date("2030-06-01T06:30:00.000Z"));
    expect(args.hints.timeZone).toBe("Asia/Kuala_Lumpur");
    expect(args.roles).toEqual([OrganizationRoles.OWNER]);
  });

  it("names the clashing bookings in the message the phone shows", async () => {
    vi.mocked(extendBooking).mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "Cannot extend booking because the extended period is overlapping with the following bookings:",
        label: "Booking",
        additionalData: {
          clashingBookings: [{ id: "b2", name: "Camera day" }],
        },
      })
    );

    const { body } = await extendToKualaLumpurAfternoon();

    expect(body.error.message).toBe(
      "Cannot extend booking because the extended period is overlapping with the following bookings: Camera day"
    );
  });
});
