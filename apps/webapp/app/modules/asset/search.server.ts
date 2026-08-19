import { AssetStatus, type Prisma } from "@prisma/client";

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
