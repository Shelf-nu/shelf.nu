import { CaretSortIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "@remix-run/react";
import { useSearchParams } from "~/hooks/search-params";

import { isFormProcessing } from "~/utils/form";

type TSort = Record<string, string>;
export type SortingOptions = keyof TSort;
export type SortingDirection = "asc" | "desc";

type SortByProps<T extends TSort> = {
  sortingOptions: T;
  defaultSortingBy: keyof T;
  defaultSortingDirection?: SortingDirection;
};

export function SortBy<T extends Record<string, string>>({
  sortingOptions,
  defaultSortingBy,
  defaultSortingDirection = "desc",
}: SortByProps<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const orderBy = searchParams.get("orderBy") || String(defaultSortingBy);
  const orderDirection =
    searchParams.get("orderDirection") || defaultSortingDirection;

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  function onValueChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSearchParams((prev) => {
      prev.set(e.currentTarget.name, e.currentTarget.value);
      return prev;
    });
  }

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-2 text-gray-500"
        asChild
      >
        <button className="flex items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-[10px] text-[16px] text-gray-500 hover:cursor-pointer disabled:opacity-50">
          <span className="truncate whitespace-nowrap text-[14px]">
            {/* We only show the message if orderBy is present in params so in the default case we dont show it */}
            Sorted by: {sortingOptions[orderBy]}
          </span>
          <CaretSortIcon />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="end"
          className="z-[100]  flex flex-col gap-3 overflow-y-auto rounded-md border border-gray-300 bg-white p-4"
        >
          <div>
            <h5>Sort by:</h5>
          </div>

          <div className="flex flex-col gap-2">
            <select
              className="w-full border-gray-300 text-[14px] text-gray-500"
              onChange={onValueChange}
              name="orderBy"
              defaultValue={orderBy}
              disabled={disabled}
            >
              {Object.entries(sortingOptions).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <select
              className="border-gray-300 text-[14px] text-gray-500"
              name="orderDirection"
              disabled={disabled}
              defaultValue={orderDirection}
              onChange={onValueChange}
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
