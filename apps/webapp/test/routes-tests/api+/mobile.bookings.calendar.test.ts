import { loader } from "~/routes/api+/mobile+/bookings.calendar";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() so the loader returns real Response objects
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: external auth — no Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: the draft-privacy clause is shared with the list; we assert it is
// APPLIED, not what it contains — that belongs to the service's own tests.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: vi.fn(() => ({ __draftClause: true })),
  // Sentinels, not reimplementations. Which bookings a self-service user may
  // see is decided by these two shared helpers, and web uses the same pair;
  // the route's job is to delegate to them with the right arguments, so that
  // is what is asserted. Copying their logic into the mock would only test the
  // copy.
  resolveCustodianScope: vi.fn(async () => ({
    userId: "user-1",
    teamMemberIds: ["tm-1"],
  })),
  custodianScopeClause: vi.fn(() => ({ __custodianClause: true })),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      // why: the loader also asks what this filter matches OUTSIDE the visible
      // month, so the calendar can say "9 more" rather than looking empty.
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    // The custodian scope resolves a user's team-member records, so a
    // self-service user is matched through those links too, not only their
    // user link.
    teamMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// why: keeps ShelfError status codes observable in the response without the
// real error pipeline logging through them.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message ?? "error",
    status: cause?.status ?? 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import { db } from "~/database/db.server";
