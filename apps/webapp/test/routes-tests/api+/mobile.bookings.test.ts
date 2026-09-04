import { OrganizationRoles } from "@prisma/client";
import { loader } from "~/routes/api+/mobile+/bookings";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

/**
 * Who a mobile bookings list is allowed to show.
 *
 * The rule belongs to the shared helpers web already uses, so these tests
 * assert that the route delegates to them with the right arguments rather than
 * restating the rule. Getting this wrong is quiet in both directions: too wide
 * leaks a colleague's bookings, too narrow hides a user's own.
 */

const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

// why: React Router v7 single fetch returns bare objects; this makes `data()`
// hand back a real Response so the tests can read status and JSON body.
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: createDataMock(),
}));

// why: external auth — the tests must not reach Supabase, and the role is the
// input that decides which scoping branch runs.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  // why: a plain literal, not the `mobileUserContext` helper — `vi.mock`
  // factories are hoisted above the imports, so referencing the helper here
  // throws before it is initialised. Every test overrides this in `beforeEach`
  // anyway; this only has to be a valid shape.
  getMobileUserContext: vi.fn().mockResolvedValue({
    role: "ADMIN",
    roles: ["ADMIN"],
    effectiveRole: "ADMIN",
    isSelfServiceOrBase: false,
    canUseBarcodes: true,
    canUseAudits: true,
    canSeeAllCustody: true,
    canSeeAllBookings: true,
  }),
}));

// why: the shared visibility helpers. Stubbed to sentinels so the assertions
// are about what the route delegates, not about a copy of their logic.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: vi.fn(() => ({ __draftClause: true })),
  // Sentinels, not reimplementations - see the calendar route's tests.
  resolveCustodianScope: vi.fn(async () => ({
    userId: "user-1",
    teamMemberIds: ["tm-1", "tm-2"],
  })),
  custodianScopeClause: vi.fn(() => ({ __custodianClause: true })),
}));

// why: no Postgres in unit tests; the mock also lets the assertions read the
// exact `where` the list query was built with.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

// why: keeps ShelfError status codes observable in the response without the
// real error pipeline logging through them.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: unknown) => {
    const err = cause as { message?: string; status?: number } | null;
    return { message: err?.message ?? "error", status: err?.status ?? 500 };
  }),
}));

import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import { mobileUserContext } from "@helpers/mobile-user-context";
import {
  custodianScopeClause,
  resolveCustodianScope,
} from "~/modules/booking/service.server";

const request = () =>
  new Request("http://localhost/api/mobile/bookings?orgId=org-1");

/** The `where` the list query actually ran with. */
function lastWhere(): any {
  return (db.booking.findMany as any).mock.calls.at(-1)?.[0]?.where;
}

