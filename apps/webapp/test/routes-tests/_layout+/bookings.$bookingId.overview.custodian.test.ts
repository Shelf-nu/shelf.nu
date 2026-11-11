/**
 * Booking page `save` and `reserve` intents: the custodian a request names is
 * loaded from the caller's workspace, a member whose booking custodian is
 * fixed to themself may only name themself, and the user linked to the
 * booking is the one on the team member row, never the posted `userId`.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 * @see {@link file://./../../../app/modules/booking/booking-custodian.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";

// why: data() must return a real Response so the status is assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: requirePermission loads the membership from the database; each test
// hands back the access of the role under test
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: updateBasicBooking / reserveBooking are the sinks under observation
const { updateBasicBookingMock, reserveBookingMock } = vi.hoisted(() => ({
  updateBasicBookingMock: vi.fn(),
  reserveBookingMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", () => ({
  updateBasicBooking: updateBasicBookingMock,
  reserveBooking: reserveBookingMock,
}));

// why: the custodian lookup is an org-scoped database read; each test states
// which team member row the workspace holds
const { getTeamMemberMock } = vi.hoisted(() => ({
  getTeamMemberMock: vi.fn(),
}));
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: getTeamMemberMock,
}));

// why: stands in for the booking form schema so the cases exercise the
// custodian rule without building dates that satisfy the future-date and
// working-hours rules
vi.mock("~/components/booking/forms/forms-schema", async () => {
  const { z } = await import("zod");
  return {
    ...(await vi.importActual("~/components/booking/forms/forms-schema")),
    BookingFormSchema: () =>
      z.object({
        name: z.string(),
        description: z.string().optional(),
        tags: z.string().optional(),
        custodian: z
          .string()
          .transform(
            (value) =>
              JSON.parse(value) as { id: string; name: string; userId?: string }
          ),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
      }),
  };
});

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
// why: the acting user's date preferences are read from the database
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
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
import { ShelfError } from "~/utils/error";

// @vitest-environment node

/** The signed-in user making every request. */
const CALLER = "user-1";

/** Team member rows in the caller's workspace, keyed by id. */
const TEAM_MEMBERS: Record<string, { id: string; userId: string | null }> = {
  "tm-self": { id: "tm-self", userId: CALLER },
  "tm-other": { id: "tm-other", userId: "user-other" },
  "tm-nrm": { id: "tm-nrm", userId: null },
};

/**
 * POSTs `intent` as a member holding `role`, naming `custodian`, against a
 * DRAFT booking the caller created whose custodian is `tm-self`.
 */
async function post({
  intent,
  role,
  custodian,
}: {
  intent: "save" | "reserve";
  role: OrganizationRoles;
  custodian: { id: string; userId?: string };
}) {
  requirePermissionMock.mockResolvedValue({
    ...permissionContext({ roles: [role] }),
    organizationId: "org-1",
  });
  findBookingMock.mockResolvedValue({
    id: "booking-1",
    status: "DRAFT",
    from: null,
    to: null,
    creatorId: CALLER,
    custodianUserId: CALLER,
    custodianTeamMemberId: "tm-self",
  });
  getTeamMemberMock.mockImplementation(async ({ id }: { id: string }) => {
    const row = TEAM_MEMBERS[id];
    // getTeamMember reports a missing member as an uncaptured 404.
    if (!row)
      throw new ShelfError({
        cause: null,
        message: "Team member not found",
        label: "Team Member",
        status: 404,
        shouldBeCaptured: false,
      });
    return row;
  });
  updateBasicBookingMock.mockResolvedValue({ id: "booking-1" });
  reserveBookingMock.mockResolvedValue({ id: "booking-1" });

  return (await action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams({
        intent,
        name: "Booking",
        custodian: JSON.stringify({ name: "Someone", ...custodian }),
      }),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never)) as Response;
}

/** The service each intent writes through. */
const sinkFor = {
  save: updateBasicBookingMock,
  reserve: reserveBookingMock,
} as const;

describe("booking page save and reserve custodian", () => {
  beforeEach(() => vi.clearAllMocks());

  describe.each(["save", "reserve"] as const)("%s", (intent) => {
    it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
      "refuses %s naming another member, even when posting its own user id",
      async (role) => {
        const response = await post({
          intent,
          role,
          custodian: { id: "tm-other", userId: CALLER },
        });

        expect(response.status).toBe(403);
        expect(sinkFor[intent]).not.toHaveBeenCalled();
      }
    );

    it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
      "books the resolved team member, never the posted user id, for %s",
      async (role) => {
        const response = await post({
          intent,
          role,
          custodian: { id: "tm-self", userId: "user-other" },
        });

        expect(response.status).toBe(200);
        const [args] = sinkFor[intent].mock.calls[0];
        expect(args.custodianTeamMemberId).toBe("tm-self");
        // The service reads the custodian user from the team member row.
        expect(args).not.toHaveProperty("custodianUserId");
      }
    );

    it("lets an admin name another member", async () => {
      const response = await post({
        intent,
        role: OrganizationRoles.ADMIN,
        custodian: { id: "tm-other", userId: CALLER },
      });

      expect(response.status).toBe(200);
      const [args] = sinkFor[intent].mock.calls[0];
      expect(args.custodianTeamMemberId).toBe("tm-other");
      expect(args).not.toHaveProperty("custodianUserId");
    });

    it("books a member without a user", async () => {
      const response = await post({
        intent,
        role: OrganizationRoles.ADMIN,
        custodian: { id: "tm-nrm", userId: "user-other" },
      });

      expect(response.status).toBe(200);
      const [args] = sinkFor[intent].mock.calls[0];
      expect(args.custodianTeamMemberId).toBe("tm-nrm");
      expect(args).not.toHaveProperty("custodianUserId");
    });

    it("refuses a team member outside the workspace", async () => {
      const response = await post({
        intent,
        role: OrganizationRoles.ADMIN,
        custodian: { id: "tm-foreign" },
      });

      expect(response.status).toBe(404);
      expect(sinkFor[intent]).not.toHaveBeenCalled();
    });
  });
});
