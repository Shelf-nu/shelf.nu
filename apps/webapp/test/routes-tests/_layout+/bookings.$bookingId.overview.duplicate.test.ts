/**
 * Route action tests for `/bookings/:bookingId/overview/duplicate`.
 *
 * `booking:create` is the matrix gate and every role holds it, so the action
 * must also hold the SOURCE booking to the caller's reach before copying it.
 * These tests pin that wiring: a source outside the workspace 404s, a source
 * the caller may not duplicate 403s, and in both cases `duplicateBooking`
 * never runs. The rule itself is unit-tested on `assertCanDuplicateBooking`.
 *
 * @see {@link file://../../../app/routes/_layout+/bookings.$bookingId.overview.duplicate.tsx}
 * @see {@link file://../../../app/utils/booking-authorization.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { duplicateBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/_layout+/bookings.$bookingId.overview.duplicate";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the action reads the source booking straight from the database; the
// test supplies its ownership fields.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the copy itself is the service's concern; this test asserts only
// whether the route lets the call through.
vi.mock("~/modules/booking/service.server", () => ({
  duplicateBooking: vi.fn(),
  getBooking: vi.fn(),
  computeBookingKitDrift: vi.fn(),
}));

// why: permission resolution is mocked so each test can hand the route the
// access of the role under test.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

const ME = "user-1";
const SOMEONE_ELSE = "user-2";

const mockContext = {
  getSession: () => ({ userId: ME }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/** Submits the duplicate form as the given role. */
async function duplicateAs(role: OrganizationRoles) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    access: accessFor([role]),
  } as any);

  return (await action(
    createActionArgs({
      request: new Request(
        "http://localhost/bookings/booking-1/overview/duplicate",
        {
          method: "POST",
          body: new URLSearchParams({}),
        }
      ),
      params: { bookingId: "booking-1" },
      context: mockContext,
    })
  )) as any;
}

describe("bookings.$bookingId.overview.duplicate action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks the source up inside the caller's workspace and 404s when absent", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    const response = await duplicateAs(OrganizationRoles.ADMIN);

    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1", organizationId: "org-1" },
      })
    );
    expect(response.init?.status).toBe(404);
    expect(duplicateBooking).not.toHaveBeenCalled();
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s on another member's booking",
    async (role) => {
      vi.mocked(db.booking.findFirst).mockResolvedValue({
        creatorId: SOMEONE_ELSE,
        custodianUserId: SOMEONE_ELSE,
      } as any);

      const response = await duplicateAs(role);

      expect(response.init?.status).toBe(403);
      expect(duplicateBooking).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s on a booking it created in someone else's custody",
    async (role) => {
      vi.mocked(db.booking.findFirst).mockResolvedValue({
        creatorId: ME,
        custodianUserId: SOMEONE_ELSE,
      } as any);

      const response = await duplicateAs(role);

      expect(response.init?.status).toBe(403);
      expect(duplicateBooking).not.toHaveBeenCalled();
    }
  );
});
