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
 *
 * @see {@link file://./context-helpers.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  resolveAssetIdsForKitSelection,
  resolveAssetIdsForLocationSelection,
} from "./context-helpers.server";

// why: the resolvers (and the org guards they call) hit the global Prisma
// client; mock it so the suite is DB-free. `vitest.hoisted` makes the spies
// available inside the (hoisted) mock factory. Each test sets the return values
// it needs.
const { locationFindMany, kitFindMany, assetFindMany } = vitest.hoisted(() => ({
  locationFindMany: vitest.fn(),
  kitFindMany: vitest.fn(),
  assetFindMany: vitest.fn(),
}));

vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany },
    kit: { findMany: kitFindMany },
    asset: { findMany: assetFindMany },
  },
}));

const ORG = "org-1";

beforeEach(() => {
  locationFindMany.mockReset();
  kitFindMany.mockReset();
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
    // asset query is org-scoped and unions the selected locations.
    // Post-pivot, asset placement lives on the `AssetLocation` pivot — the
    // resolver projects the location filter through `assetLocations.some`.
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetLocations: { some: { locationId: { in: ["l1", "l2"] } } },
      },
      select: { id: true },
    });
  });

  it("explicit selection: dedupes duplicate location IDs before the asset query", async () => {
    // guard sees the unique set; resolver must not re-introduce the duplicate
    locationFindMany.mockResolvedValueOnce([{ id: "l1" }, { id: "l2" }]);
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);

    await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: ["l1", "l1", "l2"],
    });

    // the `in` clause carries each location once, not the raw duplicated input
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetLocations: { some: { locationId: { in: ["l1", "l2"] } } },
      },
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

  it("select all: matches assets via a location relation filter honoring the search (single query, no per-ID guard)", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);

    const result = await resolveAssetIdsForLocationSelection({
      organizationId: ORG,
      locationIds: [ALL_SELECTED_KEY],
      currentSearchParams: "s=seaham",
    });

    expect(result).toEqual(["a1"]);
    // one asset query; its `assetLocations` pivot relation mirrors the active
    // list filter. Post-pivot, the asset→location join goes through
    // `assetLocations.some.location` (was the direct `location` relation).
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetLocations: {
          some: {
            location: {
              organizationId: ORG,
              name: { contains: "seaham", mode: "insensitive" },
            },
          },
        },
      },
      select: { id: true },
    });
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
  it("explicit selection: asserts org ownership, then returns the org-scoped union of asset IDs", async () => {
    // org guard: both requested kits belong to the org
    kitFindMany.mockResolvedValueOnce([{ id: "k1" }, { id: "k2" }]);
    // assets across both kits
    assetFindMany.mockResolvedValueOnce([
      { id: "a1" },
      { id: "a2" },
      { id: "a3" },
    ]);

    const result = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k2"],
    });

    expect(result).toEqual(["a1", "a2", "a3"]);
    // asset query is org-scoped and unions the selected kits. Post-pivot,
    // asset→kit lookup goes through the `AssetKit` pivot.
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetKits: { some: { kitId: { in: ["k1", "k2"] } } },
      },
      select: { id: true },
    });
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
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);

    await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: ["k1", "k1", "k2"],
    });

    // the `in` clause carries each kit once, not the raw duplicated input
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetKits: { some: { kitId: { in: ["k1", "k2"] } } },
      },
      select: { id: true },
    });
  });

  it("select all: matches assets via a kit relation filter honoring the status filter (single query, no per-ID guard)", async () => {
    assetFindMany.mockResolvedValueOnce([{ id: "a1" }]);

    const result = await resolveAssetIdsForKitSelection({
      organizationId: ORG,
      kitIds: [ALL_SELECTED_KEY],
      currentSearchParams: "status=AVAILABLE",
    });

    expect(result).toEqual(["a1"]);
    // one asset query; its `assetKits` pivot relation mirrors the active list
    // filter. Post-pivot, the kit predicate is nested under
    // `assetKits.some.kit` (was the direct `kit` relation).
    expect(assetFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        assetKits: {
          some: { kit: { organizationId: ORG, status: "AVAILABLE" } },
        },
      },
      select: { id: true },
    });
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
