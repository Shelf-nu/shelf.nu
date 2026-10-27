/**
 * Location Assets tab: what the custodian filter and the empty state may use.
 *
 * `?teamMember=` is request input applied to a custody clause, so a member who
 * may not see other people's custody must not be able to filter by a
 * colleague. And the Active view's "archived assets are hidden" empty state
 * explains an empty location, which a search or filter can also produce, so
 * its count is only taken on an unfiltered list.
 *
 * @see {@link file://./../../../app/routes/_layout+/locations.$locationId.assets.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "~/routes/_layout+/locations.$locationId.assets";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";

// why: the loader reaches Prisma; the custodian narrowing reads the caller's
// own team members, and the archived count is the query under test.
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: { findMany: vi.fn() },
    asset: { count: vi.fn() },
  },
}));
// why: getLocation runs the asset queries; this test only checks what the
// loader asks it for.
vi.mock("~/modules/location/service.server", () => ({
  getLocation: vi.fn(),
  updateLocationAssets: vi.fn(),
}));
// why: the per-pool custody and booking counts run their own queries and are
// not under test here.
vi.mock("~/modules/asset/custody-source.server", () => ({
  getCustodyFromLocationByPool: vi.fn(),
}));
vi.mock("~/modules/booking/checkout-source-location.server", () => ({
  loadMultiPlacedPoolIds: vi.fn(),
}));
vi.mock("~/modules/booking/units-out-by-source.server", () => ({
  countUnitsOnBookingsFromLocation: vi.fn(),
}));
// why: the permission resolver needs a session and a database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));
// why: the dropdown's team-member list is a separate query; the narrowing
// helper stays real so the test pins the actual scoping.
vi.mock("~/modules/team-member/service.server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/modules/team-member/service.server")
  >()),
  getTeamMemberForCustodianFilter: vi.fn(),
}));

import { db } from "~/database/db.server";
import { getCustodyFromLocationByPool } from "~/modules/asset/custody-source.server";
import { loadMultiPlacedPoolIds } from "~/modules/booking/checkout-source-location.server";
import { countUnitsOnBookingsFromLocation } from "~/modules/booking/units-out-by-source.server";
import { getLocation } from "~/modules/location/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { requirePermission } from "~/utils/roles.server";

/** Loader args for the Assets tab opened with the given query string. */
function buildArgs(query: string) {
  return {
    request: new Request(
      `http://localhost/locations/location-1/assets${query}`
    ),
    params: { locationId: "location-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0];
}

/** Mocks the permission check for a member who may or may not see all custody. */
function signInAs({ seeAllCustody }: { seeAllCustody: boolean }) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    userOrganizations: [],
    access: {
      custody: { seeAll: seeAllCustody },
      policy: { assets: { seeArchived: false } },
    },
  } as never);
}

/** The custodian ids the loader handed to getLocation. */
function custodianIdsSentToGetLocation() {
  return vi.mocked(getLocation).mock.calls[0]?.[0]?.teamMemberIds;
}

describe("locations.$locationId.assets loader: custodian filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLocation).mockResolvedValue({
      location: { id: "location-1", name: "Shelf B2" },
      totalAssetsWithinLocation: 0,
      assets: [],
    } as never);
    vi.mocked(getTeamMemberForCustodianFilter).mockResolvedValue({
      teamMembers: [],
      totalTeamMembers: 0,
    } as never);
    vi.mocked(getCustodyFromLocationByPool).mockResolvedValue({} as never);
    vi.mocked(loadMultiPlacedPoolIds).mockResolvedValue(new Set() as never);
    vi.mocked(countUnitsOnBookingsFromLocation).mockResolvedValue(
      new Map() as never
    );
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-own" },
    ] as never);
    vi.mocked(db.asset.count).mockResolvedValue(3);
  });

  it("refuses a colleague's id for a member who may not see all custody", async () => {
    signInAs({ seeAllCustody: false });

    await loader(buildArgs("?teamMember=tm-colleague"));

    expect(custodianIdsSentToGetLocation()).toEqual([CUSTODY_FILTER_REFUSED]);
  });

  it("keeps the member's own id and Without custody", async () => {
    signInAs({ seeAllCustody: false });

    await loader(
      buildArgs(
        "?teamMember=tm-own&teamMember=tm-colleague&teamMember=without-custody"
      )
    );

    expect(custodianIdsSentToGetLocation()).toEqual([
      "tm-own",
      "without-custody",
    ]);
  });

  it("passes every id through for a member who sees all custody", async () => {
    signInAs({ seeAllCustody: true });

    await loader(buildArgs("?teamMember=tm-colleague"));

    expect(custodianIdsSentToGetLocation()).toEqual(["tm-colleague"]);
  });
});

describe("locations.$locationId.assets loader: archived-hidden count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInAs({ seeAllCustody: true });
    vi.mocked(getLocation).mockResolvedValue({
      location: { id: "location-1", name: "Shelf B2" },
      totalAssetsWithinLocation: 0,
      assets: [],
    } as never);
    vi.mocked(getTeamMemberForCustodianFilter).mockResolvedValue({
      teamMembers: [],
      totalTeamMembers: 0,
    } as never);
    vi.mocked(getCustodyFromLocationByPool).mockResolvedValue({} as never);
    vi.mocked(loadMultiPlacedPoolIds).mockResolvedValue(new Set() as never);
    vi.mocked(countUnitsOnBookingsFromLocation).mockResolvedValue(
      new Map() as never
    );
    vi.mocked(db.asset.count).mockResolvedValue(3);
  });

  it("counts archived assets on an unfiltered list", async () => {
    const result = await loader(buildArgs(""));

    expect(result.archivedAssetCount).toBe(3);
  });

  it.each([
    ["a search", "?s=Laerdal"],
    ["a custodian filter", "?teamMember=tm-colleague"],
  ])(
    "does not blame archiving for an empty list under %s",
    async (_label, query) => {
      const result = await loader(buildArgs(query));

      expect(result.archivedAssetCount).toBe(0);
      expect(db.asset.count).not.toHaveBeenCalled();
    }
  );
});
