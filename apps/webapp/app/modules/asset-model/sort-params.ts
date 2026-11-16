/**
 * Asset Model Sort Params
 *
 * The URL contract behind the model view's sortable column headers. Sorting is
 * a server concern: `getAssetModelRollup` orders the rollup by one of
 * `ASSET_MODEL_ROLLUP_SORT_KEYS`, which the asset index loader reads from the
 * `modelSortBy` and `modelSortDirection` search params, falling back to name
 * ascending for anything it does not recognise.
 *
 * This module holds the two decisions the header control needs: what a click
 * writes into those params, and what sort state the header announces.
 *
 * Deliberately a plain module with no server imports, so the header components
 * can use it. The sort-key type comes from the rollup module as a type-only
 * import, which erases at build time.
 *
 * @see {@link file://./rollup.server.ts}
 * @see {@link file://./view-params.ts}
 * @see {@link file://./../../components/assets/assets-index/asset-model-sort-header.tsx}
 */
import type { AssetModelRollupSortKey } from "./rollup.server";

/** Sort directions the rollup query accepts. */
export type AssetModelSortDirection = "asc" | "desc";

/** A resolved sort: the column to order by and the direction to order it in. */
export type AssetModelSort = {
  sortBy: AssetModelRollupSortKey;
  sortDirection: AssetModelSortDirection;
};

/**
 * Direction a column opens in on its first click.
 *
 * A name reads alphabetically, so it opens ascending. The counting columns open
 * descending, because the question a reader brings to them is "which models
 * have the most".
 *
 * Exhaustive over the rollup's key list on purpose: a key added there without a
 * direction here is a type error, rather than an `undefined` direction that the
 * server would quietly read as ascending.
 */
export const ASSET_MODEL_SORT_FIRST_DIRECTION: Record<
  AssetModelRollupSortKey,
  AssetModelSortDirection
> = {
  name: "asc",
  assets: "desc",
  available: "desc",
  value: "desc",
};

/**
 * The active sort, as the loader resolved it.
 *
 * Both fields are typed as plain strings because they describe what came back
 * from a URL-derived loader payload rather than a value this module produced.
 * The server has already normalised them; anything unrecognised here simply
 * reads as "not the active column", which is also what a first visit looks
 * like.
 */
type ActiveAssetModelSort = {
  activeSortBy: string;
  activeSortDirection: string;
};

/**
 * Resolves the sort a click on `sortKey` should produce.
 *
 * Clicking the column that is already sorted flips its direction. Clicking any
 * other column switches to it in that column's opening direction.
 *
 * @param sortKey - The clicked column's sort key. Typed against the rollup's
 *   key list, so a column the server has no sort expression for cannot be wired
 *   up: the server would fall back to name and the header would show a sort
 *   nobody performed.
 * @param activeSortBy - The column the list is currently sorted by.
 * @param activeSortDirection - The direction it is currently sorted in.
 * @returns The sort to write into `modelSortBy` and `modelSortDirection`.
 */
export function resolveNextAssetModelSort({
  sortKey,
  activeSortBy,
  activeSortDirection,
}: {
  sortKey: AssetModelRollupSortKey;
} & ActiveAssetModelSort): AssetModelSort {
  if (sortKey !== activeSortBy) {
    return {
      sortBy: sortKey,
      sortDirection: ASSET_MODEL_SORT_FIRST_DIRECTION[sortKey],
    };
  }

  return {
    sortBy: sortKey,
    sortDirection: activeSortDirection === "desc" ? "asc" : "desc",
  };
}

/**
 * The `aria-sort` value a sortable column header carries.
 *
 * `none` on every column but the active one: ARIA allows a single sorted column
 * at a time, and a header claiming a direction it is not sorted by is the same
 * kind of lie as a control that does nothing.
 *
 * @param sortKey - The header's own sort key.
 * @param activeSortBy - The column the list is currently sorted by.
 * @param activeSortDirection - The direction it is currently sorted in.
 * @returns The value for the `aria-sort` attribute on the header cell.
 */
export function resolveAssetModelAriaSort({
  sortKey,
  activeSortBy,
  activeSortDirection,
}: { sortKey: AssetModelRollupSortKey } & ActiveAssetModelSort):
  | "ascending"
  | "descending"
  | "none" {
  if (sortKey !== activeSortBy) {
    return "none";
  }

  return activeSortDirection === "desc" ? "descending" : "ascending";
}
