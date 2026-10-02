/**
 * Asset Model Rollup
 *
 * Aggregates the asset index's current filtered result set by asset model, so
 * the index can answer "which models do I have, and how many of each, within
 * the slice I am looking at" rather than listing assets one by one.
 *
 * Every model in the workspace gets a row, including a model no asset in the
 * filtered slice matches: it reports zeros. This view is where someone goes to
 * start grouping, so a model with nothing under it yet has to be visible here,
 * and the filters narrow the counts on a row rather than the set of rows.
 *
 * The filtering is not reimplemented here: this reuses
 * {@link generateWhereClause}, the same builder the advanced asset list uses,
 * and changes only the projection. Every advanced filter, custom-field filter
 * and search term therefore applies unchanged.
 *
 * Scope: `INDIVIDUAL` assets only. A model is an INDIVIDUAL-only concept —
 * `createAsset` / `updateAsset` reject a model on a `QUANTITY_TRACKED` asset —
 * so including QT rows would only ever add them to the no-model bucket.
 *
 * @see {@link file://./../asset/query.server.ts} — the shared WHERE builder
 * @see {@link file://./../../routes/_layout+/assets._index.tsx} — consumer
 */

import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { CUSTODY_AGG_JOIN, generateWhereClause } from "../asset/query.server";

/** Sort keys the model view offers. Deliberately separate from the asset
 * index's `sortBy`, whose keys name asset columns a model row does not have. */
export const ASSET_MODEL_ROLLUP_SORT_KEYS = [
  "name",
  "assets",
  "available",
  "value",
] as const;

export type AssetModelRollupSortKey =
  (typeof ASSET_MODEL_ROLLUP_SORT_KEYS)[number];

/**
 * One row of the rollup.
 *
 * `assetModelId` is `null` for the synthetic "No model" bucket - assets that
 * matched the filters but have no model assigned. That bucket is always sorted
 * last and is excluded from `totalModels`. Unlike a model, the bucket only
 * exists when at least one asset falls into it.
 *
 * A model no asset matched is a real row with every count at `0`, not an
 * omission. Nothing downstream may treat `matchingAssets === 0` as a reason to
 * drop the row: hiding it is the thing this shape exists to prevent.
 *
 * The three status counts are exhaustive: `AssetStatus` has exactly three
 * values, so `available + checkedOut + inCustody === matchingAssets`.
 * `notBookable` is NOT part of that partition — `availableToBook` is an
 * independent "never bookable" flag that overlaps all three, so it must be
 * rendered as its own signal and never added into a total.
 */
export type AssetModelRollupRow = {
  assetModelId: string | null;
  name: string | null;
  description: string | null;
  image: string | null;
  thumbnailImage: string | null;
  defaultCategoryId: string | null;
  defaultCategoryName: string | null;
  defaultCategoryColor: string | null;
  matchingAssets: number;
  available: number;
  checkedOut: number;
  inCustody: number;
  notBookable: number;
  totalValue: number;
};

/** Raw row shape: the rollup columns plus the two window totals, which
 * Postgres repeats on every row. */
type AssetModelRollupQueryRow = AssetModelRollupRow & {
  totalModels: number;
  totalGroups: number;
  totalRollupAssets: number;
};

/**
 * The joins a rollup query needs beyond its own three tables.
 *
 * Custody WHERE predicates test `jsonb_array_length(custody_agg.custody)`, an
 * alias that lives in a LATERAL join rather than a self-contained subquery, so
 * a custody filter without this join is a "missing FROM-clause entry" error
 * rather than a wrong result. Added only when such a filter is present: the
 * aggregation runs per asset row and is pure cost when nothing reads it.
 *
 * @param filters - Parsed filters for this request.
 * @returns The join fragment, or `Prisma.empty` when no custody filter applies.
 */
function buildRollupFilterJoins(filters: Filter[]): Prisma.Sql {
  const hasCustodyFilter = filters.some((filter) => filter.name === "custody");

  return hasCustodyFilter ? CUSTODY_AGG_JOIN : Prisma.empty;
}

/** Sort expression per key. A whitelist, not interpolation: the key comes
 * from a URL param and must never reach `Prisma.raw` unvalidated.
 *
 * The counts are `COUNT(a.id)`, never `COUNT(*)`. A model no asset matched
 * contributes a row whose asset columns are all NULL (see
 * {@link buildRollupFrom}), and `COUNT(*)` counts that row, which would order
 * an empty model as if it held one asset. */
