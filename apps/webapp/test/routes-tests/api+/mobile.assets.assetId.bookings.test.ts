// @vitest-environment node

import { OrganizationRoles } from "@prisma/client";
import { WITHHELD_CUSTODIAN_NAME } from "@shelf/labels";
import { loader } from "~/routes/api+/mobile+/assets.$assetId.bookings";
import { accessFor } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";

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

// why: external auth, no Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: resolveCustodianScope reads the caller's team-member links from the
// database. The where builders stay real: which bookings the list holds is
// exactly what this route delegates to them, so they are what is under test.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/booking/service.server")
  >("~/modules/booking/service.server");
  return {
    ...actual,
    resolveCustodianScope: vi.fn(async () => ({
      userId: "user-1",
      teamMemberIds: ["tm-1"],
    })),
  };
});

// why: no Postgres in unit tests, and the mock is also how the assertions read
// the exact query the loader ran.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findFirst: vi.fn() },
    booking: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import {
  buildBookingsWhere,
  custodianScopeClause,
  getBookingsListWhereParams,
  resolveCustodianScope,
} from "~/modules/booking/service.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

const mockDb = db as unknown as {
  asset: { findFirst: ReturnType<typeof vi.fn> };
  booking: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

/** The arguments of the paged booking query (the first findMany). */
function pageQuery() {
  return mockDb.booking.findMany.mock.calls[0]?.[0];
}

/** The arguments of the active-bookings query (the second findMany). */
function activeQuery() {
  return mockDb.booking.findMany.mock.calls[1]?.[0];
}

/**
 * Fixtures for the loader's inputs, typed off the real return types so a mock
 * that no longer matches what the function resolves fails to compile.
 */
type MobileAuth = Awaited<ReturnType<typeof requireMobileAuth>>;
type MobileContext = Awaited<ReturnType<typeof getMobileUserContext>>;

function mobileUser(): MobileAuth {
  return {
    user: {
      id: "user-1",
      email: "user-1@example.com",
      firstName: "Test",
      lastName: "User",
      profilePicture: null,
      onboarded: true,
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    },
  } as MobileAuth;
}

/**
 * A mobile context whose `access` is resolved by the real policy table from
 * the given roles and workspace toggles, so the two can never disagree.
 */
function mobileContext(
  roles: OrganizationRoles[] = [OrganizationRoles.ADMIN],
  workspace: Parameters<typeof accessFor>[1] = {}
): MobileContext {
  return {
    roles,
    access: accessFor(roles, workspace),
    canUseBarcodes: true,
    canUseAudits: true,
  };
}

function request(qs = "orgId=org-1", assetId = "asset-1") {
  return new Request(
    `http://localhost/api/mobile/assets/${assetId}/bookings?${qs}`,
    { headers: { Authorization: "Bearer token" } }
  );
}

const ARGS = { params: { assetId: "asset-1" } };

/** Runs the loader and returns the response and its parsed body. */
async function run(qs?: string) {
  const res = (await loader(
    createLoaderArgs({ request: request(qs), ...ARGS })
  )) as unknown as Response;
  return { res, body: await res.json() };
}

/** A booking row as the query returns it, held by someone other than the caller. */
function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    name: "Shoot",
    status: "ONGOING",
    from: new Date("2026-10-01T09:00:00Z"),
    to: new Date("2026-10-02T09:00:00Z"),
    custodianUser: {
      id: "user-2",
      firstName: "Legal",
      lastName: "Name",
      displayName: "Sam",
    },
    custodianTeamMember: { name: "Sam", userId: "user-2" },
    ...overrides,
  };
}

