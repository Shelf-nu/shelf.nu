/**
 * `getLocation`: the archived view on a location's asset list.
 *
 * The location's Assets tab offers the Active / Archived / All menu, so the
 * list query and the count that heads it must both follow the chosen view.
 * Callers that do not pass a view (the overview, the edit page, the tree) keep
 * listing every asset.
 *
 * @see {@link file://./service.server.ts} `getLocation`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivedFilter } from "~/modules/asset/types";

// why: exercising getLocation's query building (the asset where clauses)
// without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    location: { findFirstOrThrow: vi.fn() },
    asset: { findMany: vi.fn(), count: vi.fn() },
    assetLocation: { groupBy: vi.fn() },
  },
}));

const { db } = await import("~/database/db.server");
const { getLocation } = await import("./service.server");

const findManyMock = vi.mocked(db.asset.findMany);
const countMock = vi.mocked(db.asset.count);

/** The `archivedAt` constraint each view puts on the asset queries. */
const EXPECTED_ARCHIVED_AT: Record<ArchivedFilter, unknown> = {
  active: null,
  archived: { not: null },
  all: undefined,
};

describe("getLocation archived view", () => {
  beforeEach(() => {
    vi.mocked(db.location.findFirstOrThrow)
      .mockReset()
      .mockResolvedValue({
        id: "loc-1",
      } as never);
    vi.mocked(db.assetLocation.groupBy).mockReset().mockResolvedValue([]);
    findManyMock.mockReset().mockResolvedValue([]);
    countMock.mockReset().mockResolvedValue(0);
  });

  it.each(["active", "archived", "all"] as const)(
    "applies the %s view to both the list and its count",
    async (view) => {
      await getLocation({
        id: "loc-1",
        organizationId: "org-1",
        archivedFilter: view,
      });

      const listWhere = findManyMock.mock.calls[0]?.[0]?.where;
      const countWhere = countMock.mock.calls[0]?.[0]?.where;
      expect(listWhere?.archivedAt).toEqual(EXPECTED_ARCHIVED_AT[view]);
      expect(countWhere?.archivedAt).toEqual(EXPECTED_ARCHIVED_AT[view]);
      expect(countWhere?.assetLocations).toEqual({
        some: { locationId: "loc-1" },
      });
    }
  );

  it("counts only the assets the search and custodian filters keep", async () => {
    await getLocation({
      id: "loc-1",
      organizationId: "org-1",
      search: "Sony",
      teamMemberIds: ["tm-1"],
      archivedFilter: "active",
    });

    const listWhere = findManyMock.mock.calls[0]?.[0]?.where;
    const countWhere = countMock.mock.calls[0]?.[0]?.where;
    expect(countWhere?.title).toEqual({
      contains: "Sony",
      mode: "insensitive",
    });
    // Every way a team member can hold an asset: custody (by team member or
    // user id) and an ongoing or overdue booking (by either id).
    expect(countWhere?.OR).toEqual([
      {
        custody: {
          some: expect.objectContaining({ teamMemberId: { in: ["tm-1"] } }),
        },
      },
      {
        custody: {
          some: expect.objectContaining({
            custodian: { userId: { in: ["tm-1"] } },
          }),
        },
      },
      {
        bookingAssets: {
          some: {
            booking: expect.objectContaining({
              custodianTeamMemberId: { in: ["tm-1"] },
            }),
          },
        },
      },
      {
        bookingAssets: {
          some: {
            booking: expect.objectContaining({
              custodianUserId: { in: ["tm-1"] },
            }),
          },
        },
      },
    ]);
    // The pager reads this count, so it must describe exactly the listed rows.
    expect(countWhere).toEqual(listWhere);
  });

  it("loads the location alone when the caller passes an include", async () => {
    const result = await getLocation({
      id: "loc-1",
      organizationId: "org-1",
      include: { notes: { select: { id: true } } },
    });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
    expect(result.totalAssetsWithinLocation).toBe(0);
  });

  it("counts without loading a page when the caller asks for no page", async () => {
    countMock.mockResolvedValue(8);

    const result = await getLocation({
      id: "loc-1",
      organizationId: "org-1",
      withAssetsPage: false,
    });

    expect(findManyMock).not.toHaveBeenCalled();
    expect(result.totalAssetsWithinLocation).toBe(8);
    expect(result.assets).toEqual([]);
  });

  it("lists every asset when the caller names no view", async () => {
    await getLocation({ id: "loc-1", organizationId: "org-1" });

    expect(findManyMock.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "archivedAt"
    );
    expect(countMock.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "archivedAt"
    );
  });
});
