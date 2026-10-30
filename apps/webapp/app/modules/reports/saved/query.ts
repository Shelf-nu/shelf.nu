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
import {
  ALL_REPORT_FILTER_PARAM_KEYS,
  REPORT_FILTER_PARAM,
} from "../filter-params";

/** Timeframe keys written by the timeframe picker. */
const TIMEFRAME_PARAM_KEYS = ["timeframe", "from", "to"] as const;

/**
 * Filter keys whose repeated values form a set (the filter resolves them into
 * one `IN` predicate), so their order carries no meaning. They are stored
 * sorted, which makes two ways of writing the same filter the same string.
 * Scalar keys (data set, grouping, measure, timeframe) keep their order: the
 * page reads the first value, so sorting could change what runs.
 */
const SET_VALUED_KEYS: ReadonlySet<string> = new Set([
  REPORT_FILTER_PARAM.category,
  REPORT_FILTER_PARAM.location,
  REPORT_FILTER_PARAM.status,
  REPORT_FILTER_PARAM.assetModel,
  REPORT_FILTER_PARAM.customField,
]);

/**
 * URL key that names the saved report a builder page was opened from. It is
 * not part of the stored query (the sanitiser drops it), so it only tells the
 * page which entry to mark as open when two saved reports share one query.
 */
export const SAVED_REPORT_ID_PARAM = "saved";

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
    const values = source.getAll(key).filter((value) => value !== "");
    const ordered = SET_VALUED_KEYS.has(key) ? [...values].sort() : values;
    for (const value of ordered) kept.append(key, value);
  }
  return kept.toString();
}

/**
 * Whether two query strings describe the same report once sanitised.
 * Used to mark the saved report that matches the page currently shown when
 * the URL does not name one (see {@link SAVED_REPORT_ID_PARAM}).
 */
export function savedReportQueryEquals(
  a: string | URLSearchParams,
  b: string | URLSearchParams
): boolean {
  return sanitizeSavedReportQuery(a) === sanitizeSavedReportQuery(b);
}

/**
 * The URL to open a saved report: its stored query plus the marker that names
 * it, so the page can tell it apart from another saved report with the same
 * query.
 */
export function savedReportHref(report: { id: string; query: string }): string {
  const params = new URLSearchParams(report.query);
  params.set(SAVED_REPORT_ID_PARAM, report.id);
  return `/reports/builder?${params.toString()}`;
}
