/**
 * Booking page one-click `checkOut` and `checkIn` intents: the route hands the
 * booking to the service and writes no asset activity line of its own. The
 * service writes each asset's "checked out asset with" / "checked in asset
 * with" line, on every path, so a line written here would be the asset's
 * second.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 * @see {@link file://./../../../app/modules/booking/service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";

// why: data() must return a real Response so the status is assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: the caller is an admin; the permission gate is not under test
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: the services own the asset lines and are covered by their own tests;
// here they only have to hand a booking back
const { checkoutBookingMock, checkinBookingMock } = vi.hoisted(() => ({
  checkoutBookingMock: vi.fn(),
  checkinBookingMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  checkoutBooking: checkoutBookingMock,
  checkinBooking: checkinBookingMock,
}));

// why: the note writer is the sink the route must never reach for these intents
const { createNotesMock } = vi.hoisted(() => ({
  createNotesMock: vi.fn(),
}));
vi.mock("~/modules/note/service.server", () => ({
  createNotes: createNotesMock,
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

/** POSTs `intent` to the booking page action as a workspace admin. */
async function post(intent: "checkOut" | "checkIn") {
  requirePermissionMock.mockResolvedValue(
    permissionContext({ roles: [OrganizationRoles.ADMIN] })
  );
  return (await action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams({ intent }),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never)) as Response;
}

describe("booking page one-click check-out and check-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const booking = { id: "booking-1", name: "Test Booking" };
    checkoutBookingMock.mockResolvedValue(booking);
    checkinBookingMock.mockResolvedValue(booking);
  });

  it.each([
    { intent: "checkOut" as const, service: checkoutBookingMock },
    { intent: "checkIn" as const, service: checkinBookingMock },
  ])(
    "$intent leaves the asset lines to the service",
    async ({ intent, service }) => {
      const response = await post(intent);

      expect(response.status).toBe(200);
      expect(service).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "booking-1",
          userId: "user-1",
          provenance: { surface: "web", method: "quick" },
        })
      );
      expect(createNotesMock).not.toHaveBeenCalled();
    }
  );
});
