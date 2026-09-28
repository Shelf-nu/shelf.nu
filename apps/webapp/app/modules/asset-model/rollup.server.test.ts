import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import type { AssetModelRollupSortKey } from "./rollup.server";
import type { GetAssetModelRollupArgs } from "./rollup.server";
import {
  ASSET_MODEL_ROLLUP_SORT_KEYS,
  getAssetModelRollup,
} from "./rollup.server";

// why: isolating the SQL assembly from a real database — these tests assert
// the query text, which is the only thing typecheck cannot verify for raw SQL.
vitest.mock("~/database/db.server", () => ({
  db: { $queryRaw: vitest.fn() },
}));

// why: the retry wrapper only adds backoff behaviour; running the callback
// directly keeps the assertions about the query, not the retry policy.
vitest.mock("@shelf/database", () => ({
  withPrismaRetry: (fn: () => unknown) => fn(),
}));

/** Captures the `Prisma.Sql` handed to `$queryRaw` on the last call. */
function lastQuery(): { strings: string[]; values: unknown[] } {
  const mock = vitest.mocked(db.$queryRaw);
  // `$queryRaw`'s overloads type the first argument as
  // `TemplateStringsArray | Sql`; this narrows it to the `Sql` shape the
  // assertions read. Via `unknown` because the two do not structurally overlap.
  const [query] = mock.mock.calls[mock.mock.calls.length - 1] as unknown as [
    { strings: string[]; values: unknown[] },
  ];
  return query;
}

/**
 * The last query's SQL text.
 *
 * A nested `Prisma.sql` fragment flattens into the parent's `strings` array,
 * with a bound value sitting between two neighbouring runs of text. Joining on
 * a space reconstructs the statement with every parameter standing as
 * whitespace, so an assertion has to stay inside ONE static run: a substring
 * that spans a parameter is not in this string at any spacing.
 */
function lastQueryText(): string {
  return lastQuery().strings.join(" ");
}

const baseArgs = {
  organizationId: "org-1",
  search: null,
  filters: [],
  page: 1,
  perPage: 20,
};

