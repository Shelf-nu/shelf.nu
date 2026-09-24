/**
 * Location bulk "select all" — filter scope
 *
 * The bulk dialogs post to a bare `actionUrl` (`/locations/:id/assets`), so
 * inside the action `request.url` carries no query string. Deriving the user's
 * filters from it therefore yields an empty set, and "select all" silently
 * becomes "select everything at this location" — the user removes 100 items
 * having been shown 10.
 *
 * The filters must come from the submitted `currentSearchParams` field, which
 * the shared dialog has always sent.
 *
 * The real where-builders run here, with only the database boundary mocked —
 * they are pure, and asserting on the clause they actually produce is what
 * makes this a regression test rather than an argument-forwarding check. Same
 * shape as {@link file://./../asset/where-input-custodian-scope.server.test.ts}.
 *
 * Regression coverage for detail.dev finding D109.
 *
 * @see {@link file://./bulk-select.server.ts}
 * @see {@link file://./../../components/bulk-update-dialog/bulk-update-dialog.tsx}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the builders are pure, but their module graph reaches `db.server`,
// which opens a real Prisma connection on import. Nothing here queries through
// it — the resolvers' own findMany calls are asserted on the mock below.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn() },
    kit: { findMany: vi.fn() },
  },
}));

import { db } from "~/database/db.server";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  resolveLocationAssetIds,
  resolveLocationKitIds,
} from "./bulk-select.server";

// @vitest-environment node

const assetFindMany = db.asset.findMany as unknown as ReturnType<typeof vi.fn>;
const kitFindMany = db.kit.findMany as unknown as ReturnType<typeof vi.fn>;

const ORG = "org-1";
const LOC = "loc-1";

/** The `where` the resolver actually handed to Prisma */
function assetWhere() {
  return assetFindMany.mock.calls[0][0].where;
}
function kitWhere() {
  return kitFindMany.mock.calls[0][0].where;
}

/** Flattens a Prisma where into a JSON blob for substring assertions */
function blob(where: unknown) {
  return JSON.stringify(where);
}

describe("resolveLocationAssetIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assetFindMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  });

  it("returns explicit ids untouched", async () => {
    const ids = await resolveLocationAssetIds({
      ids: ["a1", "a2"],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
    });

    expect(ids).toEqual(["a1", "a2"]);
    // No expansion means no query at all
    expect(assetFindMany).not.toHaveBeenCalled();
  });

  it("applies the submitted search and category filters", async () => {
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop&category=cat-1",
    });

    const where = assetWhere();
    expect(where.organizationId).toBe(ORG);
    expect(blob(where)).toContain("laptop");
    expect(blob(where)).toContain("cat-1");
  });

  it("still scopes to the location", async () => {
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
    });

    expect(assetWhere().assetLocations).toEqual({ some: { locationId: LOC } });
  });

  it("does not refuse the custodian filter", async () => {
    // Location writes are ADMIN/OWNER-only, so the resolver passes
    // `allowedTeamMemberIds: "all"` on purpose. If that ever regresses the
    // builder emits CUSTODY_FILTER_REFUSED and select-all silently resolves
    // nothing — invisible while the builder was mocked.
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "teamMember=tm-1",
    });

    expect(blob(assetWhere())).not.toContain(CUSTODY_FILTER_REFUSED);
    expect(blob(assetWhere())).toContain("tm-1");
  });

  it("does not fall back to a request URL for filters", async () => {
    // The old shape took `request` and read `request.url`. Passing one now must
    // not resurrect that path — an unfiltered select-all is the data-loss case.
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
      // @ts-expect-error — deliberately passing the removed parameter
      request: new Request("http://localhost/locations/loc-1/assets?s=ignored"),
    });

    const where = blob(assetWhere());
    expect(where).toContain("laptop");
    expect(where).not.toContain("ignored");
  });
});

describe("resolveLocationKitIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kitFindMany.mockResolvedValue([{ id: "k1" }]);
  });

  it("returns explicit ids untouched", async () => {
    const ids = await resolveLocationKitIds({
      ids: ["k1"],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    expect(ids).toEqual(["k1"]);
    expect(kitFindMany).not.toHaveBeenCalled();
  });

  it("applies the submitted search filter", async () => {
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    const where = kitWhere();
    expect(where.organizationId).toBe(ORG);
    expect(blob(where)).toContain("case");
  });

  it("still scopes to the location", async () => {
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    expect(kitWhere().locationId).toBe(LOC);
  });

  it("matches the list's custody semantics, not the kits index's", async () => {
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "teamMember=tm-1",
    });

    const where = blob(kitWhere());
    expect(where).toContain("tm-1");
    // The location list also counts custody held via a running booking, which
    // the kits-index builder knows nothing about.
    expect(where).toContain("ONGOING");
    expect(where).toContain("custodianUserId");
  });

  it("resolves the 'Without custody' filter instead of matching nothing", async () => {
    // This page's custodian dropdown offers "Without custody". Routed through
    // the kits-index builder it became `custodianId = "without-custody"` — an
    // id nobody holds — so select-all resolved zero kits and reported success
    // while the user was looking at rows.
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "teamMember=without-custody",
    });

    const where = kitWhere();
    expect(where.OR).toContainEqual({ custody: null });
    expect(blob(where)).not.toContain('"custodianId":"without-custody"');
  });

  it("accepts several custodians at once", async () => {
    // The list reads `teamMember` with getAll; a single-value read would drop
    // every custodian after the first.
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "teamMember=tm-1&teamMember=tm-2",
    });

    const where = blob(kitWhere());
    expect(where).toContain("tm-1");
    expect(where).toContain("tm-2");
  });
});
