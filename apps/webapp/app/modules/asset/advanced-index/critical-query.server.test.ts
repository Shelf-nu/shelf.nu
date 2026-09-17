// @vitest-environment node
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_DB_AVAILABLE, getFixtureDb } from "@tooling/fixture-db";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import {
  buildAdvancedAssetsQuery,
  buildSlimPagedAssetCTEs,
  generateWhereClause,
  parseSortingOptions,
} from "~/modules/asset/query.server";
import { ShelfError } from "~/utils/error";
import { getAdvancedAssetCriticalPage } from "./critical-query.server";

/**
 * Two layers of coverage, matching `hydrate-heavy.server.test.ts`:
 *
 * 1. Mocked SQL-shape tests (below): assert on the `Prisma.Sql` handed to a
 *    mocked `db.$queryRaw` — no database required. These catch a regression
 *    in the query TEXT (a dropped `@map` alias, a missing `to_char` wrap, the
 *    wrong sort key) but cannot prove the SQL actually runs.
 * 2. Real-DB smokes (bottom of the file): the same query against a real,
 *    read-only fixture database, skipped automatically when
 *    `FIXTURE_DATABASE_URL` isn't configured. This is the ONLY check in the
 *    repo that can catch a wrong column name or a dropped `@map` at the
 *    Postgres level — a mock returns whatever shape a test hands it and
 *    would never notice.
 */

type MockDb = { $queryRaw: ReturnType<typeof vi.fn> };

const dbMock = vi.hoisted<MockDb>(() => ({ $queryRaw: vi.fn() }));

// why: isolates the SQL-shape assertions from a real database — every mocked
// test below inspects the `Prisma.Sql` passed to `$queryRaw`, never its
// resolved value. `withPrismaRetry` is left real (not mocked): on a
// resolving mock it just awaits once, with no retry side effects to guard
// against.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
  dbMock.$queryRaw.mockResolvedValue([{ total_count: 0, items: [] }]);
});

/**
 * Builds the args {@link getAdvancedAssetCriticalPage} takes, matching the
 * service-layer call site's shape (`generateWhereClause` + `parseSortingOptions`).
 */
function makeArgs(overrides?: {
  organizationId?: string;
  sortBy?: string[];
  parsedFilters?: Filter[];
  search?: string | null;
}) {
  const organizationId = overrides?.organizationId ?? "org-1";
  const sortBy = overrides?.sortBy ?? [];
  const parsedFilters = overrides?.parsedFilters ?? [];
  const search = overrides?.search ?? null;
  const whereClause = generateWhereClause(
    organizationId,
    search,
    parsedFilters
  );
  const { orderByInner, customFieldSortings } = parseSortingOptions(sortBy);
  return {
    organizationId,
    whereClause,
    orderByInner,
    customFieldSortings,
    sortBy,
    parsedFilters,
    paginationClause: Prisma.sql`LIMIT ${100} OFFSET ${0}`,
  };
}

/**
 * Runs {@link getAdvancedAssetCriticalPage} against the mocked `$queryRaw`
 * and returns the raw SQL text it was called with, `?`-joined at each bind
 * param — the same convention `query.server.test.ts` uses for
 * `buildAdvancedAssetsQuery`.
 */
async function getBuiltSql(
  overrides?: Parameters<typeof makeArgs>[0]
): Promise<string> {
  await getAdvancedAssetCriticalPage(makeArgs(overrides));
  const sql = dbMock.$queryRaw.mock.calls.at(-1)?.[0] as Prisma.Sql;
  return sql.strings.join("?");
}

describe("getAdvancedAssetCriticalPage — SQL shape", () => {
  it("keeps the slim asset_query CTE free of the unconditional Category/AssetModel joins (those live only in the outer lean lateral)", async () => {
    // Isolate the shared slim phase (before `sorted_asset_query`), the same
    // technique query.server.test.ts uses to isolate buildAdvancedAssetsQuery's
    // cheap phase — the heavy/lean projection always joins Category/AssetModel
    // for the rendered row, so asserting on the full SQL would false-negative.
    const sql = await getBuiltSql();
    const cheap = sql.slice(0, sql.indexOf("sorted_asset_query"));

    expect(cheap).not.toContain(
      'LEFT JOIN public."Category" c ON a."categoryId" = c.id'
    );
    expect(cheap).not.toContain(
      'LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id'
    );
  });

  it("selects a.value (never a.valuation) aliased as the 'valuation' JSON key — respects the @map column", async () => {
    const sql = await getBuiltSql();

    expect(sql).toContain("'valuation', a.value");
    expect(sql).not.toContain("a.valuation");
  });

  it('orders the aggregated items by saq."__sortRank"', async () => {
    const sql = await getBuiltSql();

    expect(sql).toContain(
      'json_agg(aq.critical_row ORDER BY saq."__sortRank")'
    );
  });

  it("wraps createdAt/updatedAt/mainImageExpiration in the same UTC to_char mask as the legacy query", async () => {
    const sql = await getBuiltSql();
    const UTC_ISO_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

    for (const [jsonKey, column] of [
      ["createdAt", 'a."createdAt"'],
      ["updatedAt", 'a."updatedAt"'],
      ["mainImageExpiration", 'a."mainImageExpiration"'],
    ] as const) {
      expect(sql).toContain(
        `'${jsonKey}', to_char(${column}, ${UTC_ISO_FORMAT})`
      );
    }
  });

  it("survives an empty page via COALESCE(..., '[]'::jsonb), never a null row", async () => {
    const sql = await getBuiltSql();

    expect(sql).toContain(
      "COALESCE(json_agg(aq.critical_row ORDER BY saq.\"__sortRank\"), '[]'::jsonb)"
    );
  });

  it("selects NO heavy relations (custody/bookings/tags/locations/customFields/reminders)", async () => {
    const sql = await getBuiltSql();

    for (const heavyTable of [
      '"Custody"',
      '"BookingAsset"',
      '"_AssetToTag"',
      '"AssetLocation"',
      '"AssetCustomFieldValue"',
      '"AssetReminder"',
    ]) {
      expect(sql).not.toContain(heavyTable);
    }
  });

  it("throws a ShelfError if the query unexpectedly returns zero rows", async () => {
    dbMock.$queryRaw.mockReset();
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    await expect(getAdvancedAssetCriticalPage(makeArgs())).rejects.toThrow(
      ShelfError
    );
  });
});

