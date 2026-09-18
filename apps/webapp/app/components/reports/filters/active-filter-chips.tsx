/**
 * The row of applied report filters, one removable chip each.
 *
 * Labels arrive resolved from the loader ("Category: Cameras"), so this
 * component never has to know what an id means. Removing a chip deletes
 * exactly its `param=value` pair; "Clear all" removes every filter key and
 * keeps the timeframe and sorting.
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
  disabled?: boolean;
};

/** Renders the chips; `null` when nothing is applied. */
export function ActiveFilterChips({ filters, disabled }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  if (filters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
