/**
 * Bookings bulk actions: each intent is gated on its own permission, through
 * the real matrix, and the services receive the caller's access.
 *
 * Archive and cancel need `booking:archive` / `booking:cancel`, which BASE does
 * not hold, so BASE is refused both. Delete passes the caller's access to
 * `bulkDeleteBookings`, which applies the drafts-only rule.
 *
 * @see {@link file://../../../app/routes/api+/bookings.bulk-actions.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";
import { PermissionEntity } from "~/utils/permissions/permission.data";
import type { PermissionAction } from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

// why: data() must return a real Response so the error path has a status
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: requirePermission loads the membership from the database; this stand-in
// applies the same matrix to a chosen role so the gate under test is real
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: the bulk services are the sinks a refused request must never reach
vi.mock("~/modules/booking/service.server", () => ({
  bulkArchiveBookings: vi.fn(),
  bulkCancelBookings: vi.fn(),
  bulkDeleteBookings: vi.fn(),
}));

// why: the success toast goes through the event emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import {
  bulkArchiveBookings,
  bulkCancelBookings,
  bulkDeleteBookings,
} from "~/modules/booking/service.server";
import { action } from "~/routes/api+/bookings.bulk-actions";

// @vitest-environment node

/** The arguments the route passes to `requirePermission` that this suite reads. */
type PermissionArgs = { entity: PermissionEntity; action: PermissionAction };

/** Makes `requirePermission` answer with the real matrix for `role`. */
function asRole(role: OrganizationRoles) {
  requirePermissionMock.mockImplementation(
    async ({ entity, action: permissionAction }: PermissionArgs) => {
      if (
        !userHasPermission({ roles: [role], entity, action: permissionAction })
      ) {
        throw new ShelfError({
          cause: null,
          message: "Forbidden",
          status: 403,
          label: "Permission",
          shouldBeCaptured: false,
        });
      }
      return permissionContext({ roles: [role] });
    }
  );
}

/** POSTs `intent` for one selected booking as user-1. */
function post(intent: string) {
  const body = new URLSearchParams({ intent, "bookingIds[0]": "booking-1" });
  return action({
    request: new Request("https://app.shelf.nu/api/bookings/bulk-actions", {
      method: "POST",
      body,
    }),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never) as unknown as Promise<Response>;
}

describe("POST /api/bookings/bulk-actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["bulk-archive", bulkArchiveBookings],
    ["bulk-cancel", bulkCancelBookings],
  ] as const)(
    "refuses BASE %s, which lacks the action's own grant",
    async (intent, service) => {
      asRole(OrganizationRoles.BASE);
      const response = await post(intent);
      expect(response.status).toBe(403);
      expect(service).not.toHaveBeenCalled();
    }
  );

  it("asks for booking:archive and booking:cancel, not booking:update", async () => {
    asRole(OrganizationRoles.ADMIN);
    await post("bulk-archive");
    await post("bulk-cancel");
    const calls = requirePermissionMock.mock.calls as [PermissionArgs][];
    expect(calls.map(([args]) => args.action)).toEqual(["archive", "cancel"]);
    expect(
      calls.every(([args]) => args.entity === PermissionEntity.booking)
    ).toBe(true);
  });

  it("lets SELF_SERVICE bulk-archive, scoped to its own bookings by access", async () => {
    asRole(OrganizationRoles.SELF_SERVICE);
    const response = await post("bulk-archive");
    expect(response.status).toBe(200);
    expect(bulkArchiveBookings).toHaveBeenCalledWith(
      expect.objectContaining({
        access: expect.objectContaining({
          bookings: expect.objectContaining({ writeAll: false }),
        }),
      })
    );
  });

  it("passes access to bulk delete, which applies the draft rule", async () => {
    asRole(OrganizationRoles.BASE);
    await post("bulk-delete");
    expect(bulkDeleteBookings).toHaveBeenCalledWith(
      expect.objectContaining({
        access: expect.objectContaining({ role: "BASE" }),
      })
    );
  });
});