describe("extraction: buildSlimPagedAssetCTEs / buildAdvancedAssetsQuery share one slim phase", () => {
  /** Joins the raw SQL segments; interpolated values render as `?`. */
  function sqlText(sql: Prisma.Sql): string {
    return sql.strings.join("?");
  }

  it("buildAdvancedAssetsQuery's generated SQL begins with buildSlimPagedAssetCTEs' output, verbatim", () => {
    // Regression guard for the Step-1 extraction: buildAdvancedAssetsQuery
    // must COMPOSE buildSlimPagedAssetCTEs rather than keep its own copy of
    // the slim phase. If a future edit duplicates or diverges the two, this
    // fails — the controller's byte-identity diff against the pre-refactor
    // baseline is the complementary check for the one-time extraction itself.
    const whereClause = generateWhereClause("org-1", null, []);
    const { orderByInner, customFieldSortings } = parseSortingOptions([]);
    const sortBy: string[] = [];
    const parsedFilters: Filter[] = [];
    const paginationClause = Prisma.sql`LIMIT ${100} OFFSET ${0}`;

    const slimSql = sqlText(
      buildSlimPagedAssetCTEs({
        whereClause,
        orderByInner,
        customFieldSortings,
        sortBy,
        parsedFilters,
        paginationClause,
      })
    );

    const fullSql = sqlText(
      buildAdvancedAssetsQuery({
        whereClause,
        orderByInner,
        customFieldSortings,
        sortBy,
        parsedFilters,
        withBookings: false,
        withBarcodes: false,
        paginationClause,
      })
    );

    expect(fullSql.startsWith(slimSql)).toBe(true);
    // The three CTE headers must still be present post-extraction (cheap
    // structural check; the controller's diff covers exact byte-identity).
    expect(fullSql).toContain("WITH asset_query AS");
    expect(fullSql).toContain("sorted_asset_query AS");
    expect(fullSql).toContain("count_query AS");
    expect(fullSql).toContain("LEFT JOIN LATERAL");
  });
});

describe("real-DB smokes", () => {
  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "returns a page whose ids/order match a separately-run slim query, with correctly typed valuation/timestamps",
    async () => {
      const fixtureDb = getFixtureDb();
      const sample = await fixtureDb.asset.findFirst({
        select: { organizationId: true },
      });
      if (!sample) return;

      const args = makeArgs({ organizationId: sample.organizationId });

      const page = await getAdvancedAssetCriticalPage({
        ...args,
        client: fixtureDb,
      });

      expect(page.items.length).toBeLessThanOrEqual(100);
      expect(page.total_count).toBeGreaterThanOrEqual(page.items.length);

      // Independently re-derive the same page's ordered ids straight off the
      // shared slim CTEs, and assert the critical query's items match both
      // the ids AND the order — proving the two share one paging phase.
      const slimRows = await fixtureDb.$queryRaw<{ assetId: string }[]>(
        Prisma.sql`${buildSlimPagedAssetCTEs(args)}
          SELECT "assetId" FROM sorted_asset_query ORDER BY "__sortRank"`
      );
      expect(page.items.map((item) => item.id)).toEqual(
        slimRows.map((row) => row.assetId)
      );

      for (const item of page.items) {
        expect(typeof item.createdAt).toBe("string");
        expect(typeof item.updatedAt).toBe("string");
        // A wrong `a.valuation` column name would throw before this line is
        // ever reached — that is the point of this assertion.
        expect(
          item.valuation === null || typeof item.valuation === "number"
        ).toBe(true);
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "returns an empty page (never a null row) when the WHERE clause excludes every asset",
    async () => {
      const fixtureDb = getFixtureDb();
      const sample = await fixtureDb.asset.findFirst({
        select: { organizationId: true },
      });
      if (!sample) return;

      const args = makeArgs({ organizationId: sample.organizationId });
      // Stays org-scoped (the caller-built whereClause already is) while
      // excluding every row, exercising the COALESCE(..., '[]') path.
      const excludeAllWhereClause = Prisma.sql`${args.whereClause} AND 1 = 0`;

      const page = await getAdvancedAssetCriticalPage({
        ...args,
        whereClause: excludeAllWhereClause,
        client: fixtureDb,
      });

      expect(page).toEqual({ total_count: 0, items: [] });
    }
  );
});
