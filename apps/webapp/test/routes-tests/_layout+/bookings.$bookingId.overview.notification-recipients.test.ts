/**
 * Booking page `updateNotificationRecipients` intent: only members whose
 * policy lets them manage a booking's recipients may change them, whatever
 * `booking:update` says.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";

// why: data() must return a real Response so the status is assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: each case chooses the caller's roles; the permission gate is not under test
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: the recipients writer is the sink a refused request must never reach
const { updateRecipientsMock } = vi.hoisted(() => ({
  updateRecipientsMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  updateBookingNotificationRecipients: updateRecipientsMock,
}));

// why: the booking lookup, working hours and settings run before the intent
// switch; the caller owns the booking so the ownership guard passes
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirstOrThrow: vi.fn().mockResolvedValue({
        id: "booking-1",
        status: "RESERVED",
        from: null,
        to: null,
        creatorId: "user-1",
        custodianUserId: "user-1",
      }),
    },
  },
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

/** POSTs two recipients to the booking page action as a member holding `roles`. */
async function postRecipients(roles: OrganizationRoles[]) {
  requirePermissionMock.mockResolvedValue(permissionContext({ roles }));
  return (await action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams({
        intent: "updateNotificationRecipients",
        notificationRecipientIds: "tm-1,tm-2",
      }),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never)) as Response;
}

describe("booking page updateNotificationRecipients intent", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
    "refuses %s on its own booking",
    async (role) => {
      const response = await postRecipients([role]);
      expect(response.status).toBe(403);
      expect(updateRecipientsMock).not.toHaveBeenCalled();
    }
  );

  it("lets ADMIN set the recipients", async () => {
    await postRecipients([OrganizationRoles.ADMIN]);
    expect(updateRecipientsMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamMemberIds: ["tm-1", "tm-2"] })
    );
  });
});