const SORT_EXPRESSIONS: Record<AssetModelRollupSortKey, string> = {
  name: "am.name",
  assets: "COUNT(a.id)",
  available: `COUNT(a.id) FILTER (WHERE a.status = 'AVAILABLE')`,
  value: "COALESCE(SUM(COALESCE(a.value, 0)), 0)",
};

/**
 * The rollup's `FROM` clause: every model in the workspace, joined against the
 * filtered asset set.
 *
 * Neither side can drive the query on its own. Assets driving it is what hides
 * a model nothing matched, since that model has no asset row to hang from;
 * models driving it drops the "No model" bucket, since those assets have no
 * model row to hang from. A `FULL OUTER JOIN` preserves both in one pass,
 * which also lets the paged query and the totals query share this fragment
 * instead of describing the same set two ways.
 *
 * **The asset predicates belong to the asset side only.** They are NULL for
 * the row an unmatched model contributes, so an outer `WHERE` would discard
 * exactly the rows this shape exists to produce. Keeping them inside the
 * subquery is also what makes them resolvable: there `a` is the `Asset` table,
 * so every column {@link generateWhereClause} reaches for is in scope, and so
 * is the `custody_agg` alias `filterJoins` introduces.
 *
 * **Models are scoped to the organization on their own side.** The asset
 * predicates say nothing about which models exist, and a single-table
 * predicate in the join's `ON` would not help either: a `FULL OUTER JOIN`
 * keeps unpaired rows from both sides, so another workspace's models would
 * still come back as rows, merely never paired with an asset.
 *
 * Both derived tables keep the alias of the table they read, so a projection,
 * a `FILTER` predicate and a sort expression spell a column the same way
 * whether it comes from the table or from the derived row.
 *
 * @param args.organizationId - Workspace whose models are listed.
 * @param args.whereClause - `generateWhereClause` output, applied to assets.
 * @param args.filterJoins - The joins those predicates need in scope.
 * @returns The `FROM` clause, exposing `a` (filtered assets) and `am` (models).
 */
function buildRollupFrom({
  organizationId,
  whereClause,
  filterJoins,
}: {
  organizationId: string;
  whereClause: Prisma.Sql;
  filterJoins: Prisma.Sql;
}): Prisma.Sql {
  return Prisma.sql`
      FROM (
        SELECT a.id, a."assetModelId", a.status, a."availableToBook", a.value
        FROM public."Asset" a
        ${filterJoins}
        ${whereClause}
          AND a.type = 'INDIVIDUAL'
      ) a
      FULL OUTER JOIN (
        SELECT am.id, am.name, am.description, am.image, am."thumbnailImage",
               am."defaultCategoryId"
        FROM public."AssetModel" am
        WHERE am."organizationId" = ${organizationId}
      ) am ON a."assetModelId" = am.id`;
}

/** The two unpaged totals the rollup header needs, independent of which page
 * is being viewed. */
type AssetModelRollupTotals = {
  /** Every model in the workspace: filters narrow the counts on a row, never
   * the set of rows. Excludes the no-model bucket, which is not a model. */
  totalModels: number;
  /** Rows the list renders: models, plus the no-model bucket when non-empty.
   * Pagination must cover this, not `totalModels`. */
  totalGroups: number;
  totalRollupAssets: number;
};

/**
 * Recomputes {@link AssetModelRollupTotals} for the filtered set without
 * `LIMIT`/`OFFSET`.
 *
 * The primary query's window totals live on the rows `LIMIT`/`OFFSET`
 * returns, so a page that comes back empty carries no window value to read.
 * That is ambiguous on its own — it can mean the filtered set is genuinely
 * empty, or that the requested page lands past the last row of a non-empty
 * set (a bookmarked deep page, or a filter tightened after the page number
 * was set) — so the caller runs this only once it has ruled out the first
 * case via `skip > 0`.
 *
 * Reads the same `FROM` clause as the primary query ({@link buildRollupFrom}),
 * so the two cannot come to describe different sets.
 *
 * @param organizationId - Workspace whose models are counted.
 * @param whereClause - The same `generateWhereClause` output the primary
 *   query used, so the totals describe the identical filtered set.
 * @param filterJoins - The same joins the primary query used, so a custody
 *   filter resolves here too.
 * @returns The filtered set's totals, `0` for each when there are no rows.
 */
