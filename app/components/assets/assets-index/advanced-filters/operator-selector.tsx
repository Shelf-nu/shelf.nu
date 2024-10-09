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
    <div className="flex items-center text-[14px] ">
      <span className="text-gray-500">{symbol}</span>
      <span>{text}</span>
    </div>
  );
}

/** Maps the FilterOperator to a user friendly name */
const operatorsMap: Record<FilterOperator, React.ReactElement> = {
  is: <FilterOperatorDisplay symbol={"="} text={"is"} />,
  isNot: <FilterOperatorDisplay symbol={"≠"} text={"isNot"} />,
  contains: <FilterOperatorDisplay symbol={"∋"} text={"contains"} />,
  before: <FilterOperatorDisplay symbol={"<"} text={"before"} />,
  after: <FilterOperatorDisplay symbol={">"} text={"after"} />,
  between: <FilterOperatorDisplay symbol={"<>"} text={"between"} />,
  gt: <FilterOperatorDisplay symbol={">"} text={"gt"} />,
  lt: <FilterOperatorDisplay symbol={"<"} text={"lt"} />,
  gte: <FilterOperatorDisplay symbol={">="} text={"gte"} />,
  lte: <FilterOperatorDisplay symbol={"<="} text={"lte"} />,
  in: <FilterOperatorDisplay symbol={"∈"} text={"in"} />,
  containsAll: <FilterOperatorDisplay symbol={"⊇"} text={"containsAll"} />,
  containsAny: <FilterOperatorDisplay symbol={"⊃"} text={"containsAny"} />,
};

export function OperatorSelector(filter: Filter) {
  const [operator, setOperator] = useState<FilterOperator>();
  useEffect(() => {
    setOperator(filter.operator);
  }, [filter.operator]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">{operatorsMap[operator]}</Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999]  mt-2 w-[480px] rounded-md border border-gray-200 bg-white"
          )}
        >
          {Object.entries(operatorsMap).map(([_k, v]) => v)}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
