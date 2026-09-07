/**
 * Ordering contract for the team-member notification picker.
 *
 * The picker renders `resolveTeamMemberName`, which resolves `displayName`
 * first and falls back to `firstName lastName`. The query has to sort by that
 * same resolved label, and Prisma's `orderBy` cannot express a COALESCE — so
 * the ordering key is the one column that already materialises it.
 *
 * @see {@link file://./service.server.ts} — `getTeamMembersForNotify`
 * @see {@link file://./../user/service.server.ts} — `updateUser`, which keeps
 *   `TeamMember.name` in sync with the user's display name
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  teamMember: { findMany: vi.fn() },
}));

// why: the assertion is about the query Prisma is handed, so the client is
// stubbed rather than hit — no database needed to read back an `orderBy`.
vi.mock("~/database/db.server", () => ({
  db: { teamMember: { findMany: dbMocks.teamMember.findMany } },
}));

import { getTeamMembersForNotify } from "~/modules/team-member/service.server";

describe("getTeamMembersForNotify ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.teamMember.findMany.mockResolvedValue([]);
  });

  it("orders by TeamMember.name, the materialised resolved label", async () => {
    await getTeamMembersForNotify({ organizationId: "org-1" });

    const { orderBy } = dbMocks.teamMember.findMany.mock.calls[0][0];

    expect(orderBy[0]).toEqual({ name: "asc" });
  });

  it("never leads with user.displayName, which segregates the list", async () => {
    // Prisma emits no NULLS clause, so ASC puts non-NULLs first: leading with
    // `displayName` hoists every renamed user above every un-renamed one, and
    // a display-name "Zoe" lands before a fallback "Aaron". The list is then
    // not alphabetical by anything the viewer can see.
    await getTeamMembersForNotify({ organizationId: "org-1" });

    const { orderBy } = dbMocks.teamMember.findMany.mock.calls[0][0];

    expect(orderBy[0]).not.toHaveProperty("user");
  });

  it("breaks ties deterministically so the picker order is stable", async () => {
    // Two members can share a name; without a tie-break, which one comes first
    // can differ between identical requests.
    await getTeamMembersForNotify({ organizationId: "org-1" });

    const { orderBy } = dbMocks.teamMember.findMany.mock.calls[0][0];

    expect(orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
  });
});
