/**
 * The query string a saved report stores.
 *
 * A saved report is the builder page's URL, so opening one is a navigation to
 * `/reports/builder?<query>` and the URL grammar validates it on read. Only
 * the keys the builder page reads are kept: the spec (data set, grouping,
 * measure), the shared report filters and the timeframe. Anything else on the
 * URL (a pagination cursor, a stray tracking parameter) is dropped, so two
 * reports that show the same thing store the same string.
 *
 * Client-safe: the save dialog derives the query from the current URL.
 *
 * @see {@link file://../builder/spec.ts}
 * @see {@link file://../filter-params.ts}
 */

import { BUILDER_SPEC_PARAM } from "../builder/spec";
import { ALL_REPORT_FILTER_PARAM_KEYS } from "../filter-params";

/** Timeframe keys written by the timeframe picker. */
const TIMEFRAME_PARAM_KEYS = ["timeframe", "from", "to"] as const;

/** Every query key a saved report may carry. */
export const SAVED_REPORT_QUERY_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(BUILDER_SPEC_PARAM),
  ...ALL_REPORT_FILTER_PARAM_KEYS,
  ...TIMEFRAME_PARAM_KEYS,
]);

/**
 * Keeps only the builder-relevant keys of a query string, in a stable order.
 *
 * @param query - A query string with or without the leading `?`, or params
 * @returns The sanitised query string without a leading `?`
 */
export function sanitizeSavedReportQuery(
  query: string | URLSearchParams
): string {
  const source =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);

  const kept = new URLSearchParams();
  // Iterate the whitelist, not the input: the output order then never depends
  // on how the user's URL happened to be arranged.
  for (const key of SAVED_REPORT_QUERY_KEYS) {
    for (const value of source.getAll(key)) {
      if (value !== "") kept.append(key, value);
    }
  }
  return kept.toString();
}

/**
 * Whether two query strings describe the same report once sanitised.
 * Used to mark the saved report that matches the page currently shown.
 */
export function savedReportQueryEquals(
  a: string | URLSearchParams,
  b: string | URLSearchParams
): boolean {
  return sanitizeSavedReportQuery(a) === sanitizeSavedReportQuery(b);
}
