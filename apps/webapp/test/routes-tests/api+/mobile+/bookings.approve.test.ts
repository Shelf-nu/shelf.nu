/**
 * POST /api/mobile/bookings/approve: the phone's approve action asks the same
 * permission the web intent asks and runs the same ownership check as the
 * other booking mutations, then hands the approval to the shared service.
 *
 * @see {@link file://./../../../../app/routes/api+/mobile+/bookings.approve.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";

// why: `data()` from react-router returns a data object the test cannot read
// a status from; a plain Response keeps the assertions on status and body.
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: the auth gates read the database and the request's token; the subject
// is what the route does once they pass.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn().mockResolvedValue(undefined),
  assertMobileCanUseBookings: vi.fn().mockResolvedValue(undefined),
  getMobileUserContext: vi.fn(),
}));

// why: the rate limiter needs a store; it never decides a route's answer.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: the route reads one booking row for the ownership check.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the approval itself (stamp, note, email) is the service's job and has
// its own tests; here only the hand-over matters.
vi.mock("~/modules/booking/service.server", () => ({
  approveBooking: vi.fn(),
}));

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { approveBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/api+/mobile+/bookings.approve";
import { PermissionAction } from "~/utils/permissions/permission.data";

function post(body: unknown = { bookingId: "booking-1" }) {
  return action({
    request: new Request(
      "http://localhost/api/mobile/bookings/approve?orgId=org-1",
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
  } as never) as unknown as Promise<Response>;
}

describe("POST /api/mobile/bookings/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "booking-1",
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    } as never);
    vi.mocked(approveBooking).mockResolvedValue({
      id: "booking-1",
      name: "Camera kit",
      status: "RESERVED",
      approvedAt: new Date("2026-11-02T12:00:00.000Z"),
    } as never);
  });

  it("asks for the booking:approve permission, the web intent's answer", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.MANAGER] }) as never
    );

    const response = await post();

    expect(response.status).toBe(200);
    expect(requireMobilePermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: PermissionAction.approve })
    );
    expect(approveBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "booking-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    );
    const body = (await response.json()) as {
      booking: { id: string; status: string; approvedAt: string };
    };
    expect(body.booking.status).toBe("RESERVED");
    expect(body.booking.approvedAt).toBe("2026-11-02T12:00:00.000Z");
  });

  it("answers 404 for a booking outside the caller's workspace", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.MANAGER] }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue(null as never);

    const response = await post();

    expect(response.status).toBe(404);
    expect(approveBooking).not.toHaveBeenCalled();
  });

  it("refuses a body without a booking id", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.MANAGER] }) as never
    );

    const response = await post({});

    expect(response.status).toBe(400);
    expect(approveBooking).not.toHaveBeenCalled();
  });
});