describe("GET /api/mobile/bookings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.booking.findMany as any).mockResolvedValue([]);
    (db.booking.count as any).mockResolvedValue(0);
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["ADMIN"] })
    );
    (resolveCustodianScope as any).mockResolvedValue({
      userId: "user-1",
      teamMemberIds: ["tm-1", "tm-2"],
    });
    (custodianScopeClause as any).mockReturnValue({ __custodianClause: true });
  });

  it("scopes a SELF_SERVICE user through the shared custodian clause", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["SELF_SERVICE"] })
    );

    await loader(createLoaderArgs({ request: request() }));

    expect(resolveCustodianScope).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
    // The resolved scope carries the user's team-member links, and those are
    // what build the clause. Matching only `custodianUserId` hid a user's own
    // bookings whenever their custody came from a team member rather than a
    // user - visible on the website, missing on the phone.
    expect(custodianScopeClause).toHaveBeenCalledWith({
      userId: "user-1",
      teamMemberIds: ["tm-1", "tm-2"],
    });
    expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
  });

  it("scopes a BASE user the same way", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["BASE"] })
    );

    await loader(createLoaderArgs({ request: request() }));

    expect(custodianScopeClause).toHaveBeenCalled();
    expect(lastWhere().AND).toContainEqual({ __custodianClause: true });
  });

  it.each([["SELF_SERVICE"], ["BASE"]])(
    "stops scoping a %s user once the workspace override is on",
    async (role) => {
      // The workspace override, not the role, is the deciding input. With it
      // on, the restriction is not merely widened — it is never resolved.
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileUserContext({
          roles: [role as OrganizationRoles],
          canSeeAllBookings: true,
        })
      );

      await loader(createLoaderArgs({ request: request() }));

      expect(resolveCustodianScope).not.toHaveBeenCalled();
      expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
    }
  );

  it("keeps drafts private even when the override is on", async () => {
    // The override widens WHOSE bookings are visible. A draft stays private to
    // its creator either way, exactly as on web.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["BASE"], canSeeAllBookings: true })
    );

    await loader(createLoaderArgs({ request: request() }));

    expect(lastWhere().AND).toContainEqual({ __draftClause: true });
  });

  it("hides a colleague's custodian name when only the booking override is on", async () => {
    // Two independent settings. Seeing a booking does not mean seeing who
    // holds it; web draws the literal "private" in that case.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: ["BASE"],
        canSeeAllBookings: true,
        canSeeAllCustody: false,
      })
    );
    (db.booking.findMany as any).mockResolvedValue([
      {
        id: "b-1",
        name: "Someone else's booking",
        status: "ONGOING",
        from: new Date(0),
        to: new Date(0),
        createdAt: new Date(0),
        custodianUser: { id: "other-user", profilePicture: "pic.jpg" },
        custodianTeamMember: { name: "Mario", userId: "other-user" },
        _count: { bookingAssets: 1, modelRequests: 0 },
        modelRequests: [],
      },
    ]);
    (db.booking.count as any).mockResolvedValue(1);

    const response = (await loader(
      createLoaderArgs({ request: request() })
    )) as unknown as Response;
    const body = await response.json();

    expect(body.bookings[0].custodianName).toBe("private");
    expect(body.bookings[0].custodianImage).toBeNull();
  });

  it("reports a booking with no custodian as null, not private", async () => {
    // Three distinct answers. "private" claims a custodian exists and is being
    // withheld; an unassigned booking must not make that claim.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: ["BASE"],
        canSeeAllBookings: true,
        canSeeAllCustody: false,
      })
    );
    (db.booking.findMany as any).mockResolvedValue([
      {
        id: "b-3",
        name: "Unassigned booking",
        status: "DRAFT",
        from: new Date(0),
        to: new Date(0),
        createdAt: new Date(0),
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 0, modelRequests: 0 },
        modelRequests: [],
      },
    ]);
    (db.booking.count as any).mockResolvedValue(1);

    const response = (await loader(
      createLoaderArgs({ request: request() })
    )) as unknown as Response;
    const body = await response.json();

    expect(body.bookings[0].custodianName).toBeNull();
  });

  it("still shows the caller their OWN custodian name with custody off", async () => {
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({
        roles: ["BASE"],
        canSeeAllBookings: true,
        canSeeAllCustody: false,
      })
    );
    (db.booking.findMany as any).mockResolvedValue([
      {
        id: "b-2",
        name: "My booking",
        status: "ONGOING",
        from: new Date(0),
        to: new Date(0),
        createdAt: new Date(0),
        custodianUser: null,
        // Custody through a team-member row that IS the caller. Matching only
        // the user link would print "private" on their own booking.
        custodianTeamMember: { name: "Caller", userId: "user-1" },
        _count: { bookingAssets: 1, modelRequests: 0 },
        modelRequests: [],
      },
    ]);
    (db.booking.count as any).mockResolvedValue(1);

    const response = (await loader(
      createLoaderArgs({ request: request() })
    )) as unknown as Response;
    const body = await response.json();

    expect(body.bookings[0].custodianName).toBe("Caller");
  });

  it("does not narrow an ADMIN to their own bookings", async () => {
    await loader(createLoaderArgs({ request: request() }));

    expect(resolveCustodianScope).not.toHaveBeenCalled();
    expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
  });

  it("reads the most privileged role, not whichever one is stored first", async () => {
    // The regression this guards: the context's `role` is `roles[0]`, so a
    // membership stored `[SELF_SERVICE, ADMIN]` resolved to SELF_SERVICE and a
    // genuine admin was narrowed to bookings they are custodian of. The
    // calendar lens shares this scoping and has to reach the same verdict.
    vi.mocked(getMobileUserContext).mockResolvedValue(
      mobileUserContext({ roles: ["SELF_SERVICE", "ADMIN"] })
    );

    await loader(createLoaderArgs({ request: request() }));

    expect(resolveCustodianScope).not.toHaveBeenCalled();
    expect(lastWhere().AND).not.toContainEqual({ __custodianClause: true });
  });

  it("always applies draft privacy, whatever the role", async () => {
    for (const role of [
      OrganizationRoles.ADMIN,
      OrganizationRoles.SELF_SERVICE,
      OrganizationRoles.BASE,
    ]) {
      vi.clearAllMocks();
      (db.booking.findMany as any).mockResolvedValue([]);
      (db.booking.count as any).mockResolvedValue(0);
      vi.mocked(getMobileUserContext).mockResolvedValue(
        mobileUserContext({ roles: [role] })
      );

      await loader(createLoaderArgs({ request: request() }));

      expect(lastWhere().AND).toContainEqual({ __draftClause: true });
    }
  });
});
