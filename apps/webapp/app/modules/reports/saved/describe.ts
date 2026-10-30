/**
 * One-line description of a saved report, derived from its query string.
 *
 * Used wherever a saved report is listed without running it: the reports
 * index cards and the builder's "Saved reports" menu. Client-safe.
 *
 * @see {@link file://./query.ts}
 */

import {
  DATASET_LABELS,
  GROUP_BY_LABELS,
  MEASURE_LABELS,
  parseBuilderSpec,
} from "../builder/spec";
import { ALL_REPORT_FILTER_PARAM_KEYS } from "../filter-params";

/**
 * Describes what a saved report shows, e.g.
 * "Assets · by Category · Total value · 2 filters".
 *
 * A custom-field grouping is named generically because the query holds only
 * the field's id; the builder page resolves the name when the report runs.
 *
 * @param query - The saved report's query string
 * @returns The description
 */
export function describeSavedReportQuery(query: string): string {
  const params = new URLSearchParams(query);
  const spec = parseBuilderSpec(params);

  const parts = [DATASET_LABELS[spec.dataset]];
  if (spec.groupBy !== "none") {
    parts.push(`by ${GROUP_BY_LABELS[spec.groupBy]}`);
  }
  parts.push(MEASURE_LABELS[spec.measure]);

  const filterCount = ALL_REPORT_FILTER_PARAM_KEYS.reduce(
    (count, key) => count + params.getAll(key).filter(Boolean).length,
    0
  );
  if (filterCount > 0) {
    parts.push(`${filterCount} ${filterCount === 1 ? "filter" : "filters"}`);
  }

  return parts.join(" · ");
}
