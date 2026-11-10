/**
 * Booking page `discard-draft` intent: how members without `booking:delete`
 * drop a draft. It archives the draft, so it is gated on `booking:archive`,
 * held to the caller's own bookings, and hands the service `discardDraft` so
 * only a DRAFT is accepted.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";
import type {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

// why: data() must return a real Response so the status is assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: requirePermission loads the membership from the database; this stand-in
// applies the real matrix to the chosen roles, so the permission gate is real
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: archiveBooking is the sink a refused request must never reach
const { archiveBookingMock } = vi.hoisted(() => ({
  archiveBookingMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  archiveBooking: archiveBookingMock,
}));

// why: the booking lookup before the intent switch feeds the ownership guard
const { findBookingMock } = vi.hoisted(() => ({
  findBookingMock: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirstOrThrow: findBookingMock } },
}));
// why: working hours are read before the intent switch and need a database
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue(null),
}));
// why: booking settings are read before the intent switch and need a database
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({}),
}));
// why: the actor lookup runs before the intent switch and needs a database
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "A",
    lastName: "B",
    displayName: null,
  }),
}));
// why: the organization cookie is set on every action and needs the session store
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));
// why: the success toast goes through the event emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview";

// @vitest-environment node

/** The signed-in user making every request. */
const CALLER = "user-1";

/**
 * POSTs `discard-draft` as a member holding `roles`, against a DRAFT booking
 * created by `creatorId`. The permission gate applies the real matrix.
 */
async function postDiscard({
  roles,
  creatorId = CALLER,
}: {
  roles: OrganizationRoles[];
  creatorId?: string;
}) {
  requirePermissionMock.mockImplementation(
    async ({
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
      return permissionContext({ roles });
    }
  );
  findBookingMock.mockResolvedValue({
    id: "booking-1",
    status: "DRAFT",
    from: null,
    to: null,
    creatorId,
    custodianUserId: null,
  });

  return (await action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams({ intent: "discard-draft" }),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never)) as Response;
}

describe("booking page discard-draft intent", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "lets %s discard its own draft, asking for booking:archive",
    async (role) => {
      const response = await postDiscard({ roles: [role] });

      expect(response.status).toBe(200);
      expect(requirePermissionMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "booking", action: "archive" })
      );
      expect(archiveBookingMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: "booking-1", discardDraft: true })
      );
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s on someone else's draft",
    async (role) => {
      const response = await postDiscard({
        roles: [role],
        creatorId: "someone-else",
      });

      expect(response.status).toBe(403);
      expect(archiveBookingMock).not.toHaveBeenCalled();
    }
  );
});
