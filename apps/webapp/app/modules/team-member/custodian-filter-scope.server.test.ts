/**
 * Seed/count agreement for the custodian filter.
 *
 * `getTeamMemberForCustodianFilter` returns both the rows a picker renders and
 * the total its "showing N out of M" footer prints. Scoping the rows while
 * counting unscoped puts the workspace's team-member total into a restricted
 * user's loader payload, and makes the footer disagree with what
 * `/api/model-filters` returns for the same caller.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
}));

// why: the subject is the `where` handed to Prisma, not what a database
// returns — both queries must be built from the same scope.
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findMany: dbMocks.findMany,
      count: dbMocks.count,
    },
  },
}));

import { getTeamMemberForCustodianFilter } from "./service.server";

const ORGANIZATION_ID = "org-1";
const USER_ID = "user-1";

/** The `where` of the row query that excludes already-selected members. */
function rowsWhere() {
  return dbMocks.findMany.mock.calls[0]?.[0]?.where;
}

/** The `where` of the count query. */
function countWhere() {
  return dbMocks.count.mock.calls.at(-1)?.[0]?.where;
}

describe("getTeamMemberForCustodianFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.findMany.mockResolvedValue([]);
    dbMocks.count.mockResolvedValue(0);
  });

  it("counts with the same scope it lists with, when restricted", async () => {
    await getTeamMemberForCustodianFilter({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      filterByUserId: true,
    });

    expect(rowsWhere().userId).toBe(USER_ID);
    // The regression: the count used to omit `userId` entirely, so a caller
    // seeing one row was told the workspace had N.
    expect(countWhere().userId).toBe(USER_ID);
    expect(countWhere().organizationId).toBe(ORGANIZATION_ID);
    expect(countWhere().deletedAt).toBeNull();
  });

  it("counts unscoped when the caller may see everyone", async () => {
    await getTeamMemberForCustodianFilter({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      filterByUserId: false,
    });

    expect(rowsWhere().userId).toBeUndefined();
    expect(countWhere().userId).toBeUndefined();
  });

  it("carries the usersOnly narrowing into the count too", async () => {
    await getTeamMemberForCustodianFilter({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      filterByUserId: true,
      usersOnly: true,
    });

    expect(countWhere().user).toEqual({ isNot: null });
  });

  it("returns nothing and queries nothing when the scope is `none`", async () => {
    const result = await getTeamMemberForCustodianFilter({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      returnNone: true,
    });

    // BASE may never assign custody — an empty list is the answer, and there
    // is no reason to touch the database for it.
    expect(result).toEqual({ teamMembers: [], totalTeamMembers: 0 });
    expect(dbMocks.findMany).not.toHaveBeenCalled();
    expect(dbMocks.count).not.toHaveBeenCalled();
  });
});
