/**
 * Location override in the simple-mode list loader.
 *
 * `getPaginatedAndFilterableAssets` matches the URL's `location` values
 * exactly. A surface that widens its visible list (ticked locations plus their
 * child locations) passes the widened set as `locationIdsOverride`. The asset
 * query must match that set, while the Locations dropdown seed keeps reading
 * the URL so the widening never changes which options read as ticked.
 *
 * The select-all half of the same contract is pinned in
 * `where-input-location-override.server.test.ts`.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../location/child-locations-filter.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import type * as TeamMemberService from "~/modules/team-member/service.server";
import type * as CookiesServer from "~/utils/cookies.server";
import { getPaginatedAndFilterableAssets } from "./service.server";

// why: the loader fans out to category, tag, location, asset model and asset
// queries. Every model method answers empty, and the test reads back the
// arguments the asset and location queries were called with.
vi.mock("~/database/db.server", () => {
  const model = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  });
  return {
    db: {
      asset: model(),
      category: model(),
      tag: model(),
      location: model(),
      assetModel: model(),
    },
  };
});

// why: the custodian filter seed and its scoping are covered by their own
// tests; here they only have to answer without a team-member fixture.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof TeamMemberService>()),
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
  getTeamMemberForCustodianFilter: vi.fn().mockResolvedValue({}),
}));

// why: the per-page cookie needs a signed session cookie, which this test does
// not exercise.
vi.mock("~/utils/cookies.server", async (importOriginal) => ({
  ...(await importOriginal<typeof CookiesServer>()),
  updateCookieWithPerPage: vi.fn().mockResolvedValue({ perPage: 20 }),
}));

const ORG = "org-1";

/** Loads the list for `?location=campus`, with an optional override. */
function load(locationIdsOverride?: string[]) {
  return getPaginatedAndFilterableAssets({
    request: new Request("https://shelf.test/bookings/b1?location=campus"),
    organizationId: ORG,
    canSeeAllCustody: true,
    locationIdsOverride,
  });
}

/** The location clause of the asset list query. */
function assetLocationClause() {
  return vi.mocked(db.asset.findMany).mock.calls[0][0]!.where!.assetLocations;
}

/** The ids the Locations dropdown loads as ticked. */
function seededSelectedLocationIds() {
  // The seed's second location query loads the ticked ids: `id: { in }`.
  const selectedCall = vi
    .mocked(db.location.findMany)
    .mock.calls.find(([args]) => {
      const idFilter = args?.where?.id;
      return (
        typeof idFilter === "object" && idFilter !== null && "in" in idFilter
      );
    });
  return (selectedCall?.[0]?.where?.id as { in: string[] }).in;
}

describe("getPaginatedAndFilterableAssets location override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches the URL's locations exactly when no override is passed", async () => {
    await load();

    expect(assetLocationClause()).toEqual({
      some: { locationId: { in: ["campus"] } },
    });
  });

  it("matches the override set in the asset query", async () => {
    await load(["campus", "building-a", "room-a1"]);

    expect(assetLocationClause()).toEqual({
      some: { locationId: { in: ["campus", "building-a", "room-a1"] } },
    });
  });

  it("keeps the Locations dropdown on the URL's ticked locations", async () => {
    await load(["campus", "building-a", "room-a1"]);

    expect(seededSelectedLocationIds()).toEqual(["campus"]);
  });
});
