/**
 * Refresh and error-display decisions for the assets list.
 *
 * The list keeps rows it loaded earlier and refetches on tab focus only when
 * they are stale, or when another screen changed an asset (see
 * `asset-refresh.ts`). These are the rules for that, kept free of React so
 * they run under the node test runner.
 *
 * @see {@link file://./../app/(tabs)/assets/index.tsx} the only consumer
 * @see {@link file://./asset-refresh.ts} the cross-screen change signal
 */

/** How long loaded rows count as fresh for a plain tab focus. */
export const ASSET_LIST_FRESH_MS = 60_000;

/**
 * What a tab focus does with the rows on screen.
 *
 * - `skip`: the rows are fresh and nothing changed; fetch nothing.
 * - `reset`: load page 1 and replace the rows.
 * - `reload-loaded`: reload every page already on screen and replace the rows
 *   with the same depth, so an operator scrolled deep into the list stays
 *   where they were.
 */
export type FocusRefresh = "skip" | "reset" | "reload-loaded";

/**
 * Decides what a tab focus does with the assets list.
 *
 * @param args.hasFetched - Whether any page has loaded since the screen (or
 *   the workspace) started
 * @param args.ageMs - Time since the rows on screen last loaded successfully
 * @param args.assetChanged - Whether another screen changed an asset since the
 *   rows loaded
 * @param args.loadedPages - How many pages are on screen
 * @returns The refresh to run
 */
export function planFocusRefresh({
  hasFetched,
  ageMs,
  assetChanged,
  loadedPages,
}: {
  hasFetched: boolean;
  ageMs: number;
  assetChanged: boolean;
  loadedPages: number;
}): FocusRefresh {
  if (!hasFetched) return "reset";
  // A change elsewhere refreshes the rows the operator is looking at, at the
  // depth they scrolled to. Staleness alone starts again from page 1.
  if (assetChanged) return loadedPages > 1 ? "reload-loaded" : "reset";
  return ageMs < ASSET_LIST_FRESH_MS ? "skip" : "reset";
}

/**
 * Where a load error shows.
 *
 * - `screen`: the full error view with Retry, in place of the list.
 * - `banner`: a strip above rows that are still valid for the current query
 *   (a failed refresh or load-more), so they stay readable.
 * - `none`: no error.
 */
export type ListErrorView = "screen" | "banner" | "none";

/**
 * Decides where the list shows a load error.
 *
 * Rows on screen always belong to the current query: a failed search or
 * filter change clears them, so a banner never sits on another query's rows.
 *
 * @param error - The last load error, or null
 * @param rowCount - Rows on screen
 * @returns Where the error shows
 */
export function listErrorView(
  error: string | null,
  rowCount: number
): ListErrorView {
  if (!error) return "none";
  return rowCount === 0 ? "screen" : "banner";
}
