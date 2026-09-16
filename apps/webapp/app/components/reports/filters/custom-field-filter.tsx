/**
 * "Custom field is value" picker for the report filter bar.
 *
 * Two steps inside one popover: choose a field, then choose one of the
 * values that field holds in this workspace. Picking a value appends a
 * `cf=<fieldId>:<value>` query parameter and closes the popover; several
 * fields can be active at once and combine with AND. A TEXT field with more
 * distinct values than the loader fetched also offers an exact-text input.
 *
 * Uses the Popover-with-list pattern of the advanced filters' field
 * selector rather than the deprecated `DropdownMenu`.
 *
 * @see {@link file://../report-filter-bar.tsx}
 * @see {@link file://../../../modules/reports/filter-params.ts} the `cf` grammar
 * @see {@link file://../../../modules/reports/filters.server.ts} where the values come from
 */

import type { ChangeEvent, FormEvent } from "react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronLeft, Search } from "lucide-react";
import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import {
  encodeCustomFieldParam,
  REPORT_FILTER_PARAM,
} from "~/modules/reports/filter-params";
import type { ReportCustomFieldOption } from "~/modules/reports/types";
import { tw } from "~/utils/tw";
import { appendSearchParamValue } from "./search-param-utils";

/** Props for {@link CustomFieldFilter}. */
type Props = {
  /** Filterable custom fields with their values, from the report loader. */
  customFields: ReportCustomFieldOption[];
  /** Disables the trigger while a navigation is in flight. */
  disabled?: boolean;
};

/** Display text for a value; BOOLEAN fields store yes/no but read Yes/No. */
function valueLabel(field: ReportCustomFieldOption, value: string): string {
  if (field.type !== "BOOLEAN") return value;
  return value === "yes" ? "Yes" : "No";
}

/** Human label for the field type, shown beside the field name. */
function typeLabel(type: ReportCustomFieldOption["type"]): string {
  switch (type) {
    case "OPTION":
      return "Option";
    case "BOOLEAN":
      return "Yes / No";
    default:
      return "Text";
  }
}

/**
 * Renders the custom-field trigger and its two-step popover. Returns `null`
 * when the workspace has no filterable custom field, so the bar shows no
 * control that could never do anything.
 */
export function CustomFieldFilter({ customFields, disabled }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<ReportCustomFieldOption | null>(null);
  const [query, setQuery] = useState("");
  const [exactValue, setExactValue] = useState("");

  const activeCount = searchParams.getAll(
    REPORT_FILTER_PARAM.customField
  ).length;

  const visibleFields = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return customFields;
    return customFields.filter((f) =>
      f.name.toLowerCase().includes(normalized)
    );
  }, [customFields, query]);

  const visibleValues = useMemo(() => {
    if (!field) return [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return field.values;
    return field.values.filter((v) =>
      valueLabel(field, v).toLowerCase().includes(normalized)
    );
  }, [field, query]);

  if (customFields.length === 0) return null;

  const reset = () => {
    setField(null);
    setQuery("");
    setExactValue("");
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const applyValue = (value: string) => {
    if (!field) return;
    setSearchParams(
      appendSearchParamValue(
        searchParams,
        REPORT_FILTER_PARAM.customField,
        encodeCustomFieldParam({ customFieldId: field.id, value })
      ),
      { replace: true }
    );
    handleOpenChange(false);
  };

  const handleExactSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = exactValue.trim();
    if (value) applyValue(value);
  };

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) =>
    setQuery(event.target.value);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Custom field
          {activeCount > 0 ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary-50 text-xs font-medium text-primary-700">
              {activeCount}
            </span>
          ) : null}
          <ChevronRight className="rotate-90" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className="z-[100] mt-1 w-[280px] rounded-md border border-gray-200 bg-white p-0 shadow-lg"
        >
          <div className="flex items-center gap-1 border-b border-gray-200 px-3 py-2">
            {field ? (
              <Button
                type="button"
                variant="link"
                className="p-0 text-gray-500 hover:text-gray-700"
                onClick={reset}
                aria-label="Back to fields"
              >
                <ChevronLeft className="size-4" />
              </Button>
            ) : null}
            <span className="truncate text-xs font-semibold text-gray-700">
              {field ? field.name : "Filter by custom field"}
            </span>
          </div>

          <div className="flex items-center border-b border-gray-200">
            <Search className="ml-3 size-4 text-gray-500" />
            <input
              aria-label={
                field
                  ? `Search values for ${field.name}`
                  : "Search custom fields"
              }
              placeholder={field ? "Search values" : "Search fields"}
              className="w-full border-0 p-2 text-sm focus:border-0 focus:ring-0"
              value={query}
              onChange={handleQueryChange}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {!field
              ? visibleFields.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setField(f);
                      setQuery("");
                    }}
                  >
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-gray-500">
                      {typeLabel(f.type)}
                    </span>
                  </button>
                ))
              : visibleValues.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="block w-full truncate px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => applyValue(value)}
                  >
                    {valueLabel(field, value)}
                  </button>
                ))}

            {!field && visibleFields.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">
                No fields found
              </div>
            ) : null}
            {field && visibleValues.length === 0 && !field.hasMoreValues ? (
              <div className="px-3 py-2 text-sm text-gray-500">
                No values found
              </div>
            ) : null}
          </div>

          {field?.hasMoreValues ? (
            <form
              onSubmit={handleExactSubmit}
              className={tw(
                "flex flex-col gap-1 border-t border-gray-200 px-3 py-2"
              )}
            >
              <label
                htmlFor="report-custom-field-exact-value"
                className="text-xs text-gray-500"
              >
                Showing the most common values. Type an exact value:
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="report-custom-field-exact-value"
                  className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
                  value={exactValue}
                  onChange={(event) => setExactValue(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={!exactValue.trim()}
                >
                  Apply
                </Button>
              </div>
            </form>
          ) : null}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
