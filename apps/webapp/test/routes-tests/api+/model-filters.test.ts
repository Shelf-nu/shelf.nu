/**
 * Regression tests for `/api/model-filters`.
 *
 * This endpoint backs the search box inside every `DynamicSelect` /
 * `DynamicDropdown`. The picker renders the ROUTE LOADER's records until the
 * user types, then swaps to this endpoint's results and passes both through the
 * same `renderItem`. If the two shapes disagree, `renderItem` reads `undefined`
 * and the row silently renders as nothing — a blank dropdown with a non-zero
 * "Showing N out of M" footer.
 *
 * @see {@link file://../../../app/routes/api+/model-filters.ts}
 * @see {@link file://../../../app/hooks/use-model-filters.ts}
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADDABLE_BOOKING_STATUSES } from "~/modules/booking/constants";
import { loader } from "~/routes/api+/model-filters";

// why: mocking Remix's data() so the loader returns a plain Response we can read
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const dbMocks = vi.hoisted(() => ({
  dynamicFindMany: vi.fn(),
}));

// why: exercising the where-clause + response shaping without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { dynamicFindMany: dbMocks.dynamicFindMany },
    teamMember: { dynamicFindMany: dbMocks.dynamicFindMany },
    kit: { dynamicFindMany: dbMocks.dynamicFindMany },
    category: { dynamicFindMany: dbMocks.dynamicFindMany },
    tag: { dynamicFindMany: dbMocks.dynamicFindMany },
    location: { dynamicFindMany: dbMocks.dynamicFindMany },
    assetModel: { dynamicFindMany: dbMocks.dynamicFindMany },
  },
}));

const orgMocks = vi.hoisted(() => ({
  getSelectedOrganization: vi.fn(),
}));

// why: bypassing cookie/session resolution to drive the caller's role directly
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: orgMocks.getSelectedOrganization,
}));

/**
 * Single definition of the draft-visibility clause, shared by the mock below
 * and by the assertions, so the two can never drift apart.
 *
 * Hoisted because `vi.mock` factories are lifted above module scope.
 *
 * The real implementation's shape is pinned by its own test in
 * `modules/booking/service.server.test.ts`, so restating it here cannot mask a
 * production change — that test fails first.
 */
const clause = vi.hoisted(() => ({
  buildDraftVisibility: (userId: string) => ({
    OR: [
      { status: { not: "DRAFT" } },
      { AND: [{ status: "DRAFT" }, { creatorId: userId }] },
    ],
  }),
  buildCustodianScope: (scope: { userId: string; teamMemberIds?: string[] }) =>
    scope.teamMemberIds?.length
      ? {
          OR: [
            { custodianUserId: scope.userId },
            { custodianTeamMemberId: { in: scope.teamMemberIds } },
          ],
        }
      : { custodianUserId: scope.userId },
}));

const bookingMocks = vi.hoisted(() => ({
  resolveCustodianScope: vi.fn(),
}));

// why: service.server pulls in the whole booking domain (schedulers, emails).
// `custodianScopeClause` is pure, so a local equivalent keeps the test fast;
// `resolveCustodianScope` is the one DB read, stubbed to a fixed scope.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: clause.buildDraftVisibility,
  custodianScopeClause: clause.buildCustodianScope,
  resolveCustodianScope: bookingMocks.resolveCustodianScope,
}));

const ORG_ID = "org-1";
/** Team-member rows the fixture user holds in the workspace. */
const TEAM_MEMBER_IDS = ["tm-1"];

/**
 * Builds the loader args for a given query string.
 *
 * @param query - Raw query string, without the leading `?`.
 * @returns Loader args carrying a session for `user-1`.
 */
