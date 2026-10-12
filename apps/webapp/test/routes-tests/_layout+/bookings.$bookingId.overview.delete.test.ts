/**
 * Booking page action: the `delete` and `extend-booking` guards a direct POST
 * is held to.
 *
 * SELF_SERVICE and BASE delete only their own DRAFT bookings; ADMIN deletes any
 * booking. BASE holds no `booking:extend`, so it is refused extending. A
 * refused request never reaches `deleteBooking` / `extendBooking`.
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

// why: data()/redirect() must produce real Responses so statuses are assertable
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

// why: the booking lookup feeds the guard, and deleteBooking / extendBooking
// are the sinks a refused request must never reach; all avoid a database
const { getBookingMock, deleteBookingMock, extendBookingMock } = vi.hoisted(
  () => ({
    getBookingMock: vi.fn(),
    deleteBookingMock: vi.fn(),
    extendBookingMock: vi.fn(),
  })
);
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  // The typed-confirmation check stays real, reading the mocked database below.
  ...(await importOriginal<object>()),
  getBooking: getBookingMock,
  deleteBooking: deleteBookingMock,
  extendBooking: extendBookingMock,
}));

// why: the actor lookup, notes and toast run after a successful delete and
// would otherwise reach the database or the event emitter
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "A",
    lastName: "B",
    displayName: null,
  }),
}));
vi.mock("~/modules/note/service.server", () => ({ createNotes: vi.fn() }));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));

const findBookingMock = vi.hoisted(() => vi.fn());

// why: no database in tests; the delete intent reads only the booking's name
// (for the typed confirmation, through the real `assertBookingDeleteConfirmed`),
// everything else goes through the mocked services above
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: findBookingMock } },
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview";

// @vitest-environment node

/** The signed-in user making every request. */
const CALLER = "user-1";

/** Makes `requirePermission` answer with the real matrix for `roles`. */
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

/** POSTs `body` to the booking page action as {@link CALLER}. */
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

/**
 * POSTs the `delete` intent as `roles` against a booking in `status`, with the
 * booking's name typed as the dialog asks unless `confirmation` says otherwise.
 */
function postDelete({
  roles,
  status,
  creatorId = CALLER,
  custodianUserId = null,
  confirmation = "B",
}: {
  roles: OrganizationRoles[];
  status: string;
  creatorId?: string;
  custodianUserId?: string | null;
  confirmation?: string;
}) {
  actAs(roles);
  findBookingMock.mockResolvedValue({ name: "B" });
  getBookingMock.mockResolvedValue({
    id: "booking-1",
    status,
    creatorId,
    custodianUserId,
  });
  deleteBookingMock.mockResolvedValue({
    id: "booking-1",
    name: "B",
    bookingAssets: [],
  });

  return post({ intent: "delete", confirmation });
}

describe("booking page delete intent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses SELF_SERVICE deleting its own RESERVED booking", async () => {
    const response = await postDelete({
      roles: [OrganizationRoles.SELF_SERVICE],
      status: "RESERVED",
    });
    expect(response.status).toBe(403);
    expect(deleteBookingMock).not.toHaveBeenCalled();
  });

  it("lets SELF_SERVICE delete its own draft", async () => {
    const response = await postDelete({
      roles: [OrganizationRoles.SELF_SERVICE],
      status: "DRAFT",
    });
    expect(deleteBookingMock).toHaveBeenCalledTimes(1);
    // The draft-only rule is re-checked when the row is deleted.
    expect(deleteBookingMock.mock.calls[0][3]).toEqual({ onlyIfDraft: true });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/bookings");
  });

  it("refuses BASE on someone else's draft", async () => {
    const response = await postDelete({
      roles: [OrganizationRoles.BASE],
      status: "DRAFT",
      creatorId: "someone-else",
    });
    expect(response.status).toBe(403);
    expect(deleteBookingMock).not.toHaveBeenCalled();
  });

  it("refuses a delete posted without the booking's name", async () => {
    const response = await postDelete({
      roles: [OrganizationRoles.ADMIN],
      status: "DRAFT",
      confirmation: "",
    });
    expect(response.status).toBe(400);
    expect(deleteBookingMock).not.toHaveBeenCalled();
  });

  it("accepts the name in another case", async () => {
    await postDelete({
      roles: [OrganizationRoles.ADMIN],
      status: "DRAFT",
      confirmation: " b ",
    });
    expect(deleteBookingMock).toHaveBeenCalledTimes(1);
  });

  it("lets ADMIN delete someone else's ONGOING booking", async () => {
    const response = await postDelete({
      roles: [OrganizationRoles.ADMIN],
      status: "ONGOING",
      creatorId: "someone-else",
    });
    expect(deleteBookingMock).toHaveBeenCalledTimes(1);
    // A role that may delete any status needs no write-time draft check.
    expect(deleteBookingMock.mock.calls[0][3]).toEqual({ onlyIfDraft: false });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/bookings");
  });
});

describe("booking page extend-booking intent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses BASE, which holds no booking:extend", async () => {
    actAs([OrganizationRoles.BASE]);

    const response = await post({
      intent: "extend-booking",
      endDate: "2030-01-01T17:00",
    });

    expect(response.status).toBe(403);
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "booking", action: "extend" })
    );
    expect(extendBookingMock).not.toHaveBeenCalled();
  });
});
