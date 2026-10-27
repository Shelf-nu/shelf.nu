import type { KeyboardEvent } from "react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronRight } from "~/components/icons/library";
import type { DisabledProp } from "~/components/shared/button";
import { Button } from "~/components/shared/button";
import { handleActivationKeyPress } from "~/utils/keyboard";
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
  isEmpty: ["∅", "Never audited"],
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

/**
 * Returns the operators a filter row offers, in display order.
 *
 * Starts from `operatorsPerType` for the row's field type, then applies the
 * per-column rules: `location` gets its own ordering (including hierarchy),
 * `type` only has two values so it is limited to is/isNot, and `lastAuditDate`
 * adds `isEmpty` ("Never audited") because an asset may have no audit at all.
 *
 * @param filter - The filter row to list operators for
 * @returns The operators to show in the operator selector
 */
export function getOperatorsForFilter(filter: Filter): FilterOperator[] {
  const baseOperators = operatorsPerType[filter.type];
  const locationOperatorOrder: FilterOperator[] = [
    "is",
    "withinHierarchy",
    "containsAny",
    "isNot",
  ];
  const typeOnlyOperators: FilterOperator[] = ["is", "isNot"];

  if (filter.name === "location") {
    return locationOperatorOrder.filter((op) => baseOperators.includes(op));
  }
  if (filter.name === "type") {
    return typeOnlyOperators;
  }
  const operators = baseOperators.filter((op) => op !== "withinHierarchy");
  return filter.name === "lastAuditDate"
    ? [...operators, "isEmpty"]
    : operators;
}

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

  // `filter.operator` is the source of truth from props; derive directly to avoid
  // a redundant useState/useEffect pair.
  const operator: FilterOperator | undefined = filter.operator;

  const operators = getOperatorsForFilter(filter);

  /**
   * Moves the keyboard highlight to the option at `index`, focuses it and
   * scrolls it into view. A focused row selects itself on Enter or Space, so
   * focus follows the highlight for those keys to act on the row the user
   * sees highlighted.
   */
  const highlightOption = (index: number) => {
    setSelectedIndex(index);
    const optionElement = document.getElementById(`operator-option-${index}`);
    optionElement?.focus();
    optionElement?.scrollIntoView({ block: "nearest" });
  };

  /**
   * Handle popover open/close. When opening, seed the highlighted index to the
   * currently-selected operator, in the event handler rather than an effect so
   * it is tied to the user action. `onOpenAutoFocus` then focuses that row.
   */
  const handleOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    if (open) {
      const currentIndex = operators.findIndex((op) => op === operator);
      setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  };

  const handleSelect = (operatorToSelect: FilterOperator) => {
    setFilter(operatorToSelect);
    setIsPopoverOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        highlightOption(
          selectedIndex < operators.length - 1
            ? selectedIndex + 1
            : selectedIndex
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        highlightOption(selectedIndex > 0 ? selectedIndex - 1 : selectedIndex);
        break;
      case "Enter":
      case " ": // Space key
        // A focused row selects itself; acting here too would pick twice.
        if (event.target !== event.currentTarget) break;
        event.preventDefault();
        handleSelect(operators[selectedIndex] as FilterOperator);
        break;
      case "Escape":
        event.preventDefault();
        setIsPopoverOpen(false);
        break;
    }
  };

  return operator ? (
    <Popover open={isPopoverOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          title={operatorsMap[operator][1]}
          className="w-[62px] font-normal"
          disabled={disabled}
        >
          <span className="flex items-center gap-3">
            <ChevronRight className="mt-px inline-block rotate-90 text-gray-600" />
            <span className="ml-[6px]">{operatorsMap[operator][0]}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999]  mt-2  rounded-md border border-gray-200 bg-white"
          )}
          onKeyDown={handleKeyDown}
          onOpenAutoFocus={(event) => {
            // Open on the current operator rather than the first row, so
            // focus and highlight agree.
            const option = document.getElementById(
              `operator-option-${selectedIndex}`
            );
            if (!option) return;
            event.preventDefault();
            option.focus();
            option.scrollIntoView({ block: "nearest" });
          }}
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
                role="option"
                aria-selected={selectedIndex === index}
                tabIndex={0}
                onClick={() => handleSelect(k as FilterOperator)}
                // Tab moves focus between rows too; keep the highlight on
                // the focused row.
                onFocus={() => setSelectedIndex(index)}
                onKeyDown={handleActivationKeyPress(() =>
                  handleSelect(k as FilterOperator)
                )}
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
