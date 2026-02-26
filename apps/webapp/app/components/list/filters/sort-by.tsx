import { CaretSortIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "react-router";

import { useSearchParams } from "~/hooks/search-params";

import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";

type TSort = Record<string, string>;
export type SortingOptions = keyof TSort;
export type SortingDirection = "asc" | "desc";

type SortByProps<T extends TSort> = {
  sortingOptions: T;
  defaultSortingBy: keyof T;
  defaultSortingDirection?: SortingDirection;
  className?: string;
};

export function SortBy<T extends Record<string, string>>({
  className,
  sortingOptions,
  defaultSortingBy,
  defaultSortingDirection = "desc",
}: SortByProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawOrderBy = searchParams.get("orderBy") || String(defaultSortingBy);
  const rawOrderDirection =
    searchParams.get("orderDirection") || defaultSortingDirection;

  const isOrderByValid = Object.prototype.hasOwnProperty.call(
    sortingOptions,
    rawOrderBy
  );

  const orderBy = isOrderByValid ? rawOrderBy : String(defaultSortingBy);
  const orderDirection =
    rawOrderDirection === "asc" || rawOrderDirection === "desc"
      ? rawOrderDirection
      : defaultSortingDirection;

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  function updateSearchParam(
    name: "orderBy" | "orderDirection",
    value: string
  ) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set(name, value);
      return next;
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        className={tw(
          "inline-flex items-center gap-2 text-color-500",
          className
        )}
        asChild
      >
        <button
          className="flex items-center justify-between whitespace-nowrap rounded border border-color-300 px-[14px] py-[10px] text-[16px] text-color-500 hover:cursor-pointer disabled:opacity-50"
          type="button"
          disabled={disabled}
        >
          <span className="truncate whitespace-nowrap text-[14px]">
            Sorted by: {sortingOptions[orderBy as keyof T]}
          </span>
          <CaretSortIcon />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className="z-[100]  flex flex-col gap-3 overflow-y-auto rounded-md border border-color-300 bg-surface p-4"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div>
            <h5>Sort by:</h5>
          </div>

          <div className="flex flex-col gap-2">
            <select
              className="w-full border-color-300 text-[14px] text-color-500"
              name="orderBy"
              disabled={disabled}
              value={orderBy}
              onChange={(event) =>
                updateSearchParam("orderBy", event.currentTarget.value)
              }
            >
              {Object.entries(sortingOptions).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select
              className="border-color-300 text-[14px] text-color-500"
              name="orderDirection"
              disabled={disabled}
              value={orderDirection}
              onChange={(event) =>
                updateSearchParam("orderDirection", event.currentTarget.value)
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
