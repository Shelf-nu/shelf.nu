import { useCallback, useEffect, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { Reorder } from "framer-motion";
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
import { tw } from "~/utils/tw";
import { FieldSelector } from "./advanced-filters/field-selector";
import { getFieldType, useInitialFilters } from "./advanced-filters/helpers";
import {
  operatorsPerType,
  OperatorSelector,
} from "./advanced-filters/operator-selector";
import type { Filter, FilterFieldType } from "./advanced-filters/types";
import { ValueField } from "./advanced-filters/value-field";

interface Sort {
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

const getTriggerClasses = (open: boolean, activeItems: number) =>
  tw(
    "text-gray-500",
    open ? "bg-gray-50" : "",
    activeItems > 0 ? "border-primary bg-primary-25 text-primary" : ""
  );

function AdvancedFilter() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const { settings } = useLoaderData<AssetIndexLoaderData>();
  const columns = settings.columns as Column[];
  const disabled = useDisabled();
  const [_searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<Filter[]>([]);
  const initialFilters = useInitialFilters(columns);

  // Set the intial filters
  useEffect(() => {
    setFilters(initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearAllFilters() {
    setFilters([]);
  }

  function applyFilters() {
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

      return prev;
    });
  }

  function addFilter() {
    setFilters((prev) => {
      const newCols = [...prev];
      newCols.push({
        name: columns[0].name,
        operator: "is",
        value: "",
        type: getFieldType({ column: columns[0] }) as FilterFieldType,
      });
      return newCols;
    });
  }
  const haveFiltersChanged = useCallback(
    () =>
      filters.some((filter, index) => {
        const initialFilter = initialFilters[index];
        if (
          !initialFilter ||
          filter.name !== initialFilter.name ||
          filter.operator !== initialFilter.operator
        ) {
          return true;
        }
        if (filter.type === "date") {
          // Compare date values
          const formatDate = (date: string) => date.split("T")[0]; // Remove time part
          if (
            Array.isArray(filter.value) &&
            Array.isArray(initialFilter.value)
          ) {
            return (
              formatDate(filter.value[0]) !==
                formatDate(initialFilter.value[0]) ||
              formatDate(filter.value[1]) !== formatDate(initialFilter.value[1])
            );
          } else {
            return (
              formatDate(filter.value as string) !==
              formatDate(initialFilter.value as string)
            );
          }
        }
        // For other types, you can use direct comparison
        return filter.value !== initialFilter.value;
      }),
    [filters, initialFilters]
  );
  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
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
            "z-[999999]  mt-2 w-[580px] rounded-md border border-gray-200 bg-white"
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
                {filters.map((filter, index) => (
                  <div
                    className="flex w-full items-start gap-1"
                    key={filter.name + index}
                  >
                    <div className="w-[150px] shrink-0">
                      <FieldSelector
                        filter={filter}
                        setFilter={(name) => {
                          // Update filter name
                          setFilters((prev) => {
                            const column = columns.find(
                              (c) => c.name === name
                            ) as Column;
                            const fieldType = getFieldType({
                              column,
                            }) as FilterFieldType;

                            const newFilters = [...prev];
                            newFilters[index].name = name;
                            newFilters[index].type = fieldType;
                            newFilters[index].operator =
                              operatorsPerType[fieldType][0];
                            return newFilters;
                          });
                        }}
                      />
                    </div>
                    <div className="w-[50px] shrink-0">
                      <OperatorSelector
                        filter={filter}
                        setFilter={(operator) => {
                          // Update filter operator
                          setFilters((prev) => {
                            const newFilters = [...prev];
                            newFilters[index].operator = operator;
                            return newFilters;
                          });
                        }}
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
                        }}
                        applyFilters={applyFilters}
                      />
                    </div>
                    <Button
                      variant="block-link-gray"
                      className="mt-[2px] shrink-0 text-[10px] font-normal text-gray-600"
                      icon="x"
                      onClick={() => {
                        setFilters((prev) =>
                          prev.filter((_, i) => i !== index)
                        );
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <Button
                variant="secondary"
                className="text-[14px]"
                size="xs"
                onClick={addFilter}
              >
                <div className="mr-1 inline-block size-[14px] align-middle">
                  <PlusIcon />
                </div>
                <span className="inline-block align-middle">Add filter</span>
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4">
              {filters.length > 0 && (
                <Button
                  variant="block-link"
                  size="xs"
                  className="mt-0 text-[14px]"
                  onClick={clearAllFilters}
                >
                  Clear all
                </Button>
              )}

              <Button
                variant="secondary"
                className="text-[14px]"
                size="xs"
                disabled={!haveFiltersChanged || disabled}
                onClick={applyFilters}
              >
                Apply filters
              </Button>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function AdvancedSorting() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [sorts, setSorts] = useState<Sort[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSorts = searchParams.getAll("sortBy").map((s) => {
    const [name, direction, fieldType] = s.split(":");
    return { name, direction, fieldType } as Sort;
  });
  const disabled = useDisabled();

  useEffect(() => {
    setSorts(initialSorts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const haveSortsChanged =
    JSON.stringify(initialSorts) !== JSON.stringify(sorts);

  function removeSort(columnName: Sort["name"]) {
    setSorts((prev) => prev.filter((s) => s.name !== columnName));
  }

  function applySorting() {
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
            "z-[999999]  mt-2 w-[480px] rounded-md border border-gray-200 bg-white"
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
                                const newSorts = [...prev];
                                newSorts[index].direction =
                                  s.direction === "asc" ? "desc" : "asc";
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
                className="text-[14px]"
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
  sorts: any[];
  setSorts: React.Dispatch<React.SetStateAction<Sort[]>>;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const { settings } = useLoaderData<AssetIndexLoaderData>();
  const columns = settings.columns;

  const columnsSortOptions: Sort[] = (columns as Column[])
    .filter((c) => !sorts.map((sort) => sort.name).includes(c.name))
    ?.map((column) => ({
      name: column.name,
      direction: "asc",
      ...(column?.cfType ? { cfType: column.cfType } : undefined),
    }));
  const nameOption: Sort = { name: "name", direction: "asc" };
  columnsSortOptions.splice(1, 0, nameOption);

  /** We need to remove unnecessary columns which dont make sense to sort by:
   * - tags
   */
  const tagsIndex = columnsSortOptions.findIndex((c) => c.name === "tags");
  if (tagsIndex > -1) {
    columnsSortOptions.splice(tagsIndex, 1);
  }

  /** Make sure name is always first */
  columnsSortOptions.sort((a, b) => {
    if (a.name === "name") {
      return -1;
    }
    if (b.name === "name") {
      return 1;
    }
    return 0;
  });

  function addSort(column: Sort) {
    setSorts((prev) => {
      const newCols = [...prev];
      newCols.push(column);
      return newCols;
    });
    setIsPopoverOpen(false);
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="block-link-gray"
          className="text-[14px] font-semibold text-gray-600"
        >
          <span>Pick a column to sort by</span>{" "}
          <ChevronRight className="ml-2 inline-block rotate-90" />{" "}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999] mt-2 h-[400px] w-[250px] overflow-scroll rounded-md border border-gray-200 bg-white"
          )}
        >
          <div className="">
            {columnsSortOptions.map((c) => (
              <div
                key={c.name}
                className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
                onClick={() => addSort(c)}
              >
                {parseColumnName(c.name)}
              </div>
            ))}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
