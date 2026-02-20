/** Params that are NOT user-applied filters (pagination, sorting, search, etc.) */
export const NON_FILTER_PARAMS = new Set([
  "s",
  "page",
  "per_page",
  "getAll",
  "scanId",
  "redirectTo",
  "sortBy",
  "orderBy",
  "orderDirection",
  "index",
  "view",
]);

/**
 * Returns true if the given search params contain at least one
 * key that is considered a user-applied filter (i.e. not in NON_FILTER_PARAMS).
 */
export function computeHasActiveFilters(
  searchParams: URLSearchParams
): boolean {
  for (const key of searchParams.keys()) {
    if (!NON_FILTER_PARAMS.has(key)) {
      return true;
    }
  }
  return false;
}
