import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import type { DisabledProp } from "~/components/shared/button";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";
import type { Filter, FilterDefinition, FilterOperator } from "./schema";

function FilterOperatorDisplay({
  symbol,
  text,
}: {
  symbol: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[14px] ">
      <span className="font-semibold text-gray-500">{symbol}</span>
      <span className=" whitespace-nowrap font-normal">{text}</span>
    </div>
  );
}

/** Maps the FilterOperator to a user friendly name */
export const operatorsMap: Record<FilterOperator, string[]> = {
  is: ["=", "is"],
  isNot: ["≠", "Is not"],
  contains: ["∋", "Contains"],
  before: ["<", "Before"],
  after: [">", "After"],
  between: ["<>", "Between"],
  gt: [">", "Greater than"],
  lt: ["<", "Lower than"],
  gte: [">=", "Greater or equal"],
  lte: ["<=", "Lower or equal"],
  in: ["∈", "Is any of"],
  containsAll: ["⊇", "Contains all"],
  containsAny: ["⊃", "Contains any"],
  matchesAny: ["≈", "Matches any"],
  inDates: ["∈", "In dates"],
  excludeAny: ["⊄", "Exclude any of"], // New operator with clear meaning for tag exclusion
  withinHierarchy: ["↳", "Is in (incl. sub-locations)"],
};

// Define the allowed operators for each field type
export const operatorsPerType: FilterDefinition = {
  string: ["is", "isNot", "contains", "matchesAny", "containsAny"],
  text: ["contains", "matchesAny", "containsAny"],
  boolean: ["is"],
  date: ["is", "isNot", "before", "after", "between", "inDates"],
  number: ["is", "isNot", "gt", "lt", "gte", "lte", "between"],
  amount: ["is", "isNot", "gt", "lt", "gte", "lte", "between"],
  enum: ["is", "isNot", "containsAny", "withinHierarchy"],
  array: ["contains", "containsAll", "containsAny", "excludeAny"],
  customField: [], // empty array as customField operators are determined by the actual field type
};

export function OperatorSelector({
  filter,
  setFilter,
  disabled,
}: {
  filter: Filter;
  setFilter: (filter: Filter["operator"]) => void;
  disabled?: DisabledProp;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [operator, setOperator] = useState<FilterOperator>();
  useEffect(() => {
    setOperator(filter.operator);
  }, [filter.operator]);

  /** Get the correct operators, based on the field type */
  const baseOperators = operatorsPerType[filter.type];
  const locationOperatorOrder: FilterOperator[] = [
    "is",
    "withinHierarchy",
    "containsAny",
    "isNot",
  ];
  const operators =
    filter.name === "location"
      ? locationOperatorOrder.filter((op) => baseOperators.includes(op))
      : baseOperators.filter((op) => op !== "withinHierarchy");

  // Reset selected index when popover opens
  useEffect(() => {
    if (isPopoverOpen) {
      // Set initial selection to the current operator
      const currentIndex = operators.findIndex((op) => op === operator);
      setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isPopoverOpen, operator, operators]);

  const handleSelect = (operatorToSelect: FilterOperator) => {
    setFilter(operatorToSelect);
    setIsPopoverOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < operators.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
      case " ": // Space key
        event.preventDefault();
        handleSelect(operators[selectedIndex] as FilterOperator);
        break;
      case "Escape":
        event.preventDefault();
        setIsPopoverOpen(false);
        break;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (isPopoverOpen) {
      const selectedElement = document.getElementById(
        `operator-option-${selectedIndex}`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, isPopoverOpen]);

  return operator ? (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          title={operatorsMap[operator][1]}
          className="w-[50px] font-normal"
          disabled={disabled}
        >
          {operatorsMap[operator][0]}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999]  mt-2  rounded-md border border-gray-200 bg-white"
          )}
          onKeyDown={handleKeyDown}
        >
          {operators.map((operator, index) => {
            const k = operator as FilterOperator;
            const v = operatorsMap[k];
            return (
              <div
                id={`operator-option-${index}`}
                key={k + index}
                className={tw(
                  "px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  selectedIndex === index && "bg-gray-50"
                )}
                onClick={() => handleSelect(k as FilterOperator)}
              >
                <FilterOperatorDisplay symbol={v[0]} text={v[1]} />
              </div>
            );
          })}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  ) : null;
}