describe("getAssetModelRollup", () => {
  beforeEach(() => {
    vitest.mocked(db.$queryRaw).mockReset();
    vitest.mocked(db.$queryRaw).mockResolvedValue([]);
  });

  it("sums the mapped `value` column, never the Prisma field name", async () => {
    await getAssetModelRollup(baseArgs);

    const sql = lastQueryText();
    expect(sql).toContain("a.value");
    expect(sql).not.toContain("a.valuation");
  });

  it("restricts the rollup to INDIVIDUAL assets", async () => {
    await getAssetModelRollup(baseArgs);

    expect(lastQueryText()).toContain(`a.type = 'INDIVIDUAL'`);
  });

  it("pins the no-model bucket last for every sort key", async () => {
    for (const sortBy of ASSET_MODEL_ROLLUP_SORT_KEYS) {
      await getAssetModelRollup({ ...baseArgs, sortBy });

      expect(lastQueryText()).toContain("ORDER BY (am.id IS NULL) ASC");
    }
  });

  it("falls back to name ordering for a sort key outside the whitelist", async () => {
    // A value that only reaches this function via a cast — `Object.prototype`
    // supplies a `constructor` on any plain lookup object, so a naive
    // `SORT_EXPRESSIONS[sortBy] ?? SORT_EXPRESSIONS.name` never falls through
    // for it even though it is not a real sort key.
    await getAssetModelRollup({
      ...baseArgs,
      sortBy: "constructor" as AssetModelRollupSortKey,
    });

    expect(lastQueryText()).toContain(
      "ORDER BY (am.id IS NULL) ASC, am.name ASC NULLS LAST, am.id ASC"
    );
  });

  it("maps a returned row onto the rollup shape", async () => {
    vitest.mocked(db.$queryRaw).mockResolvedValue([
      {
        assetModelId: "am-1",
        name: "MacBook Pro 16",
        description: null,
        image: null,
        thumbnailImage: null,
        defaultCategoryId: "cat-1",
        defaultCategoryName: "Laptops",
        defaultCategoryColor: "#3B82F6",
        matchingAssets: 20,
        available: 14,
        checkedOut: 4,
        inCustody: 2,
        notBookable: 1,
        totalValue: 48000,
        totalModels: 3,
        totalRollupAssets: 34,
      },
    ]);

    const result = await getAssetModelRollup(baseArgs);

    expect(result.totalModels).toBe(3);
    expect(result.totalRollupAssets).toBe(34);
    expect(result.rows[0]).toMatchObject({
      assetModelId: "am-1",
      matchingAssets: 20,
      available: 14,
    });
  });

  it("joins the custody aggregation when a custody filter is active", async () => {
    // why: custody predicates test `jsonb_array_length(custody_agg.custody)`,
    // an alias from a LATERAL join rather than a self-contained subquery — a
    // missing FROM-clause error rather than a wrong result.
    await getAssetModelRollup({
      ...baseArgs,
      filters: [
        {
          name: "custody",
          type: "enum",
          operator: "is",
          value: "in-custody",
        },
      ] as unknown as GetAssetModelRollupArgs["filters"],
    });

    // The alias declaration, not a bare "custody_agg": the custody WHERE
    // predicate emits `jsonb_array_length(custody_agg.custody)` whether or not
    // the join was added, so the looser substring passes even when the join is
    // missing — which is precisely the 500 this test exists to catch.
    expect(lastQueryText()).toContain(") custody_agg ON TRUE");
  });

  it("omits the custody aggregation when no custody filter is active", async () => {
    await getAssetModelRollup(baseArgs);

    expect(lastQueryText()).not.toContain("custody_agg");
  });

  it("counts the no-model bucket as a row for pagination but not as a model", async () => {
    vitest.mocked(db.$queryRaw).mockResolvedValue([
      {
        assetModelId: null,
        name: null,
        description: null,
        image: null,
        thumbnailImage: null,
        defaultCategoryId: null,
        defaultCategoryName: null,
        defaultCategoryColor: null,
        matchingAssets: 25,
        available: 25,
        checkedOut: 0,
        inCustody: 0,
        notBookable: 0,
        totalValue: 0,
        totalModels: 20,
        totalGroups: 21,
        totalRollupAssets: 145,
      },
    ]);

    const result = await getAssetModelRollup(baseArgs);

    // The header's label and the pagination total answer different questions.
    expect(result.totalModels).toBe(20);
    expect(result.totalGroups).toBe(21);
  });

  it("keeps both sides of the join, so neither empty models nor the bucket are lost", async () => {
    await getAssetModelRollup(baseArgs);

    const sql = lastQueryText();

    expect(sql).toContain("FULL OUTER JOIN");
    // The closing paren, not a bare `am ON`: a plain `LEFT JOIN … am ON …`
    // contains that substring too, so the looser form passes against exactly
    // the query this shape replaces.
    expect(sql).toContain(`) am ON a."assetModelId" = am.id`);
    // The asset predicates must sit on the asset side, ahead of the join. In an
    // outer WHERE they are NULL for the row an unmatched model contributes and
    // would discard it, which is the whole bug.
    expect(sql.indexOf(`WHERE a."organizationId" =`)).toBeLessThan(
      sql.indexOf("FULL OUTER JOIN")
    );
  });

  it("counts assets, not joined rows, so a model with no matches reports zero", async () => {
    await getAssetModelRollup(baseArgs);

    const sql = lastQueryText();

    // The join emits one all-NULL asset row per unmatched model, which COUNT(*)
    // would report as one asset.
    expect(sql).toMatch(/COUNT\(a\.id\)::int\s+AS "matchingAssets"/);
    expect(sql).not.toContain("COUNT(*)::int");
  });

  it("sums per-group asset counts for the header total", async () => {
    await getAssetModelRollup(baseArgs);

    const sql = lastQueryText();

    expect(sql).toMatch(
      /SUM\(COUNT\(a\.id\)\) OVER \(\)::int\s+AS "totalRollupAssets"/
    );
    // An empty model's group must add 0 assets, not 1.
    expect(sql).not.toContain("SUM(COUNT(*))");
  });

  it("counts models by group, so the header's model count is not asset-weighted", async () => {
    await getAssetModelRollup(baseArgs);

    // The two window counts stay COUNT(*) on purpose: a window aggregate runs
    // over the GROUPED rows, so `*` is one model (or the bucket), not an asset.
    // Sweeping them to COUNT(a.id) alongside the row-level counts would report
    // assets where the header states models.
    expect(lastQueryText()).toMatch(
      /COUNT\(\*\) FILTER \(WHERE am\.id IS NOT NULL\) OVER \(\)::int\s+AS "totalModels"/
    );
  });

  it("scopes models to the workspace independently of the asset predicates", async () => {
    await getAssetModelRollup(baseArgs);

    const { strings, values } = lastQuery();

    // The asset predicates carry an organizationId for ASSETS and say nothing
    // about which models exist, so the model side needs its own scope or
    // another workspace's models become rows.
    expect(strings.join(" ")).toMatch(
      /FROM public\."AssetModel" am\s+WHERE am\."organizationId" =/
    );
    // Bound twice, once per side, rather than interpolated.
    expect(
      values.filter((value) => value === "org-1").length
    ).toBeGreaterThanOrEqual(2);
  });

  it("groups by every projected model column", async () => {
    await getAssetModelRollup(baseArgs);

    // Postgres infers a functional dependency from a grouped key only when it
    // is a base table's primary key. The models arrive from a subquery, so
    // `GROUP BY am.id` alone is a "column am.name must appear in the GROUP BY
    // clause" error at runtime, which no typecheck or mocked test can see.
    expect(lastQueryText()).toMatch(
      /GROUP BY am\.id, am\.name, am\.description, am\.image, am\."thumbnailImage",\s+am\."defaultCategoryId", cat\.id/
    );
  });

  it("returns a model with no matching assets as a zero row", async () => {
    vitest.mocked(db.$queryRaw).mockResolvedValue([
      {
        assetModelId: "am-empty",
        name: "Just created",
        description: null,
        image: null,
        thumbnailImage: null,
        defaultCategoryId: null,
        defaultCategoryName: null,
        defaultCategoryColor: null,
        matchingAssets: 0,
        available: 0,
        checkedOut: 0,
        inCustody: 0,
        notBookable: 0,
        totalValue: 0,
        totalModels: 3,
        totalGroups: 3,
        totalRollupAssets: 0,
      },
    ]);

    const result = await getAssetModelRollup(baseArgs);

    // A zero row is a row. Nothing on the way out may drop it, or the view goes
    // back to reading "0 models" in a workspace that has three.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      assetModelId: "am-empty",
      matchingAssets: 0,
      totalValue: 0,
    });
    expect(result.totalModels).toBe(3);
  });

  it("reports zero totals for an empty result rather than NaN", async () => {
    vitest.mocked(db.$queryRaw).mockResolvedValue([]);

    const result = await getAssetModelRollup(baseArgs);

    expect(result).toMatchObject({
      rows: [],
      totalModels: 0,
      totalRollupAssets: 0,
    });
    // Page 1 of a genuinely empty result never needs the fallback totals
    // query — only one round trip for the common "no matches" case.
    expect(vitest.mocked(db.$queryRaw)).toHaveBeenCalledTimes(1);
  });

  it("recovers the true totals when a page lands past the last row", async () => {
    // The primary paged query comes back empty (offset beyond the last
    // model), but the filtered set is NOT actually empty — the fallback
    // totals query is the second call and supplies the real counts.
    vitest
      .mocked(db.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ totalModels: 25, totalRollupAssets: 500 }]);

    const result = await getAssetModelRollup({
      ...baseArgs,
      page: 3,
      perPage: 20,
    });

    expect(result).toMatchObject({
      rows: [],
      totalModels: 25,
      totalRollupAssets: 500,
    });
    expect(vitest.mocked(db.$queryRaw)).toHaveBeenCalledTimes(2);
  });

  it("computes the fallback totals over the same both-sided join", async () => {
    vitest
      .mocked(db.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { totalModels: 25, totalGroups: 26, totalRollupAssets: 500 },
      ]);

    await getAssetModelRollup({ ...baseArgs, page: 3, perPage: 20 });

    // The fallback answers the same three questions as the primary query's
    // window aggregates, so it has to read the same set: every model in the
    // workspace, and assets counted as assets.
    const sql = lastQueryText();
    expect(sql).toContain("FULL OUTER JOIN");
    expect(sql).toMatch(
      /FROM public\."AssetModel" am\s+WHERE am\."organizationId" =/
    );
    expect(sql).toMatch(/COUNT\(a\.id\)::int\s+AS "totalRollupAssets"/);
    // Unpaged by construction: these totals describe the whole filtered set,
    // which is the only reason to run a second query.
    expect(sql).not.toContain("LIMIT");
  });
});
