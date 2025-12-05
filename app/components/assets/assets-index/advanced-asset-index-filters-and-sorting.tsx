import type {
  ChangeEvent,
  KeyboardEvent,
  Dispatch,
  SetStateAction,
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { Reorder } from "framer-motion";
import { Search } from "lucide-react";
import { useLoaderData } from "react-router";
import { Switch } from "~/components/forms/switch";
import { ChevronRight, HandleIcon, PlusIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import {
  parseColumnName,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import { FieldSelector } from "./advanced-filters/field-selector";
import {
  getAvailableColumns,
  getDefaultValueForFieldType,
  getUIFieldType,
  useInitialFilters,
} from "./advanced-filters/helpers";
import {
  operatorsPerType,
  OperatorSelector,
} from "./advanced-filters/operator-selector";
import type { Filter, FilterFieldType } from "./advanced-filters/schema";
import { ValueField } from "./advanced-filters/value-field";
import { useFilterFormValidation } from "./advanced-filters/value.client.validator";
import { SaveFilterButton } from "./saved-filter-presets";

export interface Sort {
  name: string;
  direction: "asc" | "desc";
  // Only relevant for custom fields
  cfType?: string;
}

export function AdvancedFilteringAndSorting() {
  return (
    <>
      <AdvancedFilter /> <AdvancedSorting />
    </>
  );
}

const getTriggerClasses = (
  open: boolean,
  activeItems: number,
  className?: string
) =>
  tw(
    "font-normal text-gray-500",
    open ? "bg-gray-50" : "",
    activeItems > 0
      ? "whitespace-nowrap border-primary bg-primary-25 text-primary"
      : "",
    className
  );

function AdvancedFilter() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const { settings, customFields } = useLoaderData<AssetIndexLoaderData>();

  const columns = settings.columns as Column[];
  const disabled = useDisabled();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<Filter[]>([]);
  const initialFilters = useInitialFilters(columns);
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);

  // Track if we're applying filters internally to avoid resetting state
  const isApplyingInternally = useRef(false);

  const availableColumns = getAvailableColumns(columns, filters, "filter");

  // Set the intial filters
  useEffect(() => {
    // Only sync from URL if we're not applying internally
    if (isApplyingInternally.current) {
      isApplyingInternally.current = false;
      return;
    }
    setFilters(initialFilters);
    setHasUnappliedChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  function clearAllFilters() {
    setFilters([]);
    /** If there are already filters, clear them from the search params */
    if (filters.length > 0) {
      isApplyingInternally.current = true;
      setSearchParams((prev) => {
        // Clear existing filter params
        columns.forEach((column) => {
          if (prev.has(column.name)) {
            prev.delete(column.name);
          }
        });
        return prev;
      });
    }
  }

  function applyFilters() {
    // Dont do anything if there are validation errors
    if (!validation.canApplyFilters) return;

    isApplyingInternally.current = true;
    setSearchParams((prev) => {
      // Clear existing filter params
      columns.forEach((column) => {
        if (prev.has(column.name)) {
          prev.delete(column.name);
        }
      });

      // Add new filter params
      filters.forEach((filter) => {
        prev.set(filter.name, `${filter.operator}:${filter.value}`);
      });

      // Reset page when applying filters
      prev.delete("page");
      return prev;
    });

    // Mark changes as applied
    setHasUnappliedChanges(false);
  }

  function addFilter() {
    setFilters((prev) => {
      const newCols = [...prev];
      const firstColumn = availableColumns[0];
      const fieldType = getUIFieldType({
        column: firstColumn,
      }) as FilterFieldType;

      newCols.push({
        name: firstColumn.name, // Keep the name for proper UI rendering
        operator: operatorsPerType[fieldType][0],
        value: getDefaultValueForFieldType(firstColumn, customFields),
        type: fieldType,
        isNew: true, // Mark as new/unselected
      });
      return newCols;
    });
    setHasUnappliedChanges(true);
  }

  const { zo, getValidationState, getFieldName, getError } =
    useFilterFormValidation(filters, initialFilters);

  const validation = getValidationState();

  return (
    <>
      {/* 
      [IMPORTANT] The `modal={false}` prop is set on this Popover to allow interaction with elements outside the popover while it is open.
      This is necessary for SaveFilterButton dialogs to work properly (e.g., for dialogs that open from within the popover).
      However, this can affect user experience: users can interact with background elements while the filter popover is open,
      and may open multiple popovers (such as SavedFilterPresetsControls) simultaneously, leading to confusing or inconsistent UI states.
      If you modify this component or add new popovers/dialogs, ensure that simultaneous popover interactions are handled gracefully.
      Consider restricting popover opening logic or adding UI safeguards if needed.
      */}
      <Popover
        open={isPopoverOpen}
        onOpenChange={setIsPopoverOpen}
        modal={false}
      >
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className={getTriggerClasses(isPopoverOpen, initialFilters.length)}
            icon="filter"
          >
            {/* We use the initial sorts, as we only count the ones returned from the server as those are already active filters */}
            {initialFilters.length > 0
              ? `Filtered by ${initialFilters.length}`
              : "Filter"}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[9999]  mt-2 min-w-[580px] rounded-md border border-gray-200 bg-white"
            )}
          >
            <div className="border-b p-4 pb-5">
              {filters.length === 0 ? (
                <div>
                  <h5>No filters applied to this view</h5>
                  <p>Add a column below to filter the view</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <form
                    ref={zo.ref}
                    onKeyDown={(e) => {
                      /**
                       * Prevent default behavior of the Enter key on input fields.
                       * The form element is only needed for validations, so we don't want it to submit on Enter.
                       * However, we allow Enter on buttons to support proper keyboard navigation for popovers.
                       */
                      if (
                        e.key === "Enter" &&
                        e.target instanceof HTMLElement &&
                        e.target.tagName !== "BUTTON"
                      ) {
                        e.preventDefault();
                      }
                    }}
                    className="flex flex-col gap-2"
                  >
                    {filters.map((filter, index) => (
                      <div
                        className="flex w-full items-start gap-1"
                        key={filter.name + index}
                      >
                        <div className="w-[150px] shrink-0">
                          <FieldSelector
                            filter={filter}
                            filters={filters}
                            setFilter={(name) => {
                              setFilters((prev) => {
                                const column = availableColumns.find(
                                  (c) => c.name === name
                                ) as Column;

                                // Only proceed with type/operator/value setup if a valid column is selected
                                if (column) {
                                  const fieldType = getUIFieldType({
                                    column,
                                  }) as FilterFieldType;

                                  const newFilters = [...prev];
                                  newFilters[index] = {
                                    ...newFilters[index],
                                    name,
                                    type: fieldType,
                                    operator: operatorsPerType[fieldType][0],
                                    value: getDefaultValueForFieldType(
                                      column,
                                      customFields
                                    ),
                                    isNew: false,
                                  };
                                  return newFilters;
                                }
                                return prev;
                              });
                              setHasUnappliedChanges(true);
                            }}
                          />
                        </div>

                        {filter.name && (
                          <>
                            <div className="w-[50px] shrink-0">
                              <OperatorSelector
                                filter={filter}
                                setFilter={(operator) => {
                                  setFilters((prev) => {
                                    const newFilters = [...prev];
                                    newFilters[index].operator = operator;
                                    return newFilters;
                                  });
                                  setHasUnappliedChanges(true);
                                }}
                                disabled={
                                  filter.isNew
                                    ? { reason: "Please select a column" }
                                    : false
                                }
                              />
                            </div>
                            <div className="min-w-0 grow">
                              <ValueField
                                filter={filter}
                                setFilter={(value) => {
                                  setFilters((prev) => {
                                    const newFilters = [...prev];
                                    newFilters[index].value = value;
                                    return newFilters;
                                  });
                                  setHasUnappliedChanges(true);
                                }}
                                applyFilters={applyFilters}
                                fieldName={getFieldName(index)}
                                zormError={getError(index)}
                                disabled={filter.isNew}
                              />
                            </div>
                          </>
                        )}

                        <Button
                          variant="block-link-gray"
                          className="mt-[5px] shrink-0 text-[10px] font-normal text-gray-600"
                          icon="x"
                          onClick={() => {
                            setFilters((prev) =>
                              prev.filter((_, i) => i !== index)
                            );
                            setHasUnappliedChanges(true);
                          }}
                        />
                      </div>
                    ))}
                  </form>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <Button
                  variant="secondary"
                  className="text-[14px] font-medium"
                  size="xs"
                  disabled={
                    disabled || availableColumns.length === 0
                      ? {
                          reason:
                            "You are not able to add more filters because all columns are already used. If you want to filter by more columns, please enable them on your column settings.",
                        }
                      : false
                  }
                  onClick={addFilter}
                >
                  <div className="mr-1 inline-block size-[14px] align-middle">
                    <PlusIcon />
                  </div>
                  <span className="inline-block align-middle">Add filter</span>
                </Button>
                <Button
                  variant="block-link-gray"
                  size="xs"
                  className="ml-1"
                  to="mailto:nikolay@shelf.nu?subject=Advanced filtering suggestions"
                >
                  Need more filtering options?
                </Button>
              </div>
              <div className="ml-8 flex items-center justify-between gap-2">
                {filters.length > 0 && (
                  <Button
                    variant="block-link"
                    size="xs"
                    className="mt-0 whitespace-nowrap text-[14px]"
                    onClick={clearAllFilters}
                  >
                    Clear all
                  </Button>
                )}

                <SaveFilterButton hasUnappliedFilters={hasUnappliedChanges} />

                <Button
                  variant="secondary"
                  className="whitespace-nowrap text-[14px] font-medium"
                  size="xs"
                  disabled={!validation.canApplyFilters || disabled}
                  onClick={applyFilters}
                >
                  Apply filters
                </Button>
              </div>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

function AdvancedSorting() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [sorts, setSorts] = useState<Sort[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  const disabled = useDisabled();

  // Track if we're applying sorts internally to avoid resetting state
  const isApplyingInternally = useRef(false);

  // Track the last URL sort string we synced from to detect external changes
  const lastSyncedUrlSorts = useRef<string>("");

  useEffect(() => {
    // Get current URL sorts as string
    const currentUrlSorts = searchParams.getAll("sortBy").join(",");

    // Skip if URL hasn't changed or we're applying internally
    if (currentUrlSorts === lastSyncedUrlSorts.current) {
      return;
    }

    // Only sync from URL if we're not applying internally
    if (isApplyingInternally.current) {
      isApplyingInternally.current = false;
      lastSyncedUrlSorts.current = currentUrlSorts;
      return;
    }

    const parsedSorts = searchParams.getAll("sortBy").map((s) => {
      const [name, direction, cfType] = s.split(":");
      return { name, direction, cfType } as Sort;
    });
    setSorts(parsedSorts);
    lastSyncedUrlSorts.current = currentUrlSorts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const initialSorts = searchParams.getAll("sortBy").map((s) => {
    const [name, direction, cfType] = s.split(":");
    return { name, direction, cfType } as Sort;
  });

  const haveSortsChanged =
    JSON.stringify(initialSorts) !== JSON.stringify(sorts);

  function removeSort(columnName: Sort["name"]) {
    setSorts((prev) => prev.filter((s) => s.name !== columnName));
  }

  function applySorting() {
    isApplyingInternally.current = true;
    setSearchParams((prev) => {
      prev.delete("sortBy");

      // If no sorts, return search
      if (sorts.length === 0) {
        return prev;
      }

      // Append new sortBy parameters
      sorts.forEach((s) => {
        const sortA = [s.name, s.direction];
        if (s.name.startsWith("cf_") && s.cfType) {
          // we check for the cfType but we can already expect it will be preset because the field is a custom field
          sortA.push(s.cfType);
        }
        prev.append("sortBy", sortA.join(":"));
      });

      return prev;
    });
  }

  function clearAllSorts() {
    setSorts([]);
    /** If there are already sorts, clear them from the search params */
    if (searchParams.has("sortBy")) {
      isApplyingInternally.current = true;
      setSearchParams((prev) => {
        prev.delete("sortBy");
        return prev;
      });
    }
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={getTriggerClasses(isPopoverOpen, initialSorts.length)}
          icon="sort"
        >
          {/* We use the initial sorts, as we only count the ones returned from the server as those are already active filters */}
          {initialSorts.length > 0
            ? `Sorted by ${initialSorts.length}`
            : "Sort"}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[9999]  mt-2 w-[480px] rounded-md border border-gray-200 bg-white"
          )}
        >
          <div className="border-b p-4 pb-5">
            {sorts.length === 0 ? (
              <div>
                <h5>No sorting applied to this view</h5>
                <p>Add a column below to sort by</p>
              </div>
            ) : (
              <Reorder.Group values={sorts} onReorder={setSorts}>
                {sorts.map((s, index) => (
                  <Reorder.Item key={s.name} value={s}>
                    <div className="flex items-center justify-between">
                      <div className="flex h-full items-center gap-2 py-[6px]">
                        <div className="inline-block h-auto w-[10px] text-gray-500 hover:text-gray-600">
                          <HandleIcon />
                        </div>
                        <div className="mt-[-2px]">
                          <span className="text-gray-500 ">
                            {index === 0 ? "sort" : "then"} by
                          </span>{" "}
                          {parseColumnName(s.name)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`sort-${s.name}`}
                            className="text-[12px] text-gray-500"
                          >
                            ascending:{" "}
                          </label>
                          <Switch
                            id={`sort-${s.name}`}
                            checked={s.direction === "asc"}
                            onCheckedChange={() => {
                              setSorts((prev) => {
                                const newSorts = prev.map((sort, i) => {
                                  if (i === index) {
                                    return {
                                      ...sort,
                                      direction: (sort.direction === "asc"
                                        ? "desc"
                                        : "asc") as "asc" | "desc",
                                    };
                                  }
                                  return sort;
                                });
                                return newSorts;
                              });
                            }}
                            className="h-[18px] w-[33px] [&_span]:size-[16px]"
                          />
                        </div>
                        <Button
                          variant="block-link-gray"
                          className="mt-[2px] text-[10px] font-normal text-gray-600"
                          icon="x"
                          onClick={() => removeSort(s.name)}
                        />
                      </div>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <PickAColumnToSortBy sorts={sorts} setSorts={setSorts} />
            </div>
            <div className="flex items-center justify-between gap-4">
              {sorts.length > 0 && (
                <Button
                  variant="block-link"
                  size="xs"
                  className="mt-0 text-[14px]"
                  onClick={clearAllSorts}
                >
                  Clear all
                </Button>
              )}

              <Button
                variant="secondary"
                className="text-[14px] font-medium"
                size="xs"
                disabled={!haveSortsChanged || disabled}
                onClick={applySorting}
              >
                Apply sorting
              </Button>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function PickAColumnToSortBy({
  sorts,
  setSorts,
}: {
  sorts: Sort[];
  setSorts: Dispatch<SetStateAction<Sort[]>>;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const { settings } = useLoaderData<AssetIndexLoaderData>();
  const columns = settings.columns as Column[];
  const searchInputRef = useRef<HTMLInputElement>(null);

  const availableColumns = useMemo(
    () => getAvailableColumns(columns, sorts, "sort"),
    [columns, sorts]
  );

  // Convert to sort options with proper handling of the name column
  const baseOptions: Sort[] = useMemo(() => {
    const options = availableColumns.map((column) => ({
      name: column.name,
      direction: "asc" as const, // Use const assertion to specify literal type
      ...(column?.cfType ? { cfType: column.cfType } : undefined),
    }));

    if (!sorts.some((s) => s.name === "name")) {
      options.unshift({
        name: "name",
        direction: "asc" as const,
      });
    }

    return options.sort((a, b) => {
      if (a.name === "name") return -1;
      if (b.name === "name") return 1;
      return 0;
    });
  }, [availableColumns, sorts]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) return baseOptions;

    return baseOptions.filter((option) =>
      parseColumnName(option.name)
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
    );
  }, [baseOptions, searchQuery]);

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setSelectedIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
        event.preventDefault();
        if (filteredOptions[selectedIndex]) {
          addSort(filteredOptions[selectedIndex]);
        }
        break;
    }
  };

  const addSort = (column: Sort) => {
    setSorts((prev) => {
      const newCols = [...prev];
      newCols.push(column);
      return newCols;
    });
    setIsPopoverOpen(false);
    setSearchQuery("");
    setSelectedIndex(0);
  };

  useEffect(() => {
    const selectedElement = document.getElementById(
      `sort-option-${selectedIndex}`
    );
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="block-link-gray"
          className="text-[14px] font-normal text-gray-600"
          disabled={
            availableColumns.length === 0
              ? {
                  reason:
                    "You are not able to add more sorts because all columns are already used. If you want to sort by more columns, please enable them on your column settings.",
                }
              : false
          }
        >
          <span>Pick a column to sort by</span>{" "}
          <ChevronRight className="ml-2 inline-block rotate-90" />
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[9999] mt-2 max-h-[400px] w-[250px] overflow-scroll rounded-md border border-gray-200 bg-white"
          )}
        >
          <div className="flex items-center border-b">
            <Search className="ml-4 size-4 text-gray-500" />
            <input
              ref={searchInputRef}
              placeholder="Search column..."
              className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={handleSearch}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div>
            {filteredOptions.map((option, index) => (
              <div
                id={`sort-option-${index}`}
                key={option.name}
                className={tw(
                  "px-4 py-2 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  selectedIndex === index && [
                    "bg-gray-50",
                    "relative",
                    index !== 0 &&
                      "before:absolute before:inset-x-0 before:top-0 before:border-t before:border-gray-200",
                    index !== filteredOptions.length - 1 &&
                      "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200",
                  ]
                )}
                role="option"
                aria-selected={selectedIndex === index}
                tabIndex={0}
                onClick={() => addSort(option)}
                onKeyDown={handleActivationKeyPress(() => addSort(option))}
              >
                {parseColumnName(option.name)}
              </div>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-4 py-2 text-[14px] text-gray-500">
                No columns found
              </div>
            )}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
