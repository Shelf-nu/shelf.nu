/**
 * Bookings bulk actions: each intent is gated on its own permission, through
 * the real matrix, and the services receive the caller's access.
 *
 * Archive and cancel need `booking:archive` / `booking:cancel`, which BASE does
 * not hold, so BASE is refused both. Delete passes the caller's access to
 * `bulkDeleteBookings`, which applies the drafts-only rule.
 *
 * The dialogs also post which bookings list they were opened on (a kit's or an
 * asset's Bookings tab, or the index), which a "Select all" stands for. The
 * route hands it to the services and refuses a request naming both.
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

/** POSTs `intent` for one selected booking as user-1, plus any `fields`. */
function post(intent: string, fields: Record<string, string> = {}) {
  const body = new URLSearchParams({
    intent,
    "bookingIds[0]": "booking-1",
    ...fields,
  });
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

describe("POST /api/bookings/bulk-actions: which list a select all stands for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole(OrganizationRoles.ADMIN);
  });

  const INTENTS = [
    ["bulk-delete", bulkDeleteBookings],
    ["bulk-archive", bulkArchiveBookings],
    ["bulk-cancel", bulkCancelBookings],
  ] as const;

  it.each(INTENTS)(
    "hands %s the kit's bookings when the dialog posts a kitId",
    async (intent, service) => {
      const response = await post(intent, {
        bookingsList: "kit",
        kitId: "kit-1",
      });

      expect(response.status).toBe(200);
      expect(vi.mocked(service).mock.calls[0][0]).toMatchObject({
        list: { kind: "kit", kitId: "kit-1" },
      });
    }
  );

  it.each(INTENTS)(
    "hands %s the asset's bookings when the dialog posts an assetId",
    async (intent, service) => {
      const response = await post(intent, {
        bookingsList: "asset",
        assetId: "asset-1",
      });

      expect(response.status).toBe(200);
      expect(vi.mocked(service).mock.calls[0][0]).toMatchObject({
        list: { kind: "asset", assetId: "asset-1" },
      });
    }
  );

  it.each(INTENTS)(
    "hands %s the bookings index when the dialog posts bookingsList=index",
    async (intent, service) => {
      const response = await post(intent, { bookingsList: "index" });

      expect(response.status).toBe(200);
      expect(vi.mocked(service).mock.calls[0][0]).toMatchObject({
        list: { kind: "index" },
      });
    }
  );

  it.each(INTENTS)(
    "hands %s no list when the form names none, so select all can refuse it",
    async (intent, service) => {
      const response = await post(intent);

      expect(response.status).toBe(200);
      expect(vi.mocked(service).mock.calls[0][0]).toMatchObject({
        list: null,
      });
    }
  );

  it.each(INTENTS)(
    "refuses %s when a kit's list posts no kitId",
    async (intent, service) => {
      const response = await post(intent, { bookingsList: "kit" });

      expect(response.status).toBe(400);
      expect(service).not.toHaveBeenCalled();
    }
  );

  it.each(INTENTS)(
    "refuses %s when both a kitId and an assetId are posted",
    async (intent, service) => {
      const response = await post(intent, {
        bookingsList: "kit",
        kitId: "kit-1",
        assetId: "asset-1",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: {
          message:
            "A bookings list belongs to a kit or to an asset, not to both.",
        },
      });
      expect(service).not.toHaveBeenCalled();
    }
  );
});