function buildArgs(query: string): LoaderFunctionArgs {
  return {
    request: new Request(`http://localhost/api/model-filters?${query}`),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as LoaderFunctionArgs;
}

/**
 * Invokes the loader and returns the mocked `data()` Response.
 *
 * The double cast is needed because React Router types `data()` as returning
 * `DataWithResponseInit`; our mock returns a real `Response` instead so the
 * test can read the serialized body.
 */
async function callLoader(query: string): Promise<Response> {
  return (await loader(buildArgs(query))) as unknown as Response;
}

/** Returns the `where` Prisma passed on the most recent query. */
function lastWhere() {
  return dbMocks.dynamicFindMany.mock.calls.at(-1)?.[0]?.where;
}

/**
 * Reads the `filters` array out of a loader response.
 *
 * @param response - Response produced by {@link callLoader}.
 * @returns The filter items the picker would render.
 */
async function readFilters(response: Response) {
  const body = await response.json();
  return body.filters ?? body.payload?.filters ?? [];
}

/** The clause every booking read path AND-s in — drafts are creator-only. */
const DRAFT_VISIBILITY = clause.buildDraftVisibility("user-1");

/**
 * READ restriction — the standard visibility rule, matching custody on EITHER
 * link. Must be the same shape `getBookings` builds for the loader that seeded
 * the picker, or the list changes the moment the user types.
 */
const CUSTODIAN_SCOPE = clause.buildCustodianScope({
  userId: "user-1",
  teamMemberIds: TEAM_MEMBER_IDS,
});

/**
 * WRITE restriction — mirrors `validateBookingOwnership`, which is what the
 * "Add to existing booking" actions enforce on submit.
 */
const WRITE_SCOPE = {
  OR: [{ creatorId: "user-1" }, { custodianUserId: "user-1" }],
};

/**
 * Points the session at a workspace where the caller holds `role`.
 *
 * @param role - Caller's role in the workspace.
 * @param canSeeAllOverride - Workspace override settings, both off by default.
 */
function setRole(role: OrganizationRoles, canSeeAllOverride = false) {
  orgMocks.getSelectedOrganization.mockResolvedValue({
    organizationId: ORG_ID,
    userOrganizations: [{ organization: { id: ORG_ID }, roles: [role] }],
    currentOrganization: {
      selfServiceCanSeeBookings: canSeeAllOverride,
      baseUserCanSeeBookings: canSeeAllOverride,
    },
  });
}

describe("GET /api/model-filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRole(OrganizationRoles.OWNER);
    bookingMocks.resolveCustodianScope.mockResolvedValue({
      userId: "user-1",
      teamMemberIds: TEAM_MEMBER_IDS,
    });
  });

  describe("result shape", () => {
    it("exposes the record's own fields at the top level so renderItem sees them", async () => {
      // A booking as the route loader would hand it to the picker.
      dbMocks.dynamicFindMany.mockResolvedValue([
        {
          id: "booking-1",
          name: "Barclays Vibra",
          status: BookingStatus.RESERVED,
          from: new Date("2026-09-01T10:00:00Z"),
          to: new Date("2026-09-02T10:00:00Z"),
        },
      ]);

      const filters = await readFilters(
        await callLoader("name=booking&queryKey=name&queryValue=Barclays")
      );

      // The bug: `status` was absent, so the dialogs' `isValidBooking(item)`
      // returned false and the row rendered as `null`.
      expect(filters[0]).toMatchObject({
        id: "booking-1",
        name: "Barclays Vibra",
        status: BookingStatus.RESERVED,
      });
      expect(filters[0].from).toBeDefined();
      expect(filters[0].to).toBeDefined();
    });

    it("keeps the id/name/color/metadata contract that existing pickers rely on", async () => {
      // `category` rather than `teamMember`: the registry gives category a
      // `color` but not a team member, so asserting `color` on a team member
      // would be asserting a shape production can no longer produce.
      dbMocks.dynamicFindMany.mockResolvedValue([
        { id: "cat-1", name: "Laptops", color: "#fff" },
      ]);

      const filters = await readFilters(
        await callLoader("name=category&queryKey=name&queryValue=Lap")
      );

      expect(filters[0].id).toBe("cat-1");
      expect(filters[0].name).toBe("Laptops");
      expect(filters[0].color).toBe("#fff");
      expect(filters[0].metadata).toMatchObject({ id: "cat-1" });
    });

    it("puts the record's own columns at the top level, as route loaders do", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([
        { id: "tm-1", name: "Ada Lovelace", userId: "user-9" },
      ]);

      const filters = await readFilters(
        await callLoader("name=teamMember&queryKey=name&queryValue=Ada")
      );

      expect(filters[0].userId).toBe("user-9");
    });
  });

  describe("payload narrowing", () => {
    /**
     * Projects a row through a Prisma `select`, the way the database would.
     *
     * The mock returns whatever we hand it, so asserting on a hand-written row
     * would prove nothing about the `select` — it would pass even if the loader
     * dropped the select entirely. Projecting here makes the assertion depend
     * on the select the loader actually sends.
     */
    function project(row: Record<string, any>, select: Record<string, any>) {
      const out: Record<string, any> = {};
      for (const [key, spec] of Object.entries(select)) {
        if (!(key in row)) continue;
        out[key] =
          spec === true
            ? row[key]
            : project(row[key] ?? {}, (spec as { select: any }).select);
      }
      return out;
    }

    it("returns only registry fields, never the whole row", async () => {
      // The full row, as it exists in the database.
      const storedRow = {
        id: "tm-1",
        name: "Ada Lovelace",
        userId: "user-9",
        // Columns no picker reads. Previously every one of these reached the
        // client through `...item`, `metadata` and `user` at once.
        deletedAt: null,
        createdAt: "2020-01-01T00:00:00.000Z",
        organizationId: "org-1",
        user: {
          id: "user-9",
          firstName: "Ada",
          lastName: "Lovelace",
          displayName: "Ada L",
          email: "ada@example.com",
          // A user column the picker has no business seeing.
          onboarded: true,
        },
      };

      dbMocks.dynamicFindMany.mockImplementation(({ select }: any) =>
        Promise.resolve([project(storedRow, select)])
      );

      const filters = await readFilters(
        await callLoader("name=teamMember&queryKey=name&queryValue=Ada")
      );

      const serialized = JSON.stringify(filters);
      expect(serialized).not.toContain("createdAt");
      expect(serialized).not.toContain("onboarded");
      expect(serialized).not.toContain("deletedAt");

      // Everything the picker label needs still arrives — including the email,
      // which `resolveTeamMemberName(item, true)` renders as
      // "Ada Lovelace (ada@example.com)". Omitting it would make the label
      // change the moment the user types, because the seeding loaders all
      // return it. What limits disclosure is WHICH ROWS come back — see the
      // custody-scoping suite below — not hiding this column.
      expect(filters[0].name).toBe("Ada Lovelace");
      expect(filters[0].userId).toBe("user-9");
      expect(filters[0].user.displayName).toBe("Ada L");
      expect(filters[0].user.email).toBe("ada@example.com");
    });

    it("asks Prisma for the registry select rather than the whole row", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader("name=teamMember&queryKey=name&queryValue=x");

      const call = dbMocks.dynamicFindMany.mock.calls.at(-1)?.[0];

      // A `select` at all is the point: without one this was a bare findMany
      // returning every column of the row.
      expect(call.select).toBeDefined();
      expect(call.include).toBeUndefined();
      expect(Object.keys(call.select).sort()).toEqual([
        "id",
        "name",
        "user",
        "userId",
      ]);
    });
  });

  describe("result cap", () => {
    /** Splits the recorded calls into the selected-ids one and the search one. */
    function splitCalls() {
      const calls = dbMocks.dynamicFindMany.mock.calls.map((c: any[]) => c[0]);
      return {
        selected: calls.find((c) => c.where?.id?.in),
        search: calls.find((c) => c.where?.OR),
        all: calls,
      };
    }

    it("fetches selected ids in their own query, so the cap cannot evict them", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader(
        "name=category&queryKey=name&queryValue=x&selectedValues=c1,c2,c3"
      );

      const { selected, search } = splitCalls();

      // One capped LIMIT shared across both branches made inclusion
      // probabilistic; widening it by the selected count bought capacity, not
      // inclusion.
      expect(selected.where.id.in).toEqual(["c1", "c2", "c3"]);
      expect(selected.take).toBe(3);
      expect(search.take).toBe(100);
    });

    it("scopes the selected-ids query exactly like the search query", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader(
        `name=booking&queryKey=name&queryValue=x&selectedValues=someone-elses-booking&status=${ADDABLE_BOOKING_STATUSES.join(
          ","
        )}`
      );

      const { selected, search } = splitCalls();

      // `selectedValues` is caller-supplied. A selected query that skipped the
      // permission clauses would return rows the search deliberately hides —
      // a display bug turned into an IDOR.
      expect(selected.where.organizationId).toBe(search.where.organizationId);
      expect(selected.where.AND).toEqual(search.where.AND);
      expect(selected.where.status).toEqual(search.where.status);
    });

    it("issues no selected-ids query when nothing is selected", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader("name=category&queryKey=name&queryValue=x");

      const { selected, search, all } = splitCalls();

      expect(selected).toBeUndefined();
      expect(all).toHaveLength(1);
      expect(search.take).toBe(100);
    });

    it("orders the search so the cap is deterministic", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader("name=category&queryKey=name&queryValue=x");

      expect(splitCalls().search.orderBy).toEqual({ name: "asc" });
    });

    it("returns selected rows first and de-duplicates overlap", async () => {
      // A selected row can also match what the user typed.
      dbMocks.dynamicFindMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where?.id?.in
            ? [{ id: "c1", name: "Selected" }]
            : [
                { id: "c1", name: "Selected" },
                { id: "c9", name: "Searched" },
              ]
        )
      );

      const filters = await readFilters(
        await callLoader(
          "name=category&queryKey=name&queryValue=x&selectedValues=c1"
        )
      );

      expect(filters.map((f: { id: string }) => f.id)).toEqual(["c1", "c9"]);
    });
  });

  describe("queryKey lockdown", () => {
    it("rejects a queryKey the registry does not declare searchable", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      const response = await callLoader(
        "name=booking&queryKey=description&queryValue=confidential"
      );

      // Was a blind-search oracle over columns no picker displays.
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(dbMocks.dynamicFindMany).not.toHaveBeenCalled();
    });

    it("still accepts the queryKey every call site uses", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      const response = await callLoader(
        "name=category&queryKey=name&queryValue=x"
      );

      expect(response.status).toBe(200);
    });

    it("matches team members on last name, not first name twice", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);

      await callLoader("name=teamMember&queryKey=name&queryValue=Lovelace");

      const branches = JSON.stringify(lastWhere().OR);
      expect(branches).toContain("lastName");
    });
  });

  describe("booking status scoping", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it("defaults to upcoming bookings only, so the advanced filter is unchanged", async () => {
      await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

      expect(lastWhere().status).toEqual({
        in: [
          BookingStatus.RESERVED,
          BookingStatus.ONGOING,
          BookingStatus.OVERDUE,
        ],
      });
    });

    it("honours the statuses a caller asks for, including DRAFT", async () => {
      await loader(
        buildArgs(
          `name=booking&queryKey=name&queryValue=x&status=${ADDABLE_BOOKING_STATUSES.join(
            ","
          )}`
        )
      );

      expect(lastWhere().status.in).toContain(BookingStatus.DRAFT);
      expect(lastWhere().status.in).toEqual(
        expect.arrayContaining([...ADDABLE_BOOKING_STATUSES])
      );
    });

    it("rejects a status value that is not a BookingStatus", async () => {
      const response = await callLoader(
        "name=booking&queryKey=name&status=NOT_A_STATUS"
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(dbMocks.dynamicFindMany).not.toHaveBeenCalled();
    });
  });

  describe("draft visibility", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it("restricts drafts to their creator, regardless of caller role", async () => {
      await loader(
        buildArgs(
          `name=booking&queryKey=name&status=${ADDABLE_BOOKING_STATUSES.join(
            ","
          )}`
        )
      );

      // Nested in AND so the search OR cannot widen it back open.
      expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY]);
    });

    it("applies even when the caller does not ask for DRAFT", async () => {
      await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

      expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY]);
    });

    it("does not add the clause to non-booking searches", async () => {
      await loader(buildArgs("name=kit&queryKey=name&queryValue=x"));

      expect(lastWhere().AND).toBeUndefined();
    });
  });

  describe("booking visibility (standard rule)", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "restricts %s users to their own bookings when the setting is off",
      async (role) => {
        setRole(role, false);

        await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

        expect(lastWhere().AND).toEqual([
          DRAFT_VISIBILITY,
          CUSTODIAN_SCOPE,
          WRITE_SCOPE,
        ]);
      }
    );

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "matches custody on EITHER link, as the seeding loader does",
      async (role) => {
        setRole(role, false);

        await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

        // The regression: matching `custodianUserId` alone dropped bookings
        // custodied through a legacy team-member row, so they showed in the
        // seeded list and vanished the moment the user typed.
        expect(lastWhere().AND).toContainEqual({
          OR: [
            { custodianUserId: "user-1" },
            { custodianTeamMemberId: { in: TEAM_MEMBER_IDS } },
          ],
        });
      }
    );

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "lifts the read restriction for %s when the workspace enables it",
      async (role) => {
        setRole(role, true);

        await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

        expect(lastWhere().AND).not.toContainEqual(CUSTODIAN_SCOPE);
        expect(bookingMocks.resolveCustodianScope).not.toHaveBeenCalled();
      }
    );

    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "never restricts %s",
      async (role) => {
        setRole(role, false);

        await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

        expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY]);
      }
    );

    it("cannot be widened by a request param, whatever the caller sends", async () => {
      setRole(OrganizationRoles.SELF_SERVICE, false);

      // `scopeToCustodian` used to be the ONLY thing applying this restriction,
      // so omitting it returned every booking row in the workspace. Sending it
      // — or its negation — must now make no difference at all.
      await loader(
        buildArgs(
          "name=booking&queryKey=name&queryValue=&scopeToCustodian=false&selectedValues=someone-elses-booking"
        )
      );

      expect(lastWhere().AND).toEqual([
        DRAFT_VISIBILITY,
        CUSTODIAN_SCOPE,
        WRITE_SCOPE,
      ]);
    });
  });

  describe("teamMember custody scoping", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    /** Points the session at a role plus a custody-override setting. */
    function setCustodyRole(role: OrganizationRoles, override = false) {
      orgMocks.getSelectedOrganization.mockResolvedValue({
        organizationId: ORG_ID,
        userOrganizations: [{ organization: { id: ORG_ID }, roles: [role] }],
        currentOrganization: {
          selfServiceCanSeeBookings: false,
          baseUserCanSeeBookings: false,
          selfServiceCanSeeCustody: override,
          baseUserCanSeeCustody: override,
        },
      });
    }

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "filter: restricts %s to their own rows when the override is off",
      async (role) => {
        setCustodyRole(role, false);

        await callLoader(
          "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-filter"
        );

        expect(lastWhere().userId).toBe("user-1");
      }
    );

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "filter: unrestricted for %s when the override is ON",
      async (role) => {
        setCustodyRole(role, true);

        await callLoader(
          "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-filter"
        );

        expect(lastWhere().userId).toBeUndefined();
      }
    );

    it.each([true, false])(
      "assignment: SELF_SERVICE stays self-only regardless of override (%s)",
      async (override) => {
        setCustodyRole(OrganizationRoles.SELF_SERVICE, override);

        await callLoader(
          "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-assignment"
        );

        expect(lastWhere().userId).toBe("user-1");
      }
    );

    it.each([true, false])(
      "assignment: BASE gets nothing regardless of override (%s)",
      async (override) => {
        setCustodyRole(OrganizationRoles.BASE, override);

        const filters = await readFilters(
          await callLoader(
            "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-assignment"
          )
        );

        expect(filters).toEqual([]);
        expect(dbMocks.dynamicFindMany).not.toHaveBeenCalled();
      }
    );

    it("defaults to the narrower assignment rule when purpose is absent", async () => {
      setCustodyRole(OrganizationRoles.BASE, true);

      const filters = await readFilters(
        await callLoader("name=teamMember&queryKey=name&queryValue=x")
      );

      expect(filters).toEqual([]);
    });

    /**
     * The regression the fail-closed default caused: a FILTER surface that
     * omitted `custodyPurpose` inherited the assignment rule, so BASE got a
     * hard empty list and SELF_SERVICE collapsed to themselves — even though
     * their loader seed contained the whole roster. Typing made valid names
     * vanish.
     */
    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "filter: %s with the override ON is not short-circuited to empty",
      async (role) => {
        setCustodyRole(role, true);
        dbMocks.dynamicFindMany.mockResolvedValue([
          { id: "tm-2", name: "Someone Else", userId: "user-2" },
        ]);

        const filters = await readFilters(
          await callLoader(
            "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-filter"
          )
        );

        expect(dbMocks.dynamicFindMany).toHaveBeenCalled();
        expect(filters).toHaveLength(1);
        expect(filters[0].id).toBe("tm-2");
      }
    );

    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "never restricts %s",
      async (role) => {
        setCustodyRole(role, false);

        await callLoader(
          "name=teamMember&queryKey=name&queryValue=x&custodyPurpose=custody-assignment"
        );

        expect(lastWhere().userId).toBeUndefined();
      }
    );
  });

  describe("booking write scope", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it.each([OrganizationRoles.SELF_SERVICE, OrganizationRoles.BASE])(
      "keeps %s inside what the submitting action accepts, setting ON",
      async (role) => {
        setRole(role, true);

        await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

        // Without this the picker offers bookings `validateBookingOwnership`
        // then rejects with a 403 — a dead end for the user.
        expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY, WRITE_SCOPE]);
      }
    );

    it("does not constrain roles that may write to every booking", async () => {
      setRole(OrganizationRoles.ADMIN, false);

      await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

      // Asserting on the clause, not on the string "creatorId" — the
      // draft-visibility clause legitimately carries that key.
      expect(lastWhere().AND).not.toContainEqual(WRITE_SCOPE);
    });

    it("does not leak into non-booking searches", async () => {
      setRole(OrganizationRoles.SELF_SERVICE, false);

      await loader(buildArgs("name=kit&queryKey=name&queryValue=x"));

      expect(lastWhere().AND).toBeUndefined();
    });
  });
});