async function getAssetModelRollupTotals(
  organizationId: string,
  whereClause: Prisma.Sql,
  filterJoins: Prisma.Sql
): Promise<AssetModelRollupTotals> {
  const query = Prisma.sql`
    SELECT
      -- COUNT(DISTINCT) skips NULL, so this excludes the no-model bucket
      -- without a FILTER. It counts models with no matching asset, which the
      -- join contributes a row for.
      COUNT(DISTINCT am.id)::int                                   AS "totalModels",
      -- Rows the list renders: every model, plus the no-model bucket when it
      -- has any assets. Separate from 'totalModels' because that one answers
      -- the header's "N models", which a bucket is not.
      (
        COUNT(DISTINCT am.id)
        + (CASE WHEN COUNT(a.id) FILTER (WHERE am.id IS NULL) > 0 THEN 1 ELSE 0 END)
      )::int                                                       AS "totalGroups",
      -- COUNT(a.id), never COUNT(*): a model with no matching asset carries no
      -- asset on its row, and COUNT(*) would add that row to the asset total.
      COUNT(a.id)::int                                             AS "totalRollupAssets"
    ${buildRollupFrom({ organizationId, whereClause, filterJoins })}
  `;

  const result = await withPrismaRetry(
    () => db.$queryRaw<AssetModelRollupTotals[]>(query),
    { operationIsRead: true }
  );

  const [totals] = result;

  return {
    totalModels: totals?.totalModels ?? 0,
    totalGroups: totals?.totalGroups ?? 0,
    totalRollupAssets: totals?.totalRollupAssets ?? 0,
  };
}

export type GetAssetModelRollupArgs = {
  organizationId: string;
  /** Free-text search, already extracted from the request params. */
  search: string | null;
  /** Parsed advanced filters — pass the loader's `parsedFilters` so the
   * hierarchy expansion is not redone. */
  filters: Filter[];
  /** IANA timezone, threaded into `generateWhereClause` so date-column filters
   * truncate the day in the acting user's zone. */
  timeZone?: string;
  page: number;
  /** Rows per page. Clamped to the range 1-100: a value above 100 silently
   * returns at most 100 rows rather than erroring, so a caller comparing the
   * row count against the requested `perPage` should expect the clamp. */
  perPage: number;
  /** Restricts the rollup to assets the viewer may reserve. Mirrors the asset
   * list's own scoping, so a role that sees a narrowed list does not also see
   * counts computed over the wider set. */
  availableToBookOnly?: boolean;
  sortBy?: AssetModelRollupSortKey;
  sortDirection?: "asc" | "desc";
};

/**
 * Runs the rollup for one page of models.
 *
 * @param args - See {@link GetAssetModelRollupArgs}.
 * @returns The page's rows plus the unpaged totals the header needs.
 * @throws {ShelfError} When the query fails.
 */
