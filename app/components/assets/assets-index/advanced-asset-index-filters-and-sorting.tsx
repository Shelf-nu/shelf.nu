import { useEffect, useState } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { Reorder } from "framer-motion";
import { Switch } from "~/components/forms/switch";
import { ChevronRight, HandleIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import {
  parseColumnName,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";

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

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className={getTriggerClasses(isPopoverOpen, 0)}
          icon="filter"
        >
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "mt-2 w-[480px] rounded-md border border-gray-200 bg-white p-3"
          )}
        >
          Hello
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

  function removeSort(columnValue: Sort) {
    setSorts((prev) => prev.filter((s) => s !== columnValue));
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

      return searchParams;
    });
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
                          onClick={() => removeSort(s)}
                        />
                      </div>
                    </div>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3">
            <PickAColumnToSortBy sorts={sorts} setSorts={setSorts} />
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
