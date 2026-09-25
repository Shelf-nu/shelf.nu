/**
 * POST /api/mobile/bookings/delete: the delete guard a direct request is held
 * to (`assertCanDeleteBooking`, shared with the web delete intent). Seeing a
 * booking (workspace toggle) never grants deleting it, roles whose policy
 * limits delete to drafts are held to drafts, and a mixed membership is judged
 * by its highest role.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.delete.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";

// why: data() must return a real Response so the error path has a status
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

// why: the org-scoped booking lookup feeds the guard; no database in tests
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: deleteBooking is the sink a refused request must never reach
vi.mock("~/modules/booking/service.server", () => ({
  deleteBooking: vi.fn(),
}));

import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { deleteBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/api+/mobile+/bookings.delete";

// @vitest-environment node

/** POSTs `{ bookingId: "booking-1" }` to the endpoint as user-1 in org-1. */
function post() {
  return action({
    request: new Request(
      "http://localhost/api/mobile/bookings/delete?orgId=org-1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer t",
        },
        body: JSON.stringify({ bookingId: "booking-1" }),
      }
    ),
    params: {},
    context: {},
  } as never) as unknown as Promise<Response>;
}

describe("POST /api/mobile/bookings/delete: ownership and status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteBooking).mockResolvedValue(undefined as never);
  });

  it("holds BASE to its own drafts", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.BASE] }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "booking-1",
      creatorId: "user-1",
      custodianUserId: null,
      status: "RESERVED",
    } as never);

    expect((await post()).status).toBe(403);
    expect(deleteBooking).not.toHaveBeenCalled();
  });

  it("refuses SELF_SERVICE on someone else's booking with the see-toggle on", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE],
        workspace: { selfServiceCanSeeBookings: true },
      }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "booking-1",
      creatorId: "someone-else",
      custodianUserId: "someone-else",
      status: "DRAFT",
    } as never);

    expect((await post()).status).toBe(403);
    expect(deleteBooking).not.toHaveBeenCalled();
  });

  it("judges a mixed [SELF_SERVICE, ADMIN] membership by its highest role (B9)", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: [OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN],
      }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "booking-1",
      creatorId: "someone-else",
      custodianUserId: "someone-else",
      status: "ONGOING",
    } as never);

    expect((await post()).status).toBe(200);
    expect(deleteBooking).toHaveBeenCalledTimes(1);
  });
});
