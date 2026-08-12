/**
 * Narrowing of caller-supplied custodian filter ids.
 *
 * `?teamMember=` is raw request input that list queries apply to a custody
 * clause. Redacting the custodian from the payload does not close this on its
 * own: filtering by a colleague's id and reading which rows come back still
 * reveals what that person holds.
 *
 * These tests pin both directions — a restricted caller cannot filter by
 * anyone but themselves, and a caller who MAY see all custody keeps the filter
 * they asked for. The second matters as much as the first: over-narrowing here
 * silently breaks the custodian filter for admins.
 *
 * @see {@link file://./service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ findMany: vi.fn() }));

// why: the subject is which ids survive, not what the database returns. The
// only query involved resolves the caller's own team-member rows.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: dbMocks.findMany } },
}));

import { narrowCustodianFilterIds } from "./service.server";

const ORG = "org-1";
const USER = "user-me";
const MY_TEAM_MEMBER = "tm-me";
const COLLEAGUE_TEAM_MEMBER = "tm-colleague";

describe("narrowCustodianFilterIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.findMany.mockResolvedValue([{ id: MY_TEAM_MEMBER }]);
  });

  it("returns the requested ids untouched when the caller may see all custody", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [COLLEAGUE_TEAM_MEMBER, MY_TEAM_MEMBER],
      canSeeAllCustody: true,
      userId: USER,
      organizationId: ORG,
    });

    // Over-narrowing here would break the custodian filter for admins.
    expect(out).toEqual([COLLEAGUE_TEAM_MEMBER, MY_TEAM_MEMBER]);
    expect(dbMocks.findMany).not.toHaveBeenCalled();
  });

  it("drops a colleague's id for a restricted caller", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [COLLEAGUE_TEAM_MEMBER],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    expect(out).toEqual([]);
  });

  it("keeps the caller's own team-member id", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [MY_TEAM_MEMBER],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    expect(out).toEqual([MY_TEAM_MEMBER]);
  });

  it("keeps the caller's own USER id, which one custody branch matches on", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [USER],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    // The asset filter has a branch matching `custodian.userId`, so ids can be
    // user ids as well as team-member ids.
    expect(out).toEqual([USER]);
  });

  it("keeps only the caller's own ids from a mixed request", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [COLLEAGUE_TEAM_MEMBER, MY_TEAM_MEMBER, "tm-other"],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    expect(out).toEqual([MY_TEAM_MEMBER]);
  });

  it("issues no query when nothing was requested", async () => {
    const out = await narrowCustodianFilterIds({
      teamMemberIds: [],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    expect(out).toEqual([]);
    expect(dbMocks.findMany).not.toHaveBeenCalled();
  });

  it("resolves every team-member row the caller holds, not just one", async () => {
    // The schema has no unique on (userId, organizationId), so a user can hold
    // more than one team-member row and a custody link may point at any of them.
    dbMocks.findMany.mockResolvedValue([{ id: "tm-a" }, { id: "tm-b" }]);

    const out = await narrowCustodianFilterIds({
      teamMemberIds: ["tm-b"],
      canSeeAllCustody: false,
      userId: USER,
      organizationId: ORG,
    });

    expect(out).toEqual(["tm-b"]);
  });
});
