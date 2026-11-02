/**
 * POST /api/mobile/bookings/duplicate: the payload the companion reads after a
 * copy. It reports what the copy left out (archived assets, and model
 * reservations the dates could not fill) so the app can say so. The consumer
 * side is pinned in `apps/companion/lib/booking-duplicate-note.test.ts`.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.duplicate.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";

// why: data() must return a real Response so the body can be read back
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: external auth; the caller is an admin in org-1
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

// why: the org-scoped lookup of the source's window; no database in tests
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the copy itself is covered by the service tests; here only what the
// route passes on matters
vi.mock("~/modules/booking/service.server", () => ({
  duplicateBooking: vi.fn(),
}));

import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { duplicateBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/api+/mobile+/bookings.duplicate";

// @vitest-environment node

/** POSTs `{ bookingId: "booking-1" }` to the endpoint as user-1 in org-1. */
function post() {
  return action({
    request: new Request(
      "http://localhost/api/mobile/bookings/duplicate?orgId=org-1",
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

describe("POST /api/mobile/bookings/duplicate: what the copy left out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: [OrganizationRoles.ADMIN] }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "booking-1",
      from: new Date("2099-08-01T09:00:00Z"),
      to: new Date("2099-08-03T17:00:00Z"),
    } as never);
  });

  it("returns the archived count and the models reserved short", async () => {
    const reducedModelReservations = [
      {
        assetModelId: "model-camera",
        assetModelName: "Camera",
        requested: 4,
        reserved: 1,
      },
    ];
    vi.mocked(duplicateBooking).mockResolvedValue({
      id: "booking-2",
      name: "B (Copy)",
      status: "DRAFT",
      droppedArchivedCount: 2,
      reducedModelReservations,
    } as never);

    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      booking: { id: "booking-2", name: "B (Copy)", status: "DRAFT" },
      droppedArchivedCount: 2,
      reducedModelReservations,
    });
  });
});
