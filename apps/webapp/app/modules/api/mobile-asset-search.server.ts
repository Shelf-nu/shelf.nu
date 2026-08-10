import type { Prisma } from "@prisma/client";
import {
  buildFullAssetSearchOr,
  buildNarrowAssetSearchOr,
  isIdShapedSearch,
  splitAssetSearchTerms,
} from "~/modules/asset/search.server";

/**
 * Search clauses for the mobile assets list
 * (routes/api+/mobile+/assets.ts).
 *
 * Thin composition over the SHARED simple-mode search module
 * (`modules/asset/search.server.ts`) — the same clause builders the web
 * `getAssets` fetcher uses. Mobile search therefore matches exactly the
 * fields web search matches (title, sequentialId, description, category,
 * location, tags, custodian names, QR/barcode, custom fields) and inherits
 * web's ID-shaped fast-path strategy: narrow indexed clause first, full
 * clause only when the narrow one finds nothing.
 */

/** The two-step where fragments the mobile assets route queries with. */
export interface MobileAssetSearchClauses {
  /** Fragment for the first query. `{}` when there is nothing to search. */
  primary: Prisma.AssetWhereInput;
  /**
   * Full-clause fragment to re-query with when `primary` (the narrow
   * ID-shaped fast path) returns zero rows. `null` when `primary` already IS
   * the full clause — or when there is no search — meaning no second query
   * is ever needed.
   */
  fallback: Prisma.AssetWhereInput | null;
}

/**
 * Builds the search fragments for the mobile assets list.
 *
 * Mirrors `getAssets`' strategy exactly: ID-shaped terms (see
 * `looksLikeAssetId`) take the narrow indexed clause with the full clause as
 * a zero-row fallback; anything else goes straight to the full clause.
 *
 * @param search - Raw (already length-capped) search term from the request
 * @returns Spreadable primary/fallback where fragments — see
 *   {@link MobileAssetSearchClauses}
 */
export function buildMobileAssetSearchWhere(
  search: string
): MobileAssetSearchClauses {
  const searchTerms = splitAssetSearchTerms(search);

  if (searchTerms.length === 0) {
    // Typed input that yields zero terms (whitespace / bare commas) must
    // match NOTHING, not everything: in a debounced type-ahead a single
    // typed space would otherwise flash the full unfiltered list.
    // `id: { in: [] }` is the canonical always-false Prisma clause. Only a
    // genuinely empty search string means "no filter".
    if (search.length > 0) {
      return { primary: { id: { in: [] } }, fallback: null };
    }
    return { primary: {}, fallback: null };
  }

  if (isIdShapedSearch(searchTerms)) {
    return {
      primary: { OR: buildNarrowAssetSearchOr(searchTerms) },
      fallback: { OR: buildFullAssetSearchOr(searchTerms) },
    };
  }

  return {
    primary: { OR: buildFullAssetSearchOr(searchTerms) },
    fallback: null,
  };
}