export async function getAssetModelRollup({
  organizationId,
  search,
  filters,
  timeZone = "UTC",
  page,
  perPage,
  availableToBookOnly = false,
  sortBy = "name",
  sortDirection = "asc",
}: GetAssetModelRollupArgs): Promise<{
  rows: AssetModelRollupRow[];
  totalModels: number;
  totalGroups: number;
  totalRollupAssets: number;
}> {
  const take = Math.min(Math.max(perPage, 1), 100);
  const skip = page > 1 ? (page - 1) * take : 0;

  const filterJoins = buildRollupFilterJoins(filters);

  const whereClause = generateWhereClause(
    organizationId,
    search,
    filters,
    undefined,
    availableToBookOnly,
    timeZone
  );

  // Checked against the tuple, not a nullish-coalesce on the lookup: an
  // object literal answers `["constructor"]` / `["toString"]` /
  // `["__proto__"]` from `Object.prototype`, so those never fall through a
  // `?? SORT_EXPRESSIONS.name` guard even though they are not a real key.
  // `sortBy` is exported-function input, so it must be checked here rather
  // than trusted from a caller's own whitelist.
  const sortExpression = ASSET_MODEL_ROLLUP_SORT_KEYS.includes(sortBy)
    ? SORT_EXPRESSIONS[sortBy]
    : SORT_EXPRESSIONS.name;
  const direction = sortDirection === "desc" ? "DESC" : "ASC";

  // `(am.id IS NULL) ASC` pins the no-model bucket last: FALSE sorts before
  // TRUE, so real models come first under every sort key.
  const orderBy = Prisma.raw(
    `ORDER BY (am.id IS NULL) ASC, ${sortExpression} ${direction} NULLS LAST, am.id ASC`
  );

  try {
    const query = Prisma.sql`
      SELECT
        am.id                                                AS "assetModelId",
        am.name                                              AS "name",
        am.description                                       AS "description",
        am.image                                             AS "image",
        am."thumbnailImage"                                  AS "thumbnailImage",
        am."defaultCategoryId"                               AS "defaultCategoryId",
        cat.name                                             AS "defaultCategoryName",
        cat.color                                            AS "defaultCategoryColor",
        -- COUNT(a.id), never COUNT(*): a model with no matching asset still
        -- gets a row, whose asset columns are all NULL, and COUNT(*) would
        -- report that row as one asset. The FILTER counts reach 0 on their own
        -- (a NULL status matches no predicate) but stay COUNT(a.id) so the
        -- whole projection reads one way.
        COUNT(a.id)::int                                        AS "matchingAssets",
        COUNT(a.id) FILTER (WHERE a.status = 'AVAILABLE')::int   AS "available",
        COUNT(a.id) FILTER (WHERE a.status = 'CHECKED_OUT')::int AS "checkedOut",
        COUNT(a.id) FILTER (WHERE a.status = 'IN_CUSTODY')::int  AS "inCustody",
        COUNT(a.id) FILTER (WHERE a."availableToBook" = false)::int AS "notBookable",
        -- Asset.valuation is @map("value"); 'value' is the real column. No
        -- ::bigint cast: SUM over a float returns double precision and the
        -- cast would truncate fractional totals.
        COALESCE(SUM(COALESCE(a.value, 0)), 0)                  AS "totalValue",
        -- Window aggregates run after GROUP BY and before LIMIT, so these are
        -- the UNPAGED totals. COUNT(*) OVER () counts GROUPS rather than asset
        -- rows, which is what the two counts below want: one group per model,
        -- plus the bucket. The bucket is not a model, so it is excluded from
        -- the model count but not from the row count.
        COUNT(*) FILTER (WHERE am.id IS NOT NULL) OVER ()::int   AS "totalModels",
        -- Rows the list renders, which pagination must cover: the no-model
        -- bucket is one of them even though it is not a model.
        COUNT(*) OVER ()::int                                    AS "totalGroups",
        -- Assets, so it sums the per-group asset counts. An empty model's
        -- group adds 0 and cannot inflate the header's asset total.
        SUM(COUNT(a.id)) OVER ()::int                            AS "totalRollupAssets"
      ${buildRollupFrom({ organizationId, whereClause, filterJoins })}
      LEFT JOIN public."Category" cat ON am."defaultCategoryId" = cat.id
      -- Every projected model column is grouped, rather than am.id alone:
      -- Postgres infers a functional dependency from a grouped key only when
      -- it is a base table's primary key, which cat.id is and a derived
      -- table's am.id is not. Grouping by the extra columns changes nothing,
      -- since am.id determines all of them, and NULLs group together so the
      -- bucket stays one row.
      GROUP BY am.id, am.name, am.description, am.image, am."thumbnailImage",
               am."defaultCategoryId", cat.id
      ${orderBy}
      LIMIT ${take} OFFSET ${skip}
    `;

    // Pure read — safe to re-run mid-flight, which is what `operationIsRead`
    // declares to the retry wrapper.
    const result = await withPrismaRetry(
      () => db.$queryRaw<AssetModelRollupQueryRow[]>(query),
      { operationIsRead: true }
    );

    const [first] = result;

    // An empty page past the first one is ambiguous (see
    // `getAssetModelRollupTotals`'s doc comment) — recover the real totals
    // with a second, LIMIT-free aggregate rather than reporting a workspace
    // with matches as having none.
    const totals =
      result.length === 0 && skip > 0
        ? await getAssetModelRollupTotals(
            organizationId,
            whereClause,
            filterJoins
          )
        : {
            totalModels: first?.totalModels ?? 0,
            totalGroups: first?.totalGroups ?? 0,
            totalRollupAssets: first?.totalRollupAssets ?? 0,
          };

    return {
      rows: result.map(
        ({ totalModels: _m, totalGroups: _g, totalRollupAssets: _a, ...row }) =>
          row
      ),
      ...totals,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching asset models. Please try again or contact support.",
      additionalData: { organizationId, page, perPage, sortBy },
      label: "Assets",
    });
  }
}