import {
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

const mockDb = db as unknown as {
  booking: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

/** The `where` the loader handed Prisma on its last call. */
function lastWhere() {
  return mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.where;
}

function calendarRequest(qs: string) {
  return new Request(`http://localhost/api/mobile/bookings/calendar?${qs}`, {
    headers: { Authorization: "Bearer token" },
  });
}

const RANGE = "start=2026-08-01T00:00:00.000Z&end=2026-08-31T23:59:59.000Z";

describe("GET /api/mobile/bookings/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({ user: { id: "user-1" } });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (getMobileUserContext as any).mockResolvedValue({ roles: ["ADMIN"] });
    mockDb.booking.findMany.mockResolvedValue([]);
    mockDb.booking.count.mockResolvedValue(0);
    mockDb.booking.findFirst.mockResolvedValue(null);
  });

  describe("the date window", () => {
    it("selects bookings that OVERLAP the window, not ones contained by it", async () => {
      // why: this is the whole reason the calendar is not filtered on `from`.
      // A job running 28 Jul to 3 Aug belongs on the August calendar; a
      // containment filter would hide it and the month would look free.
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      const where = lastWhere();
      expect(where.from).toEqual({ lte: new Date("2026-08-31T23:59:59.000Z") });
      expect(where.to).toEqual({ gte: new Date("2026-08-01T00:00:00.000Z") });
    });

    it("rejects a missing window rather than silently answering for all time", async () => {
      const res = await loader(
        createLoaderArgs({ request: calendarRequest("orgId=org-1") })
      );

      expect((res as unknown as Response).status).toBe(400);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });

    it("rejects an end before the start", async () => {
      const res = await loader(
        createLoaderArgs({
          request: calendarRequest(
            "start=2026-08-31T00:00:00.000Z&end=2026-08-01T00:00:00.000Z"
          ),
        })
      );

      expect((res as unknown as Response).status).toBe(400);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });

    it("refuses a window wider than a year", async () => {
      // why: the window is client supplied and a fast swipe can ask for a lot.
      const res = await loader(
        createLoaderArgs({
          request: calendarRequest(
            "start=2020-01-01T00:00:00.000Z&end=2026-01-01T00:00:00.000Z"
          ),
        })
      );

      expect((res as unknown as Response).status).toBe(400);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });
  });

  describe("the status filter, which must compose with the lens switch", () => {
    it("applies exactly the statuses the pills asked for", async () => {
      await loader(
        createLoaderArgs({
          request: calendarRequest(`${RANGE}&statuses=RESERVED,ONGOING`),
        })
      );

      expect(lastWhere().status).toEqual({ in: ["RESERVED", "ONGOING"] });
    });

    it("falls back to every visible status when no filter is sent", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().status.in).toEqual([
        "DRAFT",
        "RESERVED",
        "ONGOING",
        "OVERDUE",
        "COMPLETE",
      ]);
    });

    it("leaves CANCELLED and ARCHIVED out until they are asked for", async () => {
      // A cancelled job is not a commitment and must not make a week look busy,
      // so it is absent by default - which is also what web's getBookings does.
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      const statuses = lastWhere().status.in;
      expect(statuses).not.toContain("CANCELLED");
      expect(statuses).not.toContain("ARCHIVED");
    });

    it("returns them when the filter explicitly asks", async () => {
      // The "All" pill asks for all seven and the list answers with all seven.
      // Dropping two of them here made one pill mean two different things
      // depending on which lens you were looking through. Web honours an
      // explicit status filter on its calendar too.
      await loader(
        createLoaderArgs({
          request: calendarRequest(`${RANGE}&statuses=CANCELLED,ARCHIVED`),
        })
      );

      expect(lastWhere().status).toEqual({ in: ["CANCELLED", "ARCHIVED"] });
    });

    it("ignores an unknown status instead of failing the request", async () => {
      // why: an older app build must degrade, not hard-fail, against a newer
      // server that has renamed or dropped a status.
      const res = await loader(
        createLoaderArgs({
          request: calendarRequest(`${RANGE}&statuses=RESERVED,NONSENSE`),
        })
      );

      expect((res as unknown as Response).status).toBe(200);
      expect(lastWhere().status).toEqual({ in: ["RESERVED"] });
    });
  });

  describe("who can see what", () => {
    it("scopes a SELF_SERVICE user through the shared custodian clause", async () => {
      (getMobileUserContext as any).mockResolvedValue({
        roles: ["SELF_SERVICE"],
      });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      // Resolved for THIS user in THIS org...
      expect(resolveCustodianScope).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
      });
      // ...and the resolved scope, including the team-member links, is what
      // builds the clause. Matching only `custodianUserId` hid bookings from
      // the person they belong to whenever the custodian was assigned by
      // picking a team member rather than a user.
      expect(custodianScopeClause).toHaveBeenCalledWith({
        userId: "user-1",
        teamMemberIds: ["tm-1"],
      });
      expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
    });

    it("scopes a BASE user the same way", async () => {
      (getMobileUserContext as any).mockResolvedValue({ roles: ["BASE"] });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(custodianScopeClause).toHaveBeenCalled();
      expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
    });

    it("does not narrow an ADMIN to their own bookings", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(resolveCustodianScope).not.toHaveBeenCalled();
      expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
    });

    it("always applies the draft-privacy clause", async () => {
      // why: a DRAFT booking is private to its creator. The calendar draws
      // bands from the same rows, so it needs the same guard as the list.
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().AND).toEqual([{ __draftClause: true }]);
    });

    it("always scopes to the caller's organisation", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().organizationId).toBe("org-1");
    });

    it("reads the most privileged role, not whichever one is stored first", async () => {
      // The regression this guards: the context's `role` is `roles[0]`, so a
      // membership stored `[SELF_SERVICE, ADMIN]` narrowed a genuine admin to
      // bookings they are custodian of - their colleagues' bookings vanished
      // from the grid while the list lens still showed them.
      (getMobileUserContext as any).mockResolvedValue({
        roles: ["SELF_SERVICE", "ADMIN"],
      });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(resolveCustodianScope).not.toHaveBeenCalled();
      expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
    });

    it("answers for a personal workspace, exactly as the list lens does", async () => {
      // why: the two lenses share one screen and one query. Gating this one on
      // workspace type and not the other meant tapping the calendar replaced
      // the day panel with a raw server string and left no way back. The gate
      // belongs on the write paths, which keep it.
      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );

      expect((res as unknown as Response).status).toBe(200);
      expect(mockDb.booking.findMany).toHaveBeenCalled();
    });
  });

  describe("what lies outside the visible month", () => {
    it("reports the count and where to jump, so the month never just looks empty", async () => {
      // why: the bookings LIST is date-blind — Active shows every open booking
      // whenever it falls — while this grid shows one month. Without this the
      // same filter shows nine bookings in a list and an empty calendar, with
      // nothing explaining the difference.
      mockDb.booking.count.mockResolvedValue(9);
      mockDb.booking.findFirst.mockResolvedValue({
        from: new Date("2026-09-13T09:00:00.000Z"),
      });

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.outsideWindow.count).toBe(9);
      expect(body.outsideWindow.jumpTo).toContain("2026-09-13");
    });

    it("excludes the visible month from that count", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      const countWhere = mockDb.booking.count.mock.calls.at(-1)?.[0]?.where;
      expect(countWhere.NOT).toEqual({
        AND: [
          { from: { lte: new Date("2026-08-31T23:59:59.000Z") } },
          { to: { gte: new Date("2026-08-01T00:00:00.000Z") } },
        ],
      });
    });

    it("offers nothing to jump to when there is nothing outside", async () => {
      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.outsideWindow.count).toBe(0);
      expect(body.outsideWindow.jumpTo).toBeNull();
    });

    it("does not run the backward lookup when something lies ahead", async () => {
      // why: that query orders by `to`, which carries no index, and its answer
      // is thrown away whenever there is anything forward - the ordinary case
      // for a calendar. It used to run on every month swipe regardless.
      mockDb.booking.findFirst.mockResolvedValue({
        from: new Date("2026-09-13T09:00:00.000Z"),
      });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(mockDb.booking.findFirst).toHaveBeenCalledTimes(1);
      expect(mockDb.booking.findFirst.mock.calls[0]?.[0]?.orderBy).toEqual({
        from: "asc",
      });
    });

    it("falls back to the nearest booking behind when nothing lies ahead", async () => {
      mockDb.booking.count.mockResolvedValue(3);
      mockDb.booking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ to: new Date("2026-07-04T17:00:00.000Z") });

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(mockDb.booking.findFirst).toHaveBeenCalledTimes(2);
      expect(body.outsideWindow.jumpTo).toContain("2026-07-04");
    });
  });

  describe("the payload", () => {
    it("asks for one row past the cap, so it can tell whether there is more", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.take).toBe(501);
    });

    it("says so when it had to truncate, rather than drawing empty days", async () => {
      // The regression this guards: rows are ordered by start date, so dropping
      // the overflow removes the END of the window. The last week of the month
      // rendered with no bands and the day panel answered "Nothing booked on
      // this day" for days that were fully booked.
      mockDb.booking.findMany.mockResolvedValue(
        Array.from({ length: 501 }, (_, i) => ({
          id: `b${i}`,
          name: `Job ${i}`,
          status: "RESERVED",
          from: new Date("2026-08-10T09:00:00.000Z"),
          to: new Date("2026-08-12T17:00:00.000Z"),
          custodianUser: null,
          custodianTeamMember: null,
        }))
      );

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.truncated).toBe(true);
      // The probe row is dropped rather than shipped.
      expect(body.bookings).toHaveLength(500);
    });

    it("reports no truncation for a window it could answer in full", async () => {
      mockDb.booking.findMany.mockResolvedValue([]);

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.truncated).toBe(false);
    });

    it("clamps an oversized search term, as the list route does", async () => {
      // why: unbounded, this term reaches four separate `contains` predicates
      // per request.
      await loader(
        createLoaderArgs({
          request: calendarRequest(`${RANGE}&search=${"a".repeat(500)}`),
        })
      );

      const or = lastWhere().OR;
      expect(or[0].name.contains).toHaveLength(100);
    });

    it("orders soonest first, because a calendar is read forwards", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.orderBy).toEqual([
        { from: "asc" },
      ]);
    });

    it("flattens the custodian to a single name the row can print", async () => {
      mockDb.booking.findMany.mockResolvedValue([
        {
          id: "b1",
          name: "Festival load-in",
          status: "RESERVED",
          from: new Date("2026-08-10T09:00:00.000Z"),
          to: new Date("2026-08-12T17:00:00.000Z"),
          custodianUser: { firstName: "Amanda", lastName: "Cole" },
          custodianTeamMember: null,
        },
      ]);

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.bookings[0].custodianName).toBe("Amanda Cole");
    });

    it("selects only what a band and a row actually draw", async () => {
      // why: an asset count and a custodian avatar were selected, mapped and
      // shipped without ever being rendered. The count cost a correlated
      // subquery on every row of every month page.
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      const select = mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.select;
      expect(select._count).toBeUndefined();
      expect(select.custodianUser.select.profilePicture).toBeUndefined();
    });

    it("prefers a team member's name over the user's", async () => {
      mockDb.booking.findMany.mockResolvedValue([
        {
          id: "b1",
          name: "Kit out",
          status: "ONGOING",
          from: new Date("2026-08-10T09:00:00.000Z"),
          to: new Date("2026-08-10T17:00:00.000Z"),
          custodianUser: { firstName: "Amanda", lastName: "Cole" },
          custodianTeamMember: { name: "Lighting crew" },
        },
      ]);

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.bookings[0].custodianName).toBe("Lighting crew");
    });
  });
});
