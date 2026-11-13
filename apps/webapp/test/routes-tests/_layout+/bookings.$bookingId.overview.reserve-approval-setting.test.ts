/**
 * Booking page action: the `reserve` intent passes the caller's approval
 * setting to the reserve service.
 *
 * Whether a reservation becomes a pending approval request is decided inside
 * `reserveBooking` from the reserving member's
 * `access.policy.bookings.approvalSetting` and the workspace switches. The
 * route forwards that setting as `actorApprovalSetting`, resolved from the
 * caller's own roles by the real policy table, and words its toast from the
 * booking the service returns: an unapproved booking reads as a request.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 */
// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBookingSettings } from "@factories";
import { permissionContext } from "@helpers/role-access";

// why: `data()` returns an object the test cannot read a status from; a plain
// Response keeps the assertions on status.
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: the real gate loads the membership from the database; each case hands
// the action the roles under test and lets the shared resolver answer.
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: reserveBooking writes, emails and schedules; it is the sink whose input
// the route is judged on. The service tests cover the approval decision.
const { reserveBookingMock } = vi.hoisted(() => ({
  reserveBookingMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reserveBooking: reserveBookingMock,
}));

// why: the action reads working hours and booking settings from the
// database; working hours off, and both approval switches on so the toast
// wording depends only on the booking the service returns.
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn(),
}));
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));

// why: the action loads the acting user for its notes; no database here.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: the reserve intent loads the custodian's team member row from the
// database; every case reserves for the caller's own team member.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTeamMember: vi.fn().mockResolvedValue({ id: "tm-1", userId: "user-1" }),
}));

// why: the toast is a side effect on the notification emitter; its title is
// asserted below.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the selected-workspace cookie is signed with the session secret.
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn(),
}));

// why: the ownership guard reads the booking's creator and custodian, and the
// date parsing reads the user's stored format prefs; no database in tests.
const { findBookingMock, findUserMock } = vi.hoisted(() => ({
  findBookingMock: vi.fn(),
  findUserMock: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirstOrThrow: findBookingMock, findFirst: findBookingMock },
    user: { findFirst: findUserMock },
  },
}));

import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { action } from "~/routes/_layout+/bookings.$bookingId.overview";
import { sendNotification } from "~/utils/emitter/send-notification.server";

/** The acting user, also the draft's creator and custodian. */
const CALLER = "user-1";

/**
 * POSTs the reserve form for booking-1 as {@link CALLER}.
 *
 * @returns The action's result
 */
function reserve() {
  return action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams({
        intent: "reserve",
        id: "booking-1",
        name: "Camera kit",
        custodian: JSON.stringify({
          id: "tm-1",
          name: "Member One",
          userId: CALLER,
        }),
        startDate: "2030-06-03T09:00",
        endDate: "2030-06-03T17:00",
        tags: "",
      }),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  findBookingMock.mockResolvedValue({
    id: "booking-1",
    status: "DRAFT",
    from: new Date("2030-06-03T09:00:00.000Z"),
    to: new Date("2030-06-03T17:00:00.000Z"),
    creatorId: CALLER,
    custodianUserId: CALLER,
    custodianTeamMemberId: "tm-1",
  });
  findUserMock.mockResolvedValue(null);
  vi.mocked(getWorkingHoursForOrganization).mockResolvedValue({
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  } as never);
  vi.mocked(getBookingSettingsForOrganization).mockResolvedValue(
    createBookingSettings({
      requireApprovalForBase: true,
      requireApprovalForSelfService: true,
    }) as never
  );
  vi.mocked(getUserByID).mockResolvedValue({
    id: CALLER,
    firstName: "A",
    lastName: "B",
    displayName: null,
  } as never);
  vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue(
    "org=org-1" as never
  );
  reserveBookingMock.mockResolvedValue({
    id: "booking-1",
    status: "RESERVED",
    approvedAt: new Date("2030-06-01T00:00:00.000Z"),
  });
});

describe("booking page reserve intent forwards the caller's approval setting", () => {
  it.each([
    { role: OrganizationRoles.BASE, expected: "base" },
    { role: OrganizationRoles.SELF_SERVICE, expected: "selfService" },
    { role: OrganizationRoles.ADMIN, expected: "none" },
  ])(
    "passes actorApprovalSetting $expected for a $role caller",
    async ({ role, expected }) => {
      requirePermissionMock.mockResolvedValue(
        permissionContext({ roles: [role] })
      );

      const response = await reserve();

      // A success is the route's plain payload, not a Response; only a
      // refusal arrives as one.
      expect(response instanceof Response ? response.status : 200).toBe(200);
      expect(reserveBookingMock).toHaveBeenCalledTimes(1);
      expect(reserveBookingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "booking-1",
          organizationId: "org-1",
          userId: CALLER,
          actorApprovalSetting: expected,
        })
      );
    }
  );

  it("words the toast as a request when the service leaves the booking unapproved", async () => {
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.BASE] })
    );
    reserveBookingMock.mockResolvedValue({
      id: "booking-1",
      status: "RESERVED",
      approvedAt: null,
    });

    await reserve();

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Request sent" })
    );
  });
});
