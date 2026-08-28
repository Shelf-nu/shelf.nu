/**
 * Permission regression tests for `getBookings`' where-construction.
 *
 * `getBookings` composes two very different kinds of custodian clause:
 *
 * - `custodianScope` is a **restriction**. It is set only by callers that
 *   established the user may not see all bookings. Its two halves describe the
 *   same person (user link OR team-member link, the latter covering legacy rows
 *   where `custodianUserId` was never backfilled), so they are OR-ed with each
 *   other and the result is AND-ed in as ONE clause.
 * - `custodianTeamMemberIds` is a **filter**, built from unvalidated
 *   `?teamMember=` search params, so its value is attacker-controlled. It is
 *   always AND-ed and is never a restriction.
 *
 * These tests lock in the invariant that a filter can never widen a restriction
 * away. They assert on the `where` handed to Prisma rather than on query
 * results, because the `where` *is* the security boundary.
 *
 * @see {@link file://./service.server.ts} — `getBookings`
 */
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { bookingDraftVisibilityClause, getBookings } from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: `getBookings` executes real Prisma queries, but the subject under test
// is the `where` it builds, not what a database returns. Mocking the client
// lets us capture that argument; `count` is mocked because `getBookings`
// issues it alongside `findMany` in a `Promise.all`.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
      count: vitest.fn().mockResolvedValue(0),
    },
  },
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;

/** The restricted (self-service) caller these tests act as. */
const RESTRICTED_USER_ID = "restricted-user-1";

/** The restricted caller's own team-member row in this org. */
const OWN_TEAM_MEMBER_ID = "own-team-member-1";

/** A team member id the restricted caller has no right to see bookings for. */
const VICTIM_TEAM_MEMBER_ID = "victim-team-member-1";

/** The restriction a self-service caller is given by `getBookingsFilterData`. */
const SELF_SCOPE = {
  userId: RESTRICTED_USER_ID,
  teamMemberIds: [OWN_TEAM_MEMBER_ID],
};

/**
 * The booking columns these tests reason about. Mirrors the fields the built
 * `where` actually predicates on.
 */
type BookingRow = {
  organizationId: string;
  status: string;
  creatorId: string;
  custodianUserId: string | null;
  custodianTeamMemberId: string | null;
};

/**
 * Runs `getBookings` and returns the Prisma `where` it handed to `findMany`.
 *
 * @param params - Overrides merged over the minimal required arguments
 * @returns The captured `where` clause
 */
async function captureWhere(
  params: Partial<Parameters<typeof getBookings>[0]> = {}
): Promise<Prisma.BookingWhereInput> {
  await getBookings({
    organizationId: "org-1",
    page: 1,
    userId: RESTRICTED_USER_ID,
    ...params,
  });

  return findManyMock.mock.calls[0][0].where as Prisma.BookingWhereInput;
}

/**
 * Normalises `Prisma.BookingWhereInput["AND"]` (which is `T | T[]`) to an
 * array so tests can assert membership without caring which form was used.
 *
 * @param where - The captured where clause
 * @returns The `AND` clauses as an array
 */
function andClausesOf(
  where: Prisma.BookingWhereInput
): Prisma.BookingWhereInput[] {
  if (!where.AND) {
    return [];
  }

  return Array.isArray(where.AND) ? where.AND : [where.AND];
}

/**
 * Evaluates a built `where` against a candidate row so tests can assert what
 * the query *means* (is this booking visible?) rather than only what it looks
 * like. Shape assertions alone cannot catch a clause that is present but
 * composed so that something else widens it away — which is precisely the bug
 * these tests exist to prevent.
 *
 * Models only the operator subset `getBookings` emits (`AND`, `OR`, equality,
 * `in`, `notIn`, `not`) and **throws on anything else**, so an unmodelled
 * operator fails loudly instead of silently reporting a match. This is not a
 * substitute for Postgres: it proves the boolean composition, not the SQL.
 *
 * @param clause - A Prisma where clause (or nested sub-clause)
 * @param row - The candidate booking row
 * @returns Whether the row satisfies the clause
 * @throws {Error} If the clause uses an operator this evaluator doesn't model
 */
function matchesWhere(
  clause: Prisma.BookingWhereInput,
  row: BookingRow
): boolean {
  return Object.entries(clause).every(([field, condition]) => {
    if (field === "AND") {
      const clauses = (
        Array.isArray(condition) ? condition : [condition]
      ) as Prisma.BookingWhereInput[];
      return clauses.every((nested) => matchesWhere(nested, row));
    }

    if (field === "OR") {
      return (condition as Prisma.BookingWhereInput[]).some((nested) =>
        matchesWhere(nested, row)
      );
    }

    const actual = row[field as keyof BookingRow];

    if (condition === null || typeof condition !== "object") {
      return actual === condition;
    }

    const operator = condition as Record<string, unknown>;

    if ("in" in operator) {
      return (operator.in as unknown[]).includes(actual);
    }

    if ("notIn" in operator) {
      return !(operator.notIn as unknown[]).includes(actual);
    }

    if ("not" in operator) {
      return actual !== operator.not;
    }

    throw new Error(
      `matchesWhere: unmodelled operator on "${field}": ${JSON.stringify(
        operator
      )}`
    );
  });
}

/** A booking whose custody sits on the restricted user's user link. */
const ownBooking: BookingRow = {
  organizationId: "org-1",
  status: "RESERVED",
  creatorId: RESTRICTED_USER_ID,
  custodianUserId: RESTRICTED_USER_ID,
  custodianTeamMemberId: OWN_TEAM_MEMBER_ID,
};

/**
 * A legacy booking: assigned to the user's team member before the team member
 * was linked to a user, so `custodianUserId` was never backfilled. It is still
 * theirs and must stay visible.
 */
