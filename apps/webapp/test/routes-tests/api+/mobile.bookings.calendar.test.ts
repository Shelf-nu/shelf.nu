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
  assertMobileCanUseBookings: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: the draft-privacy clause is shared with the list; we assert it is
// APPLIED, not what it contains — that belongs to the service's own tests.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: vi.fn(() => ({ __draftClause: true })),
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
  },
}));

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
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  assertMobileCanUseBookings,
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
    (assertMobileCanUseBookings as any).mockResolvedValue(undefined);
    (getMobileUserContext as any).mockResolvedValue({ role: "ADMIN" });
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

    it("never returns CANCELLED or ARCHIVED bookings", async () => {
      // why: they are absent from web's calendar too; a cancelled job is not a
      // commitment and must not make a week look busy.
      await loader(
        createLoaderArgs({
          request: calendarRequest(`${RANGE}&statuses=CANCELLED,ARCHIVED`),
        })
      );

      const statuses = lastWhere().status.in;
      expect(statuses).not.toContain("CANCELLED");
      expect(statuses).not.toContain("ARCHIVED");
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
    it("scopes a SELF_SERVICE user to bookings they hold", async () => {
      (getMobileUserContext as any).mockResolvedValue({ role: "SELF_SERVICE" });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().custodianUserId).toBe("user-1");
    });

    it("scopes a BASE user the same way", async () => {
      (getMobileUserContext as any).mockResolvedValue({ role: "BASE" });

      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().custodianUserId).toBe("user-1");
    });

    it("does not narrow an ADMIN to their own bookings", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(lastWhere().custodianUserId).toBeUndefined();
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

    it("refuses when the workspace has no bookings entitlement", async () => {
      (assertMobileCanUseBookings as any).mockRejectedValue(
        Object.assign(new Error("Bookings not enabled"), { status: 403 })
      );

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );

      expect((res as unknown as Response).status).toBe(403);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
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
  });

  describe("the payload", () => {
    it("caps how many rows one month can pull down", async () => {
      await loader(createLoaderArgs({ request: calendarRequest(RANGE) }));

      expect(mockDb.booking.findMany.mock.calls.at(-1)?.[0]?.take).toBe(500);
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
          custodianUser: {
            firstName: "Amanda",
            lastName: "Cole",
            profilePicture: null,
          },
          custodianTeamMember: null,
          _count: { bookingAssets: 4 },
        },
      ]);

      const res = await loader(
        createLoaderArgs({ request: calendarRequest(RANGE) })
      );
      const body = await (res as unknown as Response).json();

      expect(body.bookings[0].custodianName).toBe("Amanda Cole");
      expect(body.bookings[0].assetCount).toBe(4);
    });

    it("prefers a team member's name over the user's", async () => {
      mockDb.booking.findMany.mockResolvedValue([
        {
          id: "b1",
          name: "Kit out",
          status: "ONGOING",
          from: new Date("2026-08-10T09:00:00.000Z"),
          to: new Date("2026-08-10T17:00:00.000Z"),
          custodianUser: {
            firstName: "Amanda",
            lastName: "Cole",
            profilePicture: null,
          },
          custodianTeamMember: { name: "Lighting crew" },
          _count: { bookingAssets: 0 },
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
