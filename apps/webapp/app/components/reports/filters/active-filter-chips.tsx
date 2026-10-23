/**
 * The row of applied report filters, one removable chip each.
 *
 * Labels arrive resolved from the loader ("Category: Cameras"), so this
 * component never has to know what an id means. Removing a chip deletes
 * exactly its `param=value` pair; "Clear all" removes every filter key and
 * keeps the timeframe and sorting. When the link named filters that no longer
 * exist (a deleted category, a removed custom field), a short notice says
 * they were left out, so an unfiltered result is never mistaken for a
 * filtered one.
 *
 * @see {@link file://../report-filter-bar.tsx}
 * @see {@link file://../../../modules/reports/filters.server.ts} builds the labels
 */

import { X } from "lucide-react";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import type { ActiveReportFilter } from "~/modules/reports/types";
import {
  clearReportFilterParams,
  removeSearchParamValue,
} from "./search-param-utils";

/** Props for {@link ActiveFilterChips}. */
type Props = {
  filters: ActiveReportFilter[];
  /** How many filters in the link were left out because they no longer exist. */
  ignoredCount?: number;
  disabled?: boolean;
};

/** The notice for filters the link named but the report could not apply. */
export function ignoredFiltersNotice(count: number): string {
  return count === 1
    ? "1 filter in this link no longer exists and was left out."
    : `${count} filters in this link no longer exist and were left out.`;
}

/** Renders the chips and the left-out notice; `null` when there is neither. */
export function ActiveFilterChips({
  filters,
  ignoredCount = 0,
  disabled,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (filters.length === 0 && ignoredCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ignoredCount > 0 ? (
        <span className="text-xs text-gray-500" role="status">
          {ignoredFiltersNotice(ignoredCount)}
        </span>
      ) : null}
      {filters.map((filter) => (
        <span
          key={`${filter.param}=${filter.value}`}
          className="inline-flex items-center gap-1 rounded-full bg-gray-100 pl-2.5 pr-1 text-xs font-medium text-gray-700"
        >
          <span className="max-w-[240px] truncate py-1">{filter.label}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove filter ${filter.label}`}
            className="flex size-5 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed"
            onClick={() =>
              setSearchParams(
                removeSearchParamValue(
                  searchParams,
                  filter.param,
                  filter.value
                ),
                { replace: true }
              )
            }
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {filters.length > 0 ? (
        <Button
          type="button"
          variant="link"
          className="text-xs font-normal text-gray-500 hover:text-gray-700"
          disabled={disabled}
          onClick={() =>
            setSearchParams(clearReportFilterParams(searchParams), {
              replace: true,
            })
          }
        >
          Clear all filters
        </Button>
      ) : null}
    </div>
  );
}
