import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetStatus } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { format, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import Input from "~/components/forms/input";

import { CheckIcon, ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { useHints } from "~/utils/client-hints";
import { tw } from "~/utils/tw";
import type { Filter } from "./schema";
import { userFriendlyAssetStatus } from "../../asset-status-badge";

export function ValueField({
  filter,
  setFilter,
  applyFilters,
}: {
  filter: Filter;
  setFilter: (value: Filter["value"]) => void;
  applyFilters: () => void;
}) {
  const data = useLoaderData<AssetIndexLoaderData>();
  const customFields = useMemo(() => data?.customFields || [], [data]);
  const [localValue, setLocalValue] = useState<[string, string]>(
    Array.isArray(filter.value) ? (filter.value as [string, string]) : ["", ""]
  );
  const [error, setError] = useState<string | null>(null);
  const validateBetweenFilter = useCallback(() => {
    if (filter.operator === "between") {
      const [start, end] = localValue;
      if (start !== "" && end !== "") {
        if (filter.type === "date") {
          const startDate = new Date(start);
          const endDate = new Date(end);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            if (startDate > endDate) {
              setError("Start date must be before or equal to end date");
              return;
            }
          }
        } else if (filter.type === "number") {
          const startNum = parseFloat(start);
          const endNum = parseFloat(end);
          if (!isNaN(startNum) && !isNaN(endNum)) {
            if (startNum > endNum) {
              setError("Start value must be less than or equal to end value");
              return;
            }
          }
        }
      }
    }
    setError(null);
  }, [filter.operator, filter.type, localValue]);

  useEffect(() => {
    validateBetweenFilter();
  }, [localValue, validateBetweenFilter]);

  useEffect(() => {
    if (filter.type === "boolean" && filter.value === "") {
      setFilter(true); // Set default value to true when boolean field is selected
    }

    if (filter.type === "enum" && filter.value === "") {
      const options =
        filter.name === "status"
          ? Object.values(AssetStatus)
          : customFields.find((field) => field?.name === filter.name.slice(3))
              ?.options || [];
      setFilter(options[0]); // Set default value to first option when enum field is selected
    }
  }, [customFields, filter.name, filter.type, filter.value, setFilter]);

  function handleChange(
    event: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) {
    const newValue = event.target.value;
    setFilter(newValue);
  }

  function handleBooleanChange(value: "true" | "false") {
    const newValue = value === "true";
    setFilter(newValue);
  }

  function handleBetweenChange(index: 0 | 1) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = [...localValue] as [string, string];
      newValue[index] = event.target.value;
      setLocalValue(newValue);
      if (newValue[0] !== "" && newValue[1] !== "") {
        setFilter(newValue);
      }
    };
  }

  const commonInputProps = {
    inputClassName: "px-4 py-2 text-[14px] leading-5",
    hideLabel: true,
    label: filter.name,
  };

  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      applyFilters();
    }
  };

  /** Generates placeholder for text input fields, based on the operator */
  function placeholder(operator: Filter["operator"]) {
    return ["contains", "containsAll", "containsAny", "matchesAny"].includes(
      operator
    )
      ? "Enter comma-separated values"
      : "Enter value";
  }

  switch (filter.type) {
    case "string":
    case "text":
      return (
        <Input
          {...commonInputProps}
          type="text"
          value={filter.value as string}
          onChange={handleChange}
          placeholder={placeholder(filter.operator)}
          onKeyUp={submitOnEnter}
        />
      );

    case "number":
      if (filter.operator === "between") {
        return (
          <div className="space-y-2">
            <div className="flex max-w-full items-center justify-normal gap-[2px]">
              <Input
                {...commonInputProps}
                label="Start Value"
                type="number"
                value={localValue[0]}
                onChange={handleBetweenChange(0)}
                className="w-1/2"
                min={0}
                onKeyUp={submitOnEnter}
              />
              <Input
                {...commonInputProps}
                label="End Value"
                type="number"
                value={localValue[1]}
                onChange={handleBetweenChange(1)}
                className="w-1/2"
                min={0}
                onKeyUp={submitOnEnter}
              />
            </div>
            {error && (
              <div className="!mt-0 text-[12px] text-red-500">{error}</div>
            )}
          </div>
        );
      } else {
        return (
          <Input
            {...commonInputProps}
            type="number"
            value={filter.value as number}
            onChange={handleChange}
            placeholder="Enter number"
            min={0}
            onKeyUp={submitOnEnter}
          />
        );
      }

    case "boolean":
      return (
        <BooleanField
          value={filter.value as boolean}
          handleBooleanChange={handleBooleanChange}
        />
      );

    case "date":
      return (
        <DateField
          filter={filter}
          setFilter={setFilter}
          applyFilters={applyFilters}
        />
      );

    case "enum":
      return (
        <EnumField
          value={filter.value as string}
          fieldName={filter.name}
          handleChange={(value: string) => {
            setFilter(value);
          }}
          multiSelect={filter.operator === "in"}
        />
      );

    case "array":
      return (
        <Input
          {...commonInputProps}
          type="text"
          label="Values"
          value={
            Array.isArray(filter.value)
              ? filter.value.join(", ")
              : typeof filter.value === "boolean"
              ? "yes" // provide a default value for booleans
              : filter.value
          }
          onChange={(e) => {
            const newValue = e.target.value
              .split(",")
              .map((item) => item.trim());
            setFilter(newValue);
          }}
          placeholder={placeholder(filter.operator)}
          onKeyUp={submitOnEnter}
        />
      );

    default:
      return null;
  }
}

