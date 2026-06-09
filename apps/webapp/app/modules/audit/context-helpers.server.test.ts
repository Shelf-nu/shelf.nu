// @vitest-environment node
/**
 * Unit tests for `resolveAssetIdsForLocationSelection` — the resolver behind the
 * bulk "Create audit" action on the Locations index.
 *
 * Covers the security- and correctness-critical behaviors:
 * - explicit multi-location selection → org-scoped union of asset IDs
 * - the IDOR guard rejects a foreign/tampered location ID before any asset read
 * - "select all" resolves the filtered location set (honoring the name search)
 *   and skips the per-ID guard (the set is org-scoped by construction)
 * - an empty union surfaces a clear 400 instead of creating an empty audit
 *
 * @see {@link file://./context-helpers.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { resolveAssetIdsForLocationSelection } from "./context-helpers.server";

// why: the resolver (and the org guard it calls) hit the global Prisma client;
// mock it so the suite is DB-free. `vitest.hoisted` makes the spies available
// inside the (hoisted) mock factory. Each test sets the return values it needs.
const { locationFindMany, assetFindMany } = vitest.hoisted(() => ({
  locationFindMany: vitest.fn(),
  assetFindMany: vitest.fn(),
}));

vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany },
    asset: { findMany: assetFindMany },
  },
}));

const ORG = "org-1";
const ALL_SELECTED = "all-selected"; // mirrors ALL_SELECTED_KEY in ~/utils/list

beforeEach(() => {
  locationFindMany.mockReset();
  assetFindMany.mockReset();
});

describe("resolveAssetIdsForLocationSelection", () => {
  it("explicit selection: asserts org ownership, then returns the org-scoped union of asset IDs", async () => {
    // org guard: both requested locations belong to the org
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]);
    // assets across both locations
    assetFindMany.mockResolvedValueOnce([
      { id: "a1" },
      { id: "a2" },
      { id: "a3" },
    ]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l2"],
    });

    expect(result).toEqual(["a1", "a2", "a3"]);
    // asset query is org-scoped and unions the selected locations
    expect(assetFindMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, locationId: { in: ["l1", "l2"] } },
      select: { id: true },
    });
  });

  it("rejects a foreign/tampered location ID before reading any assets (IDOR guard)", async () => {
    // org-scoped guard returns only one of the two requested → count mismatch
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }]);

    const err = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l2-foreign"],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    // the asset query must never run for a tampered selection
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("select all: resolves the filtered location set honoring the search, with no per-ID guard", async () => {
    // resolver resolves all matching locations, then their assets
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]);
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: [ALL_SELECTED],
      currentSearchParams: "s=seaham",
    });

    expect(result).toEqual(["a1"]);
    // location set honors the active name search (mirrors the list filter)
    expect(locationFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        name: { contains: "seaham", mode: "insensitive" },
      },
      select: { id: true },
    });
  });

  it("throws a clear 400 when none of the selected locations contain assets", async () => {
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]); // guard passes
    assetFindMany.mockResolvedValueOnce([]); // empty union

    const err = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l2"],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/contain assets/i);
  });
});
