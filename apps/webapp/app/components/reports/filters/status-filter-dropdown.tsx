/**
 * Multi-select status filter for the report filter bar.
 *
 * The choices come from the loader (`ReportFilterOptions.statuses`): asset
 * statuses for asset reports, the measurable booking statuses for booking
 * reports. Each toggle writes or removes one `status=<value>` parameter.
 *
 * Small fixed list, so a plain popover with checkbox rows is used instead of
 * the searching `DynamicDropdown`.
 *
 * @see {@link file://../report-filter-bar.tsx}
 */

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronRight } from "~/components/icons/library";
import { useSearchParams } from "~/hooks/search-params";
import { REPORT_FILTER_PARAM } from "~/modules/reports/filter-params";
import type { ReportStatusOption } from "~/modules/reports/types";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { toggleSearchParamValue } from "./search-param-utils";

/** Props for {@link StatusFilterDropdown}. */
type Props = {
  options: ReportStatusOption[];
  disabled?: boolean;
};

/** Renders the status trigger and its checkbox list. */
export function StatusFilterDropdown({ options, disabled }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const selected = searchParams.getAll(REPORT_FILTER_PARAM.status);

  if (options.length === 0) return null;

  const toggle = (value: string) => {
    setSearchParams(
      toggleSearchParamValue(searchParams, REPORT_FILTER_PARAM.status, value),
      { replace: true }
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Status
          {selected.length > 0 ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary-50 text-xs font-medium text-primary-700">
              {selected.length}
            </span>
          ) : null}
          <ChevronRight className="rotate-90" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className="z-[100] mt-1 min-w-[200px] rounded-md border border-gray-200 bg-white p-0 shadow-lg"
        >
          <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
            Filter by status
          </div>
          <div className="py-1">
            {options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={checked}
                  tabIndex={0}
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => toggle(option.value)}
                  onKeyDown={handleActivationKeyPress(() =>
                    toggle(option.value)
                  )}
                >
                  <input
                    type="checkbox"
                    readOnly
                    tabIndex={-1}
                    checked={checked}
                    className="size-4 rounded border-gray-300 text-primary-600"
                    aria-label={option.label}
                  />
                  <span>{option.label}</span>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
