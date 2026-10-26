/**
 * The `lowStockOnly` URL param behind the "Low stock only" toggle.
 *
 * Both asset index modes render the toggle (the simple list in its toolbar,
 * the advanced list inside its Filter popover) and flip the param the same
 * way, so the low-stock link in the alert email works in either mode.
 *
 * @see {@link file://./filters.tsx}
 * @see {@link file://./advanced-asset-index-filters-and-sorting.tsx}
 */

/** The URL param name. Only the value `"true"` turns the filter on. */
export const LOW_STOCK_PARAM = "lowStockOnly";

/**
 * Whether the low-stock filter is on in these params.
 *
 * @param params - The current search params
 */
export function isLowStockFilterOn(params: URLSearchParams) {
  return params.get(LOW_STOCK_PARAM) === "true";
}

/**
 * Turns the low-stock filter on or off, in place, and drops `page` so the
 * list restarts from the first page when the rows change.
 *
 * @param params - The search params to change (`setSearchParams`' `prev`)
 * @returns The same params, for `setSearchParams((prev) => ...)`
 */
export function toggleLowStockParam(params: URLSearchParams) {
  if (isLowStockFilterOn(params)) {
    params.delete(LOW_STOCK_PARAM);
  } else {
    params.set(LOW_STOCK_PARAM, "true");
  }
  params.delete("page");
  return params;
}
