/**
 * Query-string helpers for the report filter bar.
 *
 * Every filter change goes through these so two rules hold everywhere:
 * a value is removed by key AND value (multi-value keys keep their other
 * values), and any filter change drops `page` so the user lands on the
 * first page of the newly filtered result.
 *
 * `URLSearchParams.delete(key, value)` is not used: the two-argument form
 * is newer than the browsers Shelf supports, so removal is rebuilt by hand.
 *
 * Pure module: safe in the client bundle and unit-testable.
 *
 * @see {@link file://../report-filter-bar.tsx}
 */

import { ALL_REPORT_FILTER_PARAM_KEYS } from "~/modules/reports/filter-params";

/** Query key for pagination, reset on every filter change. */
const PAGE_PARAM = "page";

/**
 * Copies `params` without the one `key=value` pair, keeping the key's other
 * values and every other key. Resets paging.
 */
export function removeSearchParamValue(
  params: URLSearchParams,
  key: string,
  value: string
): URLSearchParams {
  const next = new URLSearchParams();
  for (const [k, v] of params.entries()) {
    if (k === PAGE_PARAM) continue;
    if (k === key && v === value) continue;
    next.append(k, v);
  }
  return next;
}

/**
 * Copies `params` with `key=value` added once (a repeated pick is a no-op).
 * Resets paging.
 */
export function appendSearchParamValue(
  params: URLSearchParams,
  key: string,
  value: string
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(PAGE_PARAM);
  if (!next.getAll(key).includes(value)) {
    next.append(key, value);
  }
  return next;
}

/**
 * Toggles `key=value`: removes it when present, adds it otherwise.
 * Resets paging.
 */
export function toggleSearchParamValue(
  params: URLSearchParams,
  key: string,
  value: string
): URLSearchParams {
  return params.getAll(key).includes(value)
    ? removeSearchParamValue(params, key, value)
    : appendSearchParamValue(params, key, value);
}

/**
 * Copies `params` without any report filter (current or legacy spelling),
 * leaving the timeframe, sort and other keys in place. Resets paging.
 */
export function clearReportFilterParams(
  params: URLSearchParams
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of ALL_REPORT_FILTER_PARAM_KEYS) {
    next.delete(key);
  }
  next.delete(PAGE_PARAM);
  return next;
}
