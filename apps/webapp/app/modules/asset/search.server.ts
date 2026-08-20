import { AssetStatus, type Prisma } from "@prisma/client";

import { ShelfError } from "~/utils/error";

/**
 * JSON paths inside `AssetCustomFieldValue.value` that hold searchable text.
 * Owned here (not `query.server.ts`) so this module stays standalone — it
 * previously imported the constant from the 2900-line advanced-index module,
 * which transitively touches `db.server` and made these "pure" builders drag
 * a database connection into their unit tests. `query.server.ts` imports it
 * back from here for the advanced-index SQL.
 */
export const CUSTOM_FIELD_SEARCH_PATHS = [
  "valueText",
  "valueMultiLineText",
  "valueOption",
  "valueDate",
  "valueBoolean",
  "raw",
] as const;

/**
 * Shared asset-search helpers used across every search surface: the web
 * `getAssets` fetcher (`service.server.ts`), the mobile assets endpoint
 * (`modules/api/mobile-asset-search.server.ts`), and the advanced-index
 * `generateWhereClause` (`query.server.ts`). Holds the term parser
 * (`splitAssetSearchTerms`), the QT-aware status fragment
 * (`buildAssetStatusWhere`), and the searchable custom-field JSON paths
 * (`CUSTOM_FIELD_SEARCH_PATHS`).
 *
 * The actual matching is one org-scoped `UNION` of ids (`buildAssetSearchUnion`
 * in `search-union.server.ts`), shared by all three surfaces. The old
 * per-surface Prisma OR clause builders that lived here — buildFullAssetSearchOr
 * / buildNarrowAssetSearchOr / isIdShapedSearch / looksLikeAssetId — were
 * removed once every surface moved to the UNION.
 */

/**
 * Upper bound on comma-separated terms honored per search. Each term adds a
 * full 10-source group to the search UNION, so an unbounded paste could fan a
 * single request into an arbitrarily expensive query. Ten is far beyond any
 * real search-box usage.
 */
export const MAX_ASSET_SEARCH_TERMS = 10;

/**
 * Splits a raw search string into normalized search terms.
 *
 * Mirrors the historical `getAssets` behavior: lowercase, trim, split on
 * commas (comma = "match any of these"), trim each term, drop empties —
 * capped at {@link MAX_ASSET_SEARCH_TERMS} terms as a query-cost guard.
 *
 * @param search - Raw search string from the request
 * @returns Normalized terms; empty array when nothing searchable remains
 */
export function splitAssetSearchTerms(search: string): string[] {
  return search
    .toLowerCase()
    .trim()
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, MAX_ASSET_SEARCH_TERMS);
}

/**
 * Status fragment shared by every asset list surface.
 *
 * AVAILABLE is QT-aware: a QUANTITY_TRACKED row's status flips to
 * IN_CUSTODY/CHECKED_OUT as soon as ANY unit is allocated even while free
 * stock remains, so a raw equality filter would hide those rows from an
 * "Available" view. AVAILABLE therefore matches available INDIVIDUAL rows OR
 * any QUANTITY_TRACKED row; every other status keeps raw equality (already
 * truthful for QT rows).
 *
 * Callers compose it per their local convention: the AVAILABLE form is an
 * `OR` group meant to be appended to a `where.AND` (so it cannot collide
 * with search `OR`s); the equality form can be spread at the top level.
 *
 * @param status - A validated `AssetStatus` enum value
 * @returns A `Prisma.AssetWhereInput` fragment for the status filter
 */
export function buildAssetStatusWhere(
  status: AssetStatus
): Prisma.AssetWhereInput {
  if (status === AssetStatus.AVAILABLE) {
    return {
      OR: [
        { type: "INDIVIDUAL", status: AssetStatus.AVAILABLE },
        { type: "QUANTITY_TRACKED" },
      ],
    };
  }
  return { status };
}

/**
 * User-facing message for the bind-param ceiling 400. Exported so callers and
 * tests assert the exact contract (that this actionable message — not a generic
 * wrapper — reaches the user) rather than a fragile substring match.
 */
export const ASSET_SEARCH_CEILING_MESSAGE =
  "Your search matched too many assets to process at once. Please refine it with more specific terms.";

/**
 * Safe upper bound on the number of matching asset ids that the id-materializing
 * search surfaces (the simple `getAssets` fetcher and the mobile endpoint) may
 * feed into a Prisma `id: { in: [...] }` clause.
 *
 * Prisma serializes `{ id: { in: [...] } }` for Postgres as `IN ($1,…,$n)` — one
 * bind parameter per id (measured on Prisma 6.19; it does NOT use `= ANY($1)`).
 * Postgres caps a single prepared statement at **65,535** bind parameters, so a
 * search matching more ids than that makes the `count`/`findMany` queries
 * hard-fail with a raw error (a 500).
 *
 * We stop at 50,000, reserving ~15,500 params of headroom for the query's OTHER
 * bound params — which matters because several filters are themselves unbounded,
 * URL-repeated arrays: `getAssets` binds `teamMemberIds` into four separate
 * `{ in }` clauses, so a large custodian filter alone can add thousands of
 * params on top of the search ids. This headroom is a pragmatic margin, not a
 * formal guarantee: the pure-filter vector is bounded in practice by request URL
 * length, and a formal bound would instead clamp the `getAll` filter arrays in
 * `getParamsValues` (`~/utils/list`) — a noted follow-up, not needed for a case
 * that already requires a 100k+ asset org.
 *
 * Only a ~100k+ asset organization searching a very broad term can reach this;
 * the largest org today holds ~14k assets, so in practice it never trips. It
 * exists to turn a latent hard-500 into graceful degradation for a future
 * mega-org. The advanced index is unaffected — it inlines the UNION as a raw
 * `id IN (subquery)` and never materializes an id list.
 */
export const MAX_MATCHED_ASSET_SEARCH_IDS = 50_000;

/**
 * Throws a friendly 400 when a search matched more asset ids than we can safely
 * feed into a Prisma `id: { in }` clause (see {@link MAX_MATCHED_ASSET_SEARCH_IDS}).
 *
 * Pure (no I/O) so it can be unit-tested without a database. The error is a
 * user-input 400 with `shouldBeCaptured: false` — an over-broad search is not a
 * server fault and should not page anyone.
 *
 * @param count - The number of matching asset ids the search resolved to.
 * @throws {ShelfError} 400 when `count` exceeds {@link MAX_MATCHED_ASSET_SEARCH_IDS}.
 */
export function assertAssetSearchIdCeiling(count: number): void {
  if (count > MAX_MATCHED_ASSET_SEARCH_IDS) {
    throw new ShelfError({
      cause: null,
      message: ASSET_SEARCH_CEILING_MESSAGE,
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
      additionalData: {
        matchedCount: count,
        ceiling: MAX_MATCHED_ASSET_SEARCH_IDS,
      },
    });
  }
}
