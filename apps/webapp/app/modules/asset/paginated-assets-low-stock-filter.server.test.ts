/**
 * Low-stock filter in the simple-mode list loader.
 *
 * `getPaginatedAndFilterableAssets` serves the asset index and every picker
 * and secondary list. Only the asset index renders the "Low stock only"
 * toggle, so only a caller passing `honorLowStockFilter` narrows the list on
 * `?lowStockOnly=true`. Anywhere else the param would hide assets behind a
 * filter nobody can see or clear.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./data.server.ts} - the asset index caller
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import type * as TeamMemberService from "~/modules/team-member/service.server";
import type * as CookiesServer from "~/utils/cookies.server";
import { getPaginatedAndFilterableAssets } from "./service.server";
import { buildLowStockWhere } from "./utils.server";

// why: the loader fans out to category, tag, location, asset model and asset
// queries. Every model method answers empty, and the test reads back the
// arguments the asset query was called with.
vi.mock("~/database/db.server", () => {
  const model = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  });
  return {
    db: {
      // The column reference buildLowStockWhere compares quantity to.
      asset: { ...model(), fields: { minQuantity: "Asset.minQuantity" } },
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

/** Loads a list whose URL carries `?lowStockOnly=true`. */
function load(honorLowStockFilter?: boolean) {
  return getPaginatedAndFilterableAssets({
    request: new Request("https://shelf.test/assets?lowStockOnly=true"),
    organizationId: "org-1",
    canSeeAllCustody: true,
    honorLowStockFilter,
  });
}

/** The `AND` clauses of the asset list query. */
function assetAndClauses() {
  return vi.mocked(db.asset.findMany).mock.calls[0][0]!.where!.AND;
}

describe("getPaginatedAndFilterableAssets low-stock filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("narrows to low-stock items when the caller renders the toggle", async () => {
    await load(true);

    expect(assetAndClauses()).toEqual([buildLowStockWhere()]);
  });

  it("ignores the param for a caller without the toggle", async () => {
    await load();

    expect(assetAndClauses()).toBeUndefined();
  });
});
