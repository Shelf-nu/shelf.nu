/**
 * Location override in the "select all" where-builder.
 *
 * `getAssetsWhereInput` matches the URL's `location` values exactly. A surface
 * that widens its visible list (ticked locations plus their child locations)
 * passes the widened set as `locationIdsOverride`, so select-all acts on the
 * rows that list showed. Every other caller passes nothing and must get
 * exactly the clause it got before the option existed.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../location/child-locations-filter.server.ts}
 */
import { describe, expect, it, vi } from "vitest";

// why: the where-builder is pure, but its module graph reaches `db.server`,
// which opens a real Prisma connection on import. Nothing here queries.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { getAssetsWhereInput } from "./utils.server";

const ORG = "org-1";

function build(currentSearchParams: string, locationIdsOverride?: string[]) {
  return getAssetsWhereInput({
    organizationId: ORG,
    currentSearchParams,
    allowedTeamMemberIds: "all",
    locationIdsOverride,
  });
}

describe("getAssetsWhereInput location override", () => {
  it("matches the URL's locations exactly when no override is passed", () => {
    expect(build("location=campus&category=cat-1")).toEqual({
      organizationId: ORG,
      categoryId: { in: ["cat-1"] },
      assetLocations: { some: { locationId: { in: ["campus"] } } },
    });
  });

  it("matches the override set in place of the URL's locations", () => {
    expect(
      build("location=campus&category=cat-1", ["campus", "building-a"])
    ).toEqual({
      organizationId: ORG,
      categoryId: { in: ["cat-1"] },
      assetLocations: {
        some: { locationId: { in: ["campus", "building-a"] } },
      },
    });
  });

  it("keeps the without-location branch when the override carries it", () => {
    const where = build("location=without-location&location=campus", [
      "without-location",
      "campus",
      "building-a",
    ]);

    expect(where.OR).toEqual([
      {
        assetLocations: {
          some: {
            locationId: { in: ["without-location", "campus", "building-a"] },
          },
        },
      },
      { assetLocations: { none: {} } },
    ]);
    expect(where.assetLocations).toBeUndefined();
  });

  it("adds no location clause for an empty URL, override or not", () => {
    expect(build("")).toEqual({ organizationId: ORG });
    expect(build("", ["campus"])).toEqual({ organizationId: ORG });
  });
});
