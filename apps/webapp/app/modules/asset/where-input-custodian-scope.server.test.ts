/**
 * Custodian scoping inside the "select all" where-builders.
 *
 * `getAssetsWhereInput` / `getKitsWhereInput` turn a serialized query string
 * into a Prisma filter for bulk / select-all operations. `?teamMember=` rides
 * in on that string as raw request input, so a caller who may not see other
 * people's custody must not be able to aim it at a colleague.
 *
 * This was live: `/api/assets/get-assets-for-bulk-qr-download` is reachable
 * with `qr: read` (held by BASE and SELF_SERVICE), and
 * `?assetIds=all-selected&teamMember=<colleague>` returned exactly the assets
 * that colleague held — an enumeration oracle that ignored
 * `baseUserCanSeeCustody` completely.
 *
 * The tests assert on the CLAUSE, not on row counts, because the failure mode
 * that shipped was a filter that silently widened rather than one that errored.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./../kit/utils.server.ts}
 */
import { describe, expect, it, vi } from "vitest";

// why: both where-builders are pure, but their module graph reaches
// `db.server`, which opens a real Prisma connection on import and leaves an
// unhandled rejection in the suite. Nothing here queries.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";
import { getAssetsWhereInput } from "./utils.server";
import { getKitsWhereInput } from "../kit/utils.server";

const ORG = "org-1";
const MINE = "tm-mine";
const COLLEAGUE = "tm-colleague";

/** Every id the asset custody clause ended up matching on. */
function custodianIdsInAssetWhere(
  where: ReturnType<typeof getAssetsWhereInput>
): string[] {
  const ids = new Set<string>();

  for (const clause of where.OR ?? []) {
    const custodyIds = clause.custody?.some?.teamMemberId;
    if (custodyIds && typeof custodyIds === "object" && "in" in custodyIds) {
      (custodyIds.in as string[]).forEach((id) => ids.add(id));
    }
  }

  return [...ids];
}

describe("getAssetsWhereInput custodian scoping", () => {
  it("keeps the requested custodian when the caller may see all custody", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${COLLEAGUE}`,
      allowedTeamMemberIds: "all",
    });

    expect(custodianIdsInAssetWhere(where)).toEqual([COLLEAGUE]);
  });

  it("refuses a colleague's id rather than dropping the filter", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${COLLEAGUE}`,
      allowedTeamMemberIds: [MINE],
    });

    // The bug this pins: with the clause dropped, `where` is just
    // `{ organizationId }` — every asset in the workspace, returned as though
    // the filter had been applied.
    expect(custodianIdsInAssetWhere(where)).toEqual([CUSTODY_FILTER_REFUSED]);
  });

  it("keeps the caller's own id from a mixed request", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${COLLEAGUE}&teamMember=${MINE}`,
      allowedTeamMemberIds: [MINE],
    });

    expect(custodianIdsInAssetWhere(where)).toEqual([MINE]);
  });

  it("adds no custody clause when no custodian was requested", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: "status=AVAILABLE",
      allowedTeamMemberIds: [MINE],
    });

    // An empty allow-list must not turn an unfiltered query into a refused one.
    expect(custodianIdsInAssetWhere(where)).toEqual([]);
  });
});

describe("getKitsWhereInput custodian scoping", () => {
  it("keeps the requested custodian when the caller may see all custody", () => {
    const where = getKitsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${COLLEAGUE}`,
      allowedTeamMemberIds: "all",
    });

    expect(where.custody).toEqual({ custodianId: COLLEAGUE });
  });

  it("refuses a colleague's id rather than dropping the filter", () => {
    const where = getKitsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${COLLEAGUE}`,
      allowedTeamMemberIds: [MINE],
    });

    expect(where.custody).toEqual({ custodianId: CUSTODY_FILTER_REFUSED });
  });

  it("keeps the caller's own id", () => {
    const where = getKitsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${MINE}`,
      allowedTeamMemberIds: [MINE],
    });

    expect(where.custody).toEqual({ custodianId: MINE });
  });

  it("adds no custody clause when no custodian was requested", () => {
    const where = getKitsWhereInput({
      organizationId: ORG,
      currentSearchParams: "status=AVAILABLE",
      allowedTeamMemberIds: [MINE],
    });

    expect(where.custody).toBeUndefined();
  });
});

describe("getAssetsWhereInput — a refusal survives sibling OR filters", () => {
  /** Does the clause contain a top-level predicate nothing can satisfy? */
  function hasUnsatisfiablePredicate(
    where: ReturnType<typeof getAssetsWhereInput>
  ): boolean {
    const and = Array.isArray(where.AND)
      ? where.AND
      : where.AND
      ? [where.AND]
      : [];
    return and.some(
      (clause) =>
        typeof clause === "object" &&
        clause !== null &&
        (clause as { id?: unknown }).id === CUSTODY_FILTER_REFUSED
    );
  }

  // The three other filters that write to `where.OR`. Each one used to rescue
  // a refused custodian filter: under OR semantics the refused branch matched
  // nothing while the sibling matched plenty, so the query returned the
  // sibling's rows instead of none.
  const siblingOrFilters = [
    ["uncategorized", `category=uncategorized`],
    ["untagged", `tag=untagged`],
    ["without-location", `location=without-location`],
  ] as const;

  it.each(siblingOrFilters)(
    "refuses even when combined with the %s filter",
    (_label, queryString) => {
      const where = getAssetsWhereInput({
        organizationId: ORG,
        currentSearchParams: `teamMember=${COLLEAGUE}&${queryString}`,
        allowedTeamMemberIds: [MINE],
      });

      expect(hasUnsatisfiablePredicate(where)).toBe(true);
    }
  );

  it("adds no unsatisfiable predicate when the filter was NOT refused", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: `teamMember=${MINE}&category=uncategorized`,
      allowedTeamMemberIds: [MINE],
    });

    // Over-applying this would silently return nothing for a legitimate
    // combined filter.
    expect(hasUnsatisfiablePredicate(where)).toBe(false);
  });

  it("adds no unsatisfiable predicate when no custodian was requested", () => {
    const where = getAssetsWhereInput({
      organizationId: ORG,
      currentSearchParams: "category=uncategorized",
      allowedTeamMemberIds: [MINE],
    });

    expect(hasUnsatisfiablePredicate(where)).toBe(false);
  });
});
