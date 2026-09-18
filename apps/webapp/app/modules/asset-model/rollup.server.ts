/**
 * Asset Model Rollup
 *
 * Aggregates the asset index's current filtered result set by asset model, so
 * the index can answer "which models do I have, and how many of each, within
 * the slice I am looking at" rather than listing assets one by one.
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
import { generateWhereClause } from "../asset/query.server";

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
 * `assetModelId` is `null` for the synthetic "No model" bucket — assets that
 * matched the filters but have no model assigned. That bucket is always sorted
 * last and is excluded from `totalModels`.
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
  totalRollupAssets: number;
};

/** Sort expression per key. A whitelist, not interpolation — the key comes
 * from a URL param and must never reach `Prisma.raw` unvalidated. */
const SORT_EXPRESSIONS: Record<AssetModelRollupSortKey, string> = {
  name: "am.name",
  assets: "COUNT(*)",
  available: `COUNT(*) FILTER (WHERE a.status = 'AVAILABLE')`,
  value: "COALESCE(SUM(COALESCE(a.value, 0)), 0)",
};

/** The two unpaged totals the rollup header needs, independent of which page
 * is being viewed. */
type AssetModelRollupTotals = {
  totalModels: number;
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
 * @param whereClause - The same `generateWhereClause` output the primary
 *   query used, so the totals describe the identical filtered set.
 * @returns The filtered set's totals, `0` for each when there are no rows.
 */
async function getAssetModelRollupTotals(
  whereClause: Prisma.Sql
): Promise<AssetModelRollupTotals> {
  const query = Prisma.sql`
    SELECT
      COUNT(DISTINCT am.id) FILTER (WHERE am.id IS NOT NULL)::int AS "totalModels",
      COUNT(*)::int                                                AS "totalRollupAssets"
    FROM public."Asset" a
    LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id
    ${whereClause}
      AND a.type = 'INDIVIDUAL'
  `;

  const result = await withPrismaRetry(
    () => db.$queryRaw<AssetModelRollupTotals[]>(query),
    { operationIsRead: true }
  );

  const [totals] = result;

  return {
    totalModels: totals?.totalModels ?? 0,
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
  sortBy = "name",
  sortDirection = "asc",
}: GetAssetModelRollupArgs): Promise<{
  rows: AssetModelRollupRow[];
  totalModels: number;
  totalRollupAssets: number;
}> {
  const take = Math.min(Math.max(perPage, 1), 100);
  const skip = page > 1 ? (page - 1) * take : 0;

  const whereClause = generateWhereClause(
    organizationId,
    search,
    filters,
    undefined,
    false,
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
        COUNT(*)::int                                        AS "matchingAssets",
        COUNT(*) FILTER (WHERE a.status = 'AVAILABLE')::int   AS "available",
        COUNT(*) FILTER (WHERE a.status = 'CHECKED_OUT')::int AS "checkedOut",
        COUNT(*) FILTER (WHERE a.status = 'IN_CUSTODY')::int  AS "inCustody",
        COUNT(*) FILTER (WHERE a."availableToBook" = false)::int AS "notBookable",
        -- Asset.valuation is @map("value"); 'value' is the real column. No
        -- ::bigint cast — SUM over a float returns double precision and the
        -- cast would truncate fractional totals.
        COALESCE(SUM(COALESCE(a.value, 0)), 0)               AS "totalValue",
        -- Window aggregates run after GROUP BY and before LIMIT, so these are
        -- the UNPAGED totals. The no-model bucket is not a model, so it is
        -- excluded from the model count but not from the asset count.
        COUNT(*) FILTER (WHERE am.id IS NOT NULL) OVER ()::int AS "totalModels",
        SUM(COUNT(*)) OVER ()::int                            AS "totalRollupAssets"
      FROM public."Asset" a
      LEFT JOIN public."AssetModel" am ON a."assetModelId" = am.id
      LEFT JOIN public."Category" cat ON am."defaultCategoryId" = cat.id
      ${whereClause}
        AND a.type = 'INDIVIDUAL'
      -- cat.id joins the grouping because Postgres extends a functional
      -- dependency only within the grouped table: am.id covers every am.*
      -- column, but cat.name / cat.color need Category's own key.
      GROUP BY am.id, cat.id
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
        ? await getAssetModelRollupTotals(whereClause)
        : {
            totalModels: first?.totalModels ?? 0,
            totalRollupAssets: first?.totalRollupAssets ?? 0,
          };

    return {
      rows: result.map(
        ({ totalModels: _m, totalRollupAssets: _a, ...row }) => row
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
