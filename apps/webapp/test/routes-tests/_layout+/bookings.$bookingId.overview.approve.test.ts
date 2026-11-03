/**
 * Booking page action: the `approve-booking` and `revert-to-draft` intents.
 *
 * Approving asks for `booking:approve`, which the requesting roles do not
 * hold, so a Base member posting the intent on their own request is refused
 * before the service runs. Reverting carries the optional reason through to
 * the service, where the custodian's email reads it.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 */
// @vitest-environment node
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";
import type {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

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

// why: the subject is the route's gate and hand-over, not the approval or the
// revert itself, which the service tests cover.
const { approveBookingMock, revertBookingToDraftMock } = vi.hoisted(() => ({
  approveBookingMock: vi.fn(),
  revertBookingToDraftMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  approveBooking: approveBookingMock,
  revertBookingToDraft: revertBookingToDraftMock,
}));

// why: the action reads working hours and booking settings beside the
// booking; neither decides these intents.
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({
    enableWorkingHours: false,
    weeklySchedule: {},
    overrides: [],
  }),
}));
vi.mock("~/modules/booking-settings/service.server", async () => {
  const { createBookingSettings } = await import("@factories");
  return {
    getBookingSettingsForOrganization: vi.fn().mockImplementation(async () =>
      createBookingSettings({
        requireApprovalForBase: true,
        requireApprovalForSelfService: true,
      })
    ),
  };
});
// why: the action loads the acting user for its notes; no database here.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "A",
    lastName: "B",
    displayName: null,
  }),
}));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));

// why: the ownership guard reads the booking's creator and custodian.
const findBookingMock = vi.hoisted(() => vi.fn());
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirstOrThrow: findBookingMock, findFirst: findBookingMock },
  },
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview";

const CALLER = "user-1";

function actAs(roles: OrganizationRoles[]) {
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
}

function post(body: Record<string, string>) {
  return action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams(body),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never) as unknown as Promise<Response>;
}

beforeEach(() => {
  vi.clearAllMocks();
  findBookingMock.mockResolvedValue({
    id: "booking-1",
    name: "Camera kit",
    status: "RESERVED",
    from: new Date("2030-01-01T09:00:00.000Z"),
    to: new Date("2030-01-01T17:00:00.000Z"),
    creatorId: "student-1",
    custodianUserId: "student-1",
  });
  approveBookingMock.mockResolvedValue({ id: "booking-1" });
  revertBookingToDraftMock.mockResolvedValue({ id: "booking-1" });
});

describe("booking page approve-booking intent", () => {
  it("refuses a Base member, who holds no booking:approve", async () => {
    actAs([OrganizationRoles.BASE]);

    const response = await post({ intent: "approve-booking" });

    expect(response.status).toBe(403);
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "booking", action: "approve" })
    );
    expect(approveBookingMock).not.toHaveBeenCalled();
  });

  it("hands a Manager's approval to the service", async () => {
    actAs([OrganizationRoles.MANAGER]);

    const response = await post({ intent: "approve-booking" });

    // A success is the route's plain payload, not a Response; only a refusal
    // arrives as one.
    expect(response instanceof Response ? response.status : 200).toBe(200);
    // `payload()` stamps `error: null` on every success, so test the value.
    expect(response).toMatchObject({ success: true });
    expect(approveBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "booking-1",
        organizationId: "org-1",
        userId: CALLER,
      })
    );
  });
});

describe("booking page revert-to-draft intent", () => {
  it("passes the reason through to the service", async () => {
    actAs([OrganizationRoles.MANAGER]);

    const response = await post({
      intent: "revert-to-draft",
      revertReason: "  Pick a shorter slot  ",
    });

    expect(response instanceof Response ? response.status : 200).toBe(200);
    expect(revertBookingToDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "booking-1",
        reason: "Pick a shorter slot",
      })
    );
  });

  it("sends no reason when the box was left empty", async () => {
    actAs([OrganizationRoles.ADMIN]);

    await post({ intent: "revert-to-draft", revertReason: "" });

    expect(revertBookingToDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: undefined })
    );
  });
});