function BooleanField({
  value,
  handleBooleanChange,
}: {
  value: boolean | string;
  handleBooleanChange: (value: "true" | "false") => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const boolValue = value === "" ? true : value === "true" || value === true;

  return (
    <>
      <input type="hidden" value={String(boolValue)} />
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap [&_span]:max-w-full [&_span]:truncate"
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">{boolValue ? "Yes" : "No"}</span>{" "}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] min-w-[100px] overflow-scroll rounded-md border border-gray-200 bg-white"
            )}
          >
            <div
              className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
              onClick={() => {
                handleBooleanChange("true");
                setIsPopoverOpen(false);
              }}
            >
              <span>Yes</span>
            </div>
            <div
              className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
              onClick={() => {
                handleBooleanChange("false");
                setIsPopoverOpen(false);
              }}
            >
              <span>No</span>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

function EnumField({
  fieldName,
  value,
  handleChange,
  multiSelect = false,
}: {
  fieldName: string;
  value: string;
  handleChange: (value: string) => void;
  multiSelect?: boolean;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const data = useLoaderData<AssetIndexLoaderData>();
  const customFields = data?.customFields || [];
  const isStatusField = fieldName === "status";

  const options = isStatusField
    ? Object.values(AssetStatus)
    : customFields.find((field) => field?.name === fieldName.slice(3))
        ?.options || [];

  // Convert the value into an array for multi-select mode
  const selectedValues = multiSelect ? value.split(", ") : [value];

  const displayValue = multiSelect
    ? selectedValues
        .map((v) =>
          isStatusField ? userFriendlyAssetStatus(v as AssetStatus) : v
        )
        .join(", ")
    : value === ""
    ? options[0]
    : isStatusField
    ? userFriendlyAssetStatus(value as AssetStatus)
    : value;

  function handleOptionClick(option: string) {
    let newValue: string;

    if (multiSelect) {
      const isSelected = selectedValues.includes(option);
      const updatedValues = isSelected
        ? selectedValues.filter((val) => val !== option)
        : [...selectedValues, option];
      newValue = updatedValues.join(", ");
    } else {
      newValue = option;
    }

    handleChange(newValue);
    if (!multiSelect) {
      setIsPopoverOpen(false); // Close popover for single-select
    }
  }

  function Content() {
    if (options.length === 0) {
      return (
        <div className="max-w-[400px] p-4">
          There are no options defined for this custom field. If you think this
          is a bug, please report the issue so it can get resolved.
        </div>
      );
    }

    return options.map((option) => {
      const isSelected = selectedValues.includes(option);
      return (
        <div
          key={option}
          className="flex items-center justify-between px-4 py-3 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
          onClick={() => handleOptionClick(option)}
        >
          <span>
            {isStatusField
              ? userFriendlyAssetStatus(option as AssetStatus)
              : option}
          </span>
          {multiSelect && isSelected && (
            <span className="h-auto w-[14px] text-primary">
              <CheckIcon />
            </span>
          )}
        </div>
      );
    });
  }

  return (
    <>
      <input type="hidden" value={multiSelect ? displayValue : value} />
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap [&_span]:max-w-full [&_span]:truncate"
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">{displayValue}</span>{" "}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] min-w-[250px] overflow-scroll rounded-md border border-gray-200 bg-white"
            )}
          >
            <Content />
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

// Define the props for the DateField component
type DateFieldProps = {
  filter: Filter;
  setFilter: (value: Filter["value"]) => void;
  applyFilters: () => void;
};

function isDateString(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const date = parseISO(value);
  return !isNaN(date.getTime());
}

/**
 * DateField component for handling date-based filters
 * Supports both single date and date range selections
 */
export function DateField({ filter, setFilter, applyFilters }: DateFieldProps) {
  const { timeZone } = useHints();
  const [localValue, setLocalValue] = useState<[string, string]>(["", ""]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function adjustDateToUserTimezone(dateString: string): string {
      const date = toZonedTime(parseISO(dateString), timeZone);
      return format(date, "yyyy-MM-dd");
    }

    if (Array.isArray(filter.value)) {
      const start = isDateString(filter.value[0])
        ? filter.value[0]
        : String(filter.value[0]);
      const end = isDateString(filter.value[1])
        ? filter.value[1]
        : String(filter.value[1]);
      setLocalValue([
        adjustDateToUserTimezone(start),
        adjustDateToUserTimezone(end),
      ]);
    } else {
      const value = isDateString(filter.value)
        ? filter.value
        : String(filter.value);
      setLocalValue([adjustDateToUserTimezone(value), ""]);
    }
  }, [filter.value, timeZone]);

  function adjustDateToUTC(dateString: string): string {
    const zonedDate = toZonedTime(parseISO(dateString), timeZone);
    const utcDate = fromZonedTime(zonedDate, timeZone);
    return format(utcDate, "yyyy-MM-dd");
  }

  function handleDateChange(index: 0 | 1) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = [...localValue] as [string, string];
      newValue[index] = event.target.value;
      setLocalValue(newValue);

      if (filter.operator === "between" && newValue[0] && newValue[1]) {
        setFilter([adjustDateToUTC(newValue[0]), adjustDateToUTC(newValue[1])]);
      } else if (filter.operator !== "between" && newValue[0]) {
        setFilter(adjustDateToUTC(newValue[0]));
      }
      validateDates(newValue);
    };
  }

  function validateDates([start, end]: [string, string]) {
    if (start && end) {
      const startDate = parseISO(start);
      const endDate = parseISO(end);
      if (startDate > endDate) {
        setError("Start date must be before or equal to end date");
      } else {
        setError(null);
      }
    } else {
      setError(null);
    }
  }

  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !error) {
      applyFilters();
    }
  };

  const commonInputProps = {
    inputClassName: "px-4 py-2 text-[14px] leading-5",
    hideLabel: true,
    label: filter.name,
    onKeyUp: submitOnEnter,
  };

  if (filter.operator === "between") {
    return (
      <div className="space-y-2">
        <div className="flex max-w-full items-center justify-normal gap-[2px]">
          <Input
            {...commonInputProps}
            label="Start Date"
            type="date"
            value={localValue[0]}
            onChange={handleDateChange(0)}
            className="w-1/2"
          />
          <Input
            {...commonInputProps}
            label="End Date"
            type="date"
            value={localValue[1]}
            onChange={handleDateChange(1)}
            className="w-1/2"
          />
        </div>
        {error && localValue[0] !== "" && localValue[1] !== "" && (
          <div className="!mt-0 text-[12px] text-red-500">{error}</div>
        )}
      </div>
    );
  } else {
    return (
      <Input
        {...commonInputProps}
        type="date"
        value={localValue[0]}
        onChange={handleDateChange(0)}
      />
    );
  }
}
