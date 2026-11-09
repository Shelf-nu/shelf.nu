// @vitest-environment node
/**
 * Unit tests for the bulk "Create audit" resolvers behind the multi-select on
 * the Locations index (`resolveAssetIdsForLocationSelection`) and the Kits
 * index (`resolveAssetIdsForKitSelection`).
 *
 * Covers the security- and correctness-critical behaviors for each:
 * - explicit multi-select → org-scoped union of asset IDs
 * - the IDOR guard rejects a foreign/tampered ID before any asset read
 * - "select all" matches assets via a relation filter (honoring the list
 *   filter — name search for locations, status for kits) in a single query,
 *   skipping the per-ID guard (the set is org-scoped by construction)
 * - an empty union surfaces a clear 400 instead of creating an empty audit
 * - the unit scope each start context hands the new audit, read from the same
 *   query that finds the assets
 *
 * @see {@link file://./context-helpers.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  resolveAssetIdsForAudit,
  resolveAssetIdsForKitSelection,
  resolveAssetIdsForLocationSelection,
} from "./context-helpers.server";

// why: the resolvers (and the org guards they call) hit the global Prisma
// client; mock it so the suite is DB-free. `vitest.hoisted` makes the spies
// available inside the (hoisted) mock factory. Each test sets the return values
// it needs.
const {
  locationFindMany,
  locationFindFirst,
  kitFindMany,
  kitFindFirst,
  assetFindMany,
} = vitest.hoisted(() => ({
  locationFindMany: vitest.fn(),
  locationFindFirst: vitest.fn(),
  kitFindMany: vitest.fn(),
  kitFindFirst: vitest.fn(),
  assetFindMany: vitest.fn(),
}));

vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany, findFirst: locationFindFirst },
    kit: { findMany: kitFindMany, findFirst: kitFindFirst },
    asset: { findMany: assetFindMany },
  },
}));

// why: descendant lookup walks the location tree in the database; a fixed tree
// is enough for the location page's child-location case.
vitest.mock("~/modules/location/descendants.server", () => ({
  getLocationDescendantIds: vitest.fn(() =>
    Promise.resolve(["studio", "shelf-1"])
  ),
}));

const ORG = "org-1";

beforeEach(() => {
  locationFindMany.mockReset();
  locationFindFirst.mockReset();
  kitFindMany.mockReset();
  kitFindFirst.mockReset();
  assetFindMany.mockReset();
});

describe("resolveAssetIdsForLocationSelection", () => {
  /** The asset query for a placement filter, with the scope read alongside. */
  const assetQuery = (placementWhere: unknown) => ({
    where: { organizationId: ORG, assetLocations: { some: placementWhere } },
    select: {
      id: true,
      assetLocations: { where: placementWhere, select: { locationId: true } },
    },
  });

  it("explicit selection: asserts org ownership, then returns the org-scoped union of asset IDs", async () => {
    // org guard: both requested locations belong to the org
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]);
    // assets across both locations
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetLocations: [{ locationId: "l1" }] },
      { id: "a2", assetLocations: [{ locationId: "l2" }] },
      { id: "a3", assetLocations: [{ locationId: "l1" }] },
    ]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l2"],
    });

    expect(result.assetIds).toEqual(["a1", "a2", "a3"]);
    // asset query is org-scoped and unions the selected locations.
    // Post-pivot, asset placement lives on the `AssetLocation` pivot — the
    // resolver projects the location filter through `assetLocations.some`.
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({ locationId: { in: ["l1", "l2"] } })
    );
  });

  it("names the selected locations that hold the assets, once each, as the unit scope", async () => {
    locationFindMany.mockResolvedValueOnce([
      { id: "l1" },
      { id: "l2" },
      { id: "l-empty" },
    ]);
    // a pool placed in both selected locations, and an individual asset in l1
    assetFindMany.mockResolvedValueOnce([
      {
        id: "pool",
        assetLocations: [{ locationId: "l1" }, { locationId: "l2" }],
      },
      { id: "a1", assetLocations: [{ locationId: "l1" }] },
    ]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l2", "l-empty"],
    });

    expect(result.locationIds).toEqual(["l1", "l2"]);
    // the scope comes from the asset query: no second location read
    expect(locationFindMany).toHaveBeenCalledTimes(1);
  });

  it("explicit selection: dedupes duplicate location IDs before the asset query", async () => {
    // guard sees the unique set; resolver must not re-introduce the duplicate
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]);
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetLocations: [{ locationId: "l1" }] },
    ]);

    await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l1", "l2"],
    });

    // the `in` clause carries each location once, not the raw duplicated input
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({ locationId: { in: ["l1", "l2"] } })
    );
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

  it("select all: matches assets via a location relation filter honoring the search (single query, no per-ID guard)", async () => {
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetLocations: [{ locationId: "seaham-store" }] },
    ]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: [ALL_SELECTED_KEY],
      currentSearchParams: "s=seaham",
    });

    expect(result.assetIds).toEqual(["a1"]);
    // the scope is only the matching locations that hold an asset, not every
    // location the list filter matches
    expect(result.locationIds).toEqual(["seaham-store"]);
    // One asset query, whose `assetLocations` pivot relation carries the SAME
    // predicate the locations list applies — all three searchable text fields,
    // via the shared `getLocationsWhereInput`. Matching fewer of them here
    // would expand "select all" to a smaller set than the operator was looking
    // at, and then audit that. The asset→location join goes through
    // `assetLocations.some.location`.
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({
        location: {
          organizationId: ORG,
          OR: [
            { name: { contains: "seaham", mode: "insensitive" } },
            { description: { contains: "seaham", mode: "insensitive" } },
            { address: { contains: "seaham", mode: "insensitive" } },
          ],
        },
      })
    );
    // select-all is org-scoped by construction — no separate location lookup
    // and no per-ID guard
    expect(locationFindMany).not.toHaveBeenCalled();
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