describe("GET /api/mobile/assets/:assetId/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireMobileAuth).mockResolvedValue(mobileUser());
    vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
    vi.mocked(requireMobilePermission).mockResolvedValue(undefined);
    vi.mocked(getMobileUserContext).mockResolvedValue(mobileContext());
    mockDb.asset.findFirst.mockResolvedValue({ id: "asset-1" });
    mockDb.booking.findMany.mockResolvedValue([]);
    mockDb.booking.count.mockResolvedValue(0);
  });

  describe("which bookings", () => {
    it("holds exactly the bookings the web asset tab holds", async () => {
      await run();

      const expected = buildBookingsWhere(
        getBookingsListWhereParams({
          list: { kind: "asset", assetId: "asset-1" },
          searchParams: new URLSearchParams(),
          organizationId: "org-1",
          userId: "user-1",
          custodianScope: null,
        })
      );
      expect(pageQuery().where).toEqual(expected);
      expect(mockDb.booking.count).toHaveBeenCalledWith({ where: expected });
    });

    it("stays inside the caller's workspace and on this asset", async () => {
      await run();

      const where = pageQuery().where;
      expect(where.organizationId).toBe("org-1");
      expect(where.bookingAssets).toEqual({
        some: { assetId: { in: ["asset-1"] } },
      });
    });

    it("excludes CANCELLED and ARCHIVED, and keeps COMPLETE", async () => {
      // why: past bookings are half of what this section is for.
      await run();

      const statuses = pageQuery().where.status.in;
      expect(statuses).toContain("COMPLETE");
      expect(statuses).not.toContain("CANCELLED");
      expect(statuses).not.toContain("ARCHIVED");
    });

    it("orders the page newest start first", async () => {
      await run();

      expect(pageQuery().orderBy).toEqual([{ from: "desc" }]);
    });
  });

  describe("active bookings", () => {
    it("fetches the asset's ONGOING and OVERDUE bookings under the same rules", async () => {
      await run();

      const page = pageQuery().where;
      const active = activeQuery().where;
      expect(active.status).toEqual({ in: ["ONGOING", "OVERDUE"] });
      // Everything but the status matches the page's where.
      expect({ ...active, status: undefined }).toEqual({
        ...page,
        status: undefined,
      });
    });

    it("returns them beside the page", async () => {
      mockDb.booking.findMany
        .mockResolvedValueOnce([
          bookingRow({ id: "future", status: "RESERVED" }),
        ])
        .mockResolvedValueOnce([bookingRow({ id: "now" })]);

      const { body } = await run();

      expect(body.bookings.map((b: { id: string }) => b.id)).toEqual([
        "future",
      ]);
      expect(body.activeBookings.map((b: { id: string }) => b.id)).toEqual([
        "now",
      ]);
    });
  });

  describe("custodian scope", () => {
    it("scopes a SELF_SERVICE user through the shared custodian clause", async () => {
      // why: matching only the user link hides a booking whose custodian was
      // picked as a team member, and the section then states "This asset has
      // never been booked", which is a claim rather than an empty list.
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext([OrganizationRoles.SELF_SERVICE])
      );

      await run();

      expect(resolveCustodianScope).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
      });
      const clause = custodianScopeClause({
        userId: "user-1",
        teamMemberIds: ["tm-1"],
      });
      expect(pageQuery().where.AND).toContainEqual(clause);
      expect(activeQuery().where.AND).toContainEqual(clause);
    });

    it("applies the same scope to BASE", async () => {
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext([OrganizationRoles.BASE])
      );

      await run();

      expect(resolveCustodianScope).toHaveBeenCalled();
    });

    it("does not scope an admin whose membership also carries SELF_SERVICE", async () => {
      // why: a membership can hold several roles in any order; the most
      // privileged one decides the reach.
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext([OrganizationRoles.SELF_SERVICE, OrganizationRoles.ADMIN])
      );

      await run();

      expect(resolveCustodianScope).not.toHaveBeenCalled();
    });

    it("does not scope an ADMIN", async () => {
      await run();

      expect(resolveCustodianScope).not.toHaveBeenCalled();
    });

    it("does not scope a SELF_SERVICE user the workspace lets see all bookings", async () => {
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext([OrganizationRoles.SELF_SERVICE], {
          selfServiceCanSeeBookings: true,
        })
      );

      await run();

      expect(resolveCustodianScope).not.toHaveBeenCalled();
    });
  });

  describe("draft privacy", () => {
    it("keeps another member's drafts out", async () => {
      await run();

      // The draft rule names the caller as the only creator whose drafts show.
      expect(JSON.stringify(pageQuery().where.AND)).toContain('"user-1"');
      expect(JSON.stringify(pageQuery().where.AND)).toContain("DRAFT");
    });
  });

  describe("response shape", () => {
    it("emits exactly the fields the companion's AssetBookingRow reads", async () => {
      // why: the companion casts this payload with no runtime check, so a
      // renamed or dropped field would compile there and render blanks.
      mockDb.booking.findMany.mockResolvedValueOnce([bookingRow()]);
      mockDb.booking.count.mockResolvedValue(41);

      const { body } = await run("orgId=org-1&perPage=20");

      expect(Object.keys(body).sort()).toEqual(
        [
          "activeBookings",
          "bookings",
          "page",
          "perPage",
          "totalCount",
          "totalPages",
        ].sort()
      );
      expect(body).toMatchObject({
        page: 1,
        perPage: 20,
        totalCount: 41,
        totalPages: 3,
      });
      expect(body.bookings[0]).toEqual({
        id: "b-1",
        name: "Shoot",
        status: "ONGOING",
        from: "2026-10-01T09:00:00.000Z",
        to: "2026-10-02T09:00:00.000Z",
        custodianName: "Sam",
      });
    });
  });

  describe("custodian name", () => {
    it("withholds another member's name without custody visibility", async () => {
      // why: seeing that a booking exists is a separate override from seeing
      // who holds it; this workspace grants the first and not the second.
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileContext([OrganizationRoles.SELF_SERVICE], {
          selfServiceCanSeeBookings: true,
        })
      );
      mockDb.booking.findMany.mockResolvedValueOnce([bookingRow()]);

      const { body } = await run();

      expect(body.bookings[0].custodianName).toBe(WITHHELD_CUSTODIAN_NAME);
    });

    it("names the custodian by display name for a member who may see custody", async () => {
      mockDb.booking.findMany.mockResolvedValueOnce([bookingRow()]);

      const { body } = await run();

      expect(body.bookings[0].custodianName).toBe("Sam");
    });

    it("reports a booking with no custodian as null, not withheld", async () => {
      mockDb.booking.findMany.mockResolvedValueOnce([
        bookingRow({ custodianUser: null, custodianTeamMember: null }),
      ]);

      const { body } = await run();

      expect(body.bookings[0].custodianName).toBeNull();
    });
  });

  describe("guards", () => {
    it("requires booking read permission", async () => {
      await run();

      expect(requireMobilePermission).toHaveBeenCalledWith({
        userId: "user-1",
        organizationId: "org-1",
        entity: "booking",
        action: "read",
      });
    });

    it("answers with the permission error's status when it is refused", async () => {
      vi.mocked(requireMobilePermission).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Forbidden",
          label: "Permission",
          status: 403,
          shouldBeCaptured: false,
        })
      );

      const { res } = await run();

      expect(res.status).toBe(403);
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });

    it("404s for an asset outside the caller's workspace, without querying bookings", async () => {
      // why: a guessed id from another org must not reveal whether it exists.
      mockDb.asset.findFirst.mockResolvedValue(null);

      const { res } = await run();

      expect(res.status).toBe(404);
      expect(mockDb.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "asset-1", organizationId: "org-1" },
        })
      );
      expect(mockDb.booking.findMany).not.toHaveBeenCalled();
    });
  });

  describe("pagination", () => {
    it("pages the booking query with the parsed page", async () => {
      // Parsing edge cases are pinned by mobile-pagination.test.ts.
      const { body } = await run("orgId=org-1&page=2.5");

      expect(body.page).toBe(2);
      expect(pageQuery()).toMatchObject({ skip: 20, take: 20 });
    });
  });
});
