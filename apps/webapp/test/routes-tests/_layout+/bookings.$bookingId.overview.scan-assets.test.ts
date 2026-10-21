/**
 * Booking scan-assets action: who may add scanned items to which booking.
 *
 * Every role holds `booking:update`, so the permission check settles nothing
 * about the booking being written to. The action must also hold the caller to
 * bookings they own and to the same add rule as every other add path: every
 * role adds to a DRAFT, and only roles that manage items after DRAFT add to a
 * reserved or running booking.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.scan-assets.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { addScannedAssetsToBooking } from "~/modules/booking/service.server";
import { requirePermission } from "~/utils/roles.server";

import { action } from "~/routes/_layout+/bookings.$bookingId.overview.scan-assets";

// @vitest-environment node

// why: the action reads the target booking's status and owners; that read is
// what each case varies.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the permission check reads the session cookie and the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the write under test; whether it is reached IS the assertion.
vi.mock("~/modules/booking/service.server", () => ({
  addScannedAssetsToBooking: vi.fn(),
  getBooking: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const CALLER = "user-1";

/** Scans one asset into booking-1 as `role`, against a booking in `booking`. */
async function scanAdd(
  role: OrganizationRoles,
  booking: { status: string; creatorId: string; custodianUserId: string | null }
) {
  vi.mocked(requirePermission).mockResolvedValue(
    permissionContext({ roles: [role] }) as Awaited<
      ReturnType<typeof requirePermission>
    >
  );
  vi.mocked(db.booking.findFirst).mockResolvedValue(booking as never);

  return (await action(
    createActionArgs({
      request: new Request(
        "http://localhost/bookings/booking-1/overview/scan-assets",
        {
          method: "POST",
          body: new URLSearchParams({ "assetIds[0]": "asset-1" }),
        }
      ),
      params: { bookingId: "booking-1" },
      context: { getSession: () => ({ userId: CALLER }) } as never,
    })
    // Refusals come back as `data(error(reason), { status })`.
  )) as { init?: { status?: number } } | Response;
}

const statusOf = (result: Awaited<ReturnType<typeof scanAdd>>) =>
  result instanceof Response ? result.status : result.init?.status;

describe("booking scan-assets action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "refuses %s adding to a booking someone else owns",
    async (role) => {
      const result = await scanAdd(role, {
        status: "DRAFT",
        creatorId: "owner",
        custodianUserId: "owner",
      });

      expect(statusOf(result)).toBe(403);
      expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "refuses %s adding to their own RESERVED booking",
    async (role) => {
      const result = await scanAdd(role, {
        status: "RESERVED",
        creatorId: CALLER,
        custodianUserId: CALLER,
      });

      expect(statusOf(result)).toBe(403);
      expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "lets %s add to their own DRAFT",
    async (role) => {
      await scanAdd(role, {
        status: "DRAFT",
        creatorId: CALLER,
        custodianUserId: CALLER,
      });

      expect(addScannedAssetsToBooking).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: "booking-1",
          assetIds: ["asset-1"],
        })
      );
    }
  );

  it.each([OrganizationRoles.OWNER, OrganizationRoles.ADMIN])(
    "lets %s add to someone else's RESERVED booking",
    async (role) => {
      await scanAdd(role, {
        status: "RESERVED",
        creatorId: "someone-else",
        custodianUserId: "someone-else",
      });

      expect(addScannedAssetsToBooking).toHaveBeenCalledTimes(1);
    }
  );

  it("answers 404 for a booking outside the workspace", async () => {
    const result = await scanAdd(OrganizationRoles.ADMIN, null as never);

    expect(statusOf(result)).toBe(404);
    expect(addScannedAssetsToBooking).not.toHaveBeenCalled();
  });
});
