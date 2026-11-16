/**
 * POST /api/mobile/bookings/delete: the guards a direct request is held to.
 * The `booking:delete` gate runs on the real matrix, so BASE and SELF_SERVICE
 * (which hold no delete grant) are refused even on their own drafts; they
 * discard drafts instead. A mixed membership is judged by its highest role.
 * Ownership (`assertCanDeleteBooking`, shared with the web delete intent) is
 * pinned in `booking-authorization.server.test.ts`.
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

// why: external auth; each case picks the caller's roles through the context,
// and `actAs` makes the permission gate answer with the real matrix for them
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn(),
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

import {
  getMobileUserContext,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { db } from "~/database/db.server";
import { deleteBooking } from "~/modules/booking/service.server";
import { action } from "~/routes/api+/mobile+/bookings.delete";
import { ShelfError } from "~/utils/error";
import type {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

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

/**
 * Acts as a member holding `roles`: the context carries them and the
 * permission gate answers with the real matrix (403 when the grant is missing).
 */
function actAs(roles: OrganizationRoles[]) {
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles }) as never
  );
  vi.mocked(requireMobilePermission).mockImplementation((async ({
    entity,
    action: permissionAction,
  }: {
    entity: PermissionEntity;
    action: PermissionAction;
  }) => {
    if (!userHasPermission({ roles, entity, action: permissionAction })) {
      throw new ShelfError({
        cause: null,
        message: "Forbidden",
        status: 403,
        label: "Permission",
        shouldBeCaptured: false,
      });
    }
  }) as never);
}

/** The booking the org-scoped lookup returns. */
function bookingRow(
  creatorId: string,
  custodianUserId: string | null,
  status: string
) {
  vi.mocked(db.booking.findFirst).mockResolvedValue({
    id: "booking-1",
    creatorId,
    custodianUserId,
    status,
  } as never);
}

describe("POST /api/mobile/bookings/delete: permission and ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteBooking).mockResolvedValue(undefined as never);
  });

  it.each([
    [OrganizationRoles.BASE, "DRAFT"],
    [OrganizationRoles.BASE, "RESERVED"],
    [OrganizationRoles.SELF_SERVICE, "DRAFT"],
    [OrganizationRoles.SELF_SERVICE, "RESERVED"],
  ])("refuses %s deleting its own %s booking", async (role, status) => {
    actAs([role]);
    bookingRow("user-1", "user-1", status);

    expect((await post()).status).toBe(403);
    expect(requireMobilePermission).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "booking", action: "delete" })
    );
    expect(deleteBooking).not.toHaveBeenCalled();
  });

  it("judges a mixed [SELF_SERVICE, ADMIN] membership by its highest role", async () => {
    actAs([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN]);
    bookingRow("someone-else", "someone-else", "ONGOING");

    expect((await post()).status).toBe(200);
    expect(deleteBooking).toHaveBeenCalledTimes(1);
  });
});
