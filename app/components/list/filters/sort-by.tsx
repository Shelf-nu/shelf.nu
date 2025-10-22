import { useId } from "react";
import { CaretSortIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "@remix-run/react";

import { useSearchParams } from "~/hooks/search-params";
import { useIsMobile } from "~/hooks/use-mobile";

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
  const orderByLabel =
    sortingOptions[orderBy as keyof T] ?? sortingOptions[defaultSortingBy];

  const isMobile = useIsMobile();
  const selectId = useId();
  const orderById = `${selectId}-order-by`;
  const orderDirectionId = `${selectId}-order-direction`;

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

  if (isMobile) {
    return (
      <div
        className={tw(
          "flex flex-col gap-3 rounded-md border border-gray-300 bg-white p-4",
          className
        )}
      >
        <div>
          <h5>Sort by:</h5>
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="text-[12px] font-medium uppercase text-gray-400"
            htmlFor={orderById}
          >
            Sort column
          </label>
          <select
            id={orderById}
            className="w-full border-gray-300 text-[14px] text-gray-500"
            name="orderBy"
            disabled={disabled}
            value={orderBy}
            onChange={(event) =>
              updateSearchParam("orderBy", event.currentTarget.value)
            }
          >
            {Object.entries(sortingOptions).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <label
            className="text-[12px] font-medium uppercase text-gray-400"
            htmlFor={orderDirectionId}
          >
            Sort direction
          </label>
          <select
            id={orderDirectionId}
            className="border-gray-300 text-[14px] text-gray-500"
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
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        className={tw(
          "inline-flex items-center gap-2 text-gray-500",
          className
        )}
        asChild
      >
        <button
          className="flex items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-[10px] text-[16px] text-gray-500 hover:cursor-pointer disabled:opacity-50"
          type="button"
          disabled={disabled}
        >
          <span className="truncate whitespace-nowrap text-[14px]">
            {/* We only show the message if orderBy is present in params so in the default case we dont show it */}
            Sorted by: {orderByLabel}
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
              name="orderBy"
              disabled={disabled}
              value={orderBy}
              onChange={(event) =>
                updateSearchParam("orderBy", event.currentTarget.value)
              }
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