describe("resolveAssetIdsForKitSelection", () => {
  /** The asset query for a kit filter, with the scope read alongside. */
  const assetQuery = (membershipWhere: unknown) => ({
    where: { organizationId: ORG, assetKits: { some: membershipWhere } },
    select: {
      id: true,
      assetKits: { where: membershipWhere, select: { kitId: true } },
    },
  });

  it("explicit selection: asserts org ownership, then returns the org-scoped union of asset IDs", async () => {
    // org guard: both requested kits belong to the org
    kitFindMany.mockResolvedValueOnce([{ id: "k1" }, { id: "k2" }]);
    // assets across both kits
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetKits: [{ kitId: "k1" }] },
      { id: "a2", assetKits: [{ kitId: "k2" }] },
      { id: "a3", assetKits: [{ kitId: "k1" }] },
    ]);

    const result = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k2"],
    });

    expect(result).toEqual({
      assetIds: ["a1", "a2", "a3"],
      kitIds: ["k1", "k2"],
    });
    // asset query is org-scoped and unions the selected kits. Post-pivot,
    // asset→kit lookup goes through the `AssetKit` pivot.
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({ kitId: { in: ["k1", "k2"] } })
    );
  });

  it("rejects a foreign/tampered kit ID before reading any assets (IDOR guard)", async () => {
    // org-scoped guard returns only one of the two requested → count mismatch
    kitFindMany.mockResolvedValueOnce([{ id: "k1" }]);

    const err = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k2-foreign"],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    // the asset query must never run for a tampered selection
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("explicit selection: dedupes duplicate kit IDs before the asset query", async () => {
    // guard sees the unique set; resolver must not re-introduce the duplicate
    kitFindMany.mockResolvedValueOnce([{ id: "k1" }, { id: "k2" }]);
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetKits: [{ kitId: "k1" }] },
    ]);

    await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k1", "k2"],
    });

    // the `in` clause carries each kit once, not the raw duplicated input
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({ kitId: { in: ["k1", "k2"] } })
    );
  });

  it("select all: matches assets via a kit relation filter honoring the status filter (single query, no per-ID guard)", async () => {
    assetFindMany.mockResolvedValueOnce([
      { id: "a1", assetKits: [{ kitId: "k3" }] },
    ]);

    const result = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: [ALL_SELECTED_KEY],
      currentSearchParams: "status=AVAILABLE",
    });

    // the scope is only the matching kits that hold an asset
    expect(result).toEqual({ assetIds: ["a1"], kitIds: ["k3"] });
    // one asset query; its `assetKits` pivot relation mirrors the active list
    // filter. Post-pivot, the kit predicate is nested under
    // `assetKits.some.kit` (was the direct `kit` relation).
    expect(assetFindMany).toHaveBeenCalledWith(
      assetQuery({ kit: { organizationId: ORG, status: "AVAILABLE" } })
    );
    // select-all is org-scoped by construction — no separate kit lookup and no
    // per-ID guard
    expect(kitFindMany).not.toHaveBeenCalled();
  });

  it("throws a clear 400 when none of the selected kits contain assets", async () => {
    kitFindMany.mockResolvedValueOnce([{ id: "k1" }, { id: "k2" }]); // guard passes
    assetFindMany.mockResolvedValueOnce([]); // empty union

    const err = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k2"],
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/contain assets/i);
  });
});

describe("resolveAssetIdsForAudit: unit scope", () => {
  it("has no unit scope for an audit of selected assets", async () => {
    expect(
      await resolveAssetIdsForAudit({
        organizationId: ORG,
        directAssetIds: ["a1"],
        includeChildLocations: false,
      })
    ).toEqual({ assetIds: ["a1"], unitScope: null });
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("scopes a location page audit to that location", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);
    expect(
      await resolveAssetIdsForAudit({
        organizationId: ORG,
        contextType: "location",
        contextId: "studio",
        includeChildLocations: false,
      })
    ).toEqual({ assetIds: ["a1"], unitScope: { locationIds: ["studio"] } });
    // the scope is the locations the asset query used: no location lookup
    expect(locationFindFirst).not.toHaveBeenCalled();
  });

  it("adds the child locations when the auditor included them", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);
    expect(
      (
        await resolveAssetIdsForAudit({
          organizationId: ORG,
          contextType: "location",
          contextId: "studio",
          includeChildLocations: true,
        })
      ).unitScope
    ).toEqual({ locationIds: ["studio", "shelf-1"] });
  });

  it("scopes a kit page audit to that kit", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);
    expect(
      (
        await resolveAssetIdsForAudit({
          organizationId: ORG,
          contextType: "kit",
          contextId: "kit-1",
          includeChildLocations: false,
        })
      ).unitScope
    ).toEqual({ kitIds: ["kit-1"] });
    expect(kitFindFirst).not.toHaveBeenCalled();
  });

  it("scopes a custody audit to that person", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);
    expect(
      (
        await resolveAssetIdsForAudit({
          organizationId: ORG,
          contextType: "user",
          contextId: "user-7",
          includeChildLocations: false,
        })
      ).unitScope
    ).toEqual({ custodianUserId: "user-7" });
  });

  it("refuses a context from another workspace before any scope is kept", async () => {
    // the org-scoped asset query finds nothing behind a foreign id
    assetFindMany.mockResolvedValueOnce([]);

    const err = await resolveAssetIdsForAudit({
      organizationId: ORG,
      contextType: "kit",
      contextId: "foreign-kit",
      includeChildLocations: false,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
  });
});
