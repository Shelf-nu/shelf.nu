/**
 * Location hierarchy lookups: the one-query walk over several roots.
 *
 * The recursive SQL itself needs Postgres. These tests pin what the helper
 * sends to it: nothing for no roots, and exactly one statement carrying the
 * de-duplicated roots and the caller's workspace for any number of roots.
 *
 * @see {@link file://./descendants.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getDescendantIdsOfLocations } from "./descendants.server";

// why: the helper is one raw recursive query; the unit suite cannot reach
// Postgres, so the tests read the statement's bound values instead.
vi.mock("~/database/db.server", () => ({
  db: { $queryRaw: vi.fn() },
}));

const ORG = "org-1";

beforeEach(() => {
  vi.mocked(db.$queryRaw).mockReset();
});

describe("getDescendantIdsOfLocations", () => {
  it("runs no query for no roots", async () => {
    expect(
      await getDescendantIdsOfLocations({
        organizationId: ORG,
        locationIds: [],
      })
    ).toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("walks every root in one statement, each root once, scoped to the workspace", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { id: "campus" },
      { id: "building-a" },
      { id: "room-a1" },
    ] as never);

    const ids = await getDescendantIdsOfLocations({
      organizationId: ORG,
      locationIds: ["campus", "campus", "building-a", "campus"],
    });

    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    // Tagged-template call: (strings, ...bound values).
    const [strings, ...values] = vi.mocked(db.$queryRaw).mock.calls[0];
    expect(values).toEqual([["campus", "building-a"], ORG, ORG]);
    // Both the roots and every recursive step carry the workspace filter.
    const sql = (strings as unknown as string[]).join("?");
    expect(sql.match(/"organizationId" = \?/g)).toHaveLength(2);
    expect(ids).toEqual(["campus", "building-a", "room-a1"]);
  });
});
