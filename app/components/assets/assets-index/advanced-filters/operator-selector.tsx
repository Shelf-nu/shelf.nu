import React, { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";
import type { FilterOperator } from "./types";
import type { Filter } from "../advanced-asset-index-filters-and-sorting";

function FilterOperatorDisplay({
  symbol,
  text,
}: {
  symbol: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[14px] ">
      <span className="text-gray-500">{symbol}</span>
      <span className=" text-nowrap">{text}</span>
    </div>
  );
}

/** Maps the FilterOperator to a user friendly name */
const operatorsMap: Record<FilterOperator, React.ReactElement> = {
  is: <FilterOperatorDisplay symbol={"="} text={"is"} />,
  isNot: <FilterOperatorDisplay symbol={"≠"} text={"Is not"} />,
  contains: <FilterOperatorDisplay symbol={"∋"} text={"Contains"} />,
  before: <FilterOperatorDisplay symbol={"<"} text={"Before"} />,
  after: <FilterOperatorDisplay symbol={">"} text={"After"} />,
  between: <FilterOperatorDisplay symbol={"<>"} text={"Between"} />,
  gt: <FilterOperatorDisplay symbol={">"} text={"Greater than"} />,
  lt: <FilterOperatorDisplay symbol={"<"} text={"Lower than"} />,
  gte: <FilterOperatorDisplay symbol={">="} text={"Greater or equal"} />,
  lte: <FilterOperatorDisplay symbol={"<="} text={"Lower or equal"} />,
  in: <FilterOperatorDisplay symbol={"∈"} text={"Contains"} />,
  containsAll: <FilterOperatorDisplay symbol={"⊇"} text={"Contains all"} />,
  containsAny: <FilterOperatorDisplay symbol={"⊃"} text={"Contains any"} />,
};

export function OperatorSelector({
  filter,
  setFilter,
}: {
  filter: Filter;
  setFilter: (filter: Filter["operator"]) => void;
}) {
  const [operator, setOperator] = useState<FilterOperator>();
  useEffect(() => {
    setOperator(filter.operator);
  }, [filter.operator]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">
          {operatorsMap[operator as FilterOperator]}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999]  mt-2 w-[480px] rounded-md border border-gray-200 bg-white"
          )}
        >
          {Object.entries(operatorsMap).map(([_k, v], index) => (
            <div
              key={_k + index}
              className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
              onClick={() => setFilter(_k as FilterOperator)}
            >
              {v}
            </div>
          ))}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