const legacyOwnBooking: BookingRow = {
  organizationId: "org-1",
  status: "RESERVED",
  creatorId: "someone-else",
  custodianUserId: null,
  custodianTeamMemberId: OWN_TEAM_MEMBER_ID,
};

/** Another member's booking. Must never be visible to the restricted user. */
const victimBooking: BookingRow = {
  organizationId: "org-1",
  status: "RESERVED",
  creatorId: "victim-user-1",
  custodianUserId: "victim-user-1",
  custodianTeamMemberId: VICTIM_TEAM_MEMBER_ID,
};

beforeEach(() => {
  vitest.clearAllMocks();
  findManyMock.mockResolvedValue([]);
});

describe("getBookings custodian restriction", () => {
  it("keeps the self-scope restriction AND-ed when a team member filter is supplied", async () => {
    // A restricted user supplying another team member's id via `?teamMember=`.
    // Both clauses must narrow: the restriction is non-negotiable, and the
    // filter applies on top of it.
    const where = await captureWhere({
      custodianScope: SELF_SCOPE,
      custodianTeamMemberIds: [VICTIM_TEAM_MEMBER_ID],
    });

    // The restriction is ONE AND member whose halves are OR-ed internally.
    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { custodianUserId: RESTRICTED_USER_ID },
            { custodianTeamMemberId: { in: [OWN_TEAM_MEMBER_ID] } },
          ],
        },
      ])
    );

    // The restriction must not be reachable as a top-level OR branch — that is
    // exactly what let `?teamMember=<victim>` widen it away.
    expect(where.OR).toBeUndefined();
    expect(where.custodianUserId).toBeUndefined();
  });

  it("does not let an attacker-supplied team member filter widen the restriction", async () => {
    // The escalation, asserted on meaning rather than shape: `?teamMember=<victim>`
    // must not surface the victim's booking.
    const where = await captureWhere({
      custodianScope: SELF_SCOPE,
      custodianTeamMemberIds: [VICTIM_TEAM_MEMBER_ID],
    });

    expect(matchesWhere(where, victimBooking)).toBe(false);
  });

  it("matches a legacy booking held on the team-member link alone", async () => {
    // `custodianUserId` was never backfilled on this row; the team-member half
    // of the restriction is the only thing that can match it. AND-ing the two
    // halves (rather than OR-ing them) would make it vanish.
    const where = await captureWhere({ custodianScope: SELF_SCOPE });

    expect(matchesWhere(where, legacyOwnBooking)).toBe(true);
    expect(matchesWhere(where, ownBooking)).toBe(true);
    expect(matchesWhere(where, victimBooking)).toBe(false);
  });

  it("matches on the user link alone when no team member ids are supplied", async () => {
    // Callers that don't look up a team member (e.g. /me/bookings) get a single
    // clause, not a pointless one-branch OR.
    const where = await captureWhere({
      custodianScope: { userId: RESTRICTED_USER_ID },
    });

    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([{ custodianUserId: RESTRICTED_USER_ID }])
    );
    expect(matchesWhere(where, ownBooking)).toBe(true);
    expect(matchesWhere(where, victimBooking)).toBe(false);
  });

  it("applies the team member filter on top of the restriction rather than beside it", async () => {
    const where = await captureWhere({
      custodianScope: SELF_SCOPE,
      custodianTeamMemberIds: [OWN_TEAM_MEMBER_ID],
    });

    // Filtering by your own team member is legitimate and still works: the
    // filter narrows within the restriction.
    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([
        { custodianTeamMemberId: { in: [OWN_TEAM_MEMBER_ID] } },
      ])
    );
    expect(matchesWhere(where, legacyOwnBooking)).toBe(true);
    expect(matchesWhere(where, victimBooking)).toBe(false);
  });

  it("preserves the search OR when a restricted user also filters by team member", async () => {
    // The old OR branch clobbered the search block's `where.OR`, silently
    // dropping the user's search term whenever a team member filter was active.
    const where = await captureWhere({
      custodianScope: SELF_SCOPE,
      custodianTeamMemberIds: [VICTIM_TEAM_MEMBER_ID],
      search: "projector",
    });

    // `where.OR` still belongs to the search block, not to custodian matching.
    expect(where.OR).toEqual([
      {
        OR: expect.arrayContaining([
          { name: { contains: "projector", mode: "insensitive" } },
        ]),
      },
    ]);

    // ...and the restriction survives alongside it.
    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([
        {
          OR: [
            { custodianUserId: RESTRICTED_USER_ID },
            { custodianTeamMemberId: { in: [OWN_TEAM_MEMBER_ID] } },
          ],
        },
      ])
    );
  });

  it("still filters by team member for users who may see all bookings", async () => {
    // Admins/owners never receive a self-scope, so the team member filter
    // applies alone — unchanged behaviour, just expressed as an AND clause.
    const where = await captureWhere({
      userId: "admin-1",
      custodianTeamMemberIds: ["team-member-1", "team-member-2"],
    });

    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([
        { custodianTeamMemberId: { in: ["team-member-1", "team-member-2"] } },
      ])
    );

    expect(
      andClausesOf(where).some((clause) => "custodianUserId" in clause)
    ).toBe(false);
    expect(where.custodianUserId).toBeUndefined();
  });

  it("keeps the draft visibility clause AND-ed alongside custodian clauses", async () => {
    const where = await captureWhere({
      custodianScope: SELF_SCOPE,
      custodianTeamMemberIds: [VICTIM_TEAM_MEMBER_ID],
    });

    expect(andClausesOf(where)).toEqual(
      expect.arrayContaining([bookingDraftVisibilityClause(RESTRICTED_USER_ID)])
    );
  });
});
