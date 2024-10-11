import { useEffect, useState } from "react";
import { AssetStatus } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import Input from "~/components/forms/input";

import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { filterSchema } from "./schema";
import type { Filter } from "./types";
import { userFriendlyAssetStatus } from "../../asset-status-badge";

export function ValueField({
  filter,
  setFilter,
}: {
  filter: Filter;
  setFilter: (value: Filter["value"]) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    validateFilter(filter);
  }, [filter]);

  function validateFilter(filter: Filter) {
    const result = filterSchema.safeParse(filter);
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    if (filter.operator === "between" && Array.isArray(filter.value)) {
      const [start, end] = filter.value;
      if (
        start !== "" &&
        end !== "" &&
        start !== undefined &&
        end !== undefined
      ) {
        if (filter.type === "date") {
          const startDate = new Date(start);
          const endDate = new Date(end);
          if (
            !isNaN(startDate.getTime()) &&
            !isNaN(endDate.getTime()) &&
            startDate > endDate
          ) {
            setError("Start date must be before or equal to end date");
            return;
          }
        } else if (filter.type === "number") {
          const startNum = parseFloat(start);
          const endNum = parseFloat(end);
          if (!isNaN(startNum) && !isNaN(endNum) && startNum > endNum) {
            setError("Start value must be less than or equal to end value");
            return;
          }
        }
      }
    }

    setError(null);
  }
  function handleChange(
    event: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) {
    const newValue = event.target.value;
    setFilter(newValue);
    validateFilter({ ...filter, value: newValue });
  }

  function handleBooleanChange(value: "true" | "false") {
    const newValue = value === "true";
    setFilter(newValue);
    validateFilter({ ...filter, value: newValue });
  }

  function handleBetweenChange(index: 0 | 1) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = [
        ...(Array.isArray(filter.value) ? filter.value : [null, null]),
      ] as [string, string];
      newValue[index] = event.target.value;
      setFilter(newValue);
      validateFilter({ ...filter, value: newValue });
    };
  }

  const commonInputProps = {
    inputClassName: "px-4 py-2 text-[14px] leading-5",
    hideLabel: true,
    label: filter.name,
  };

  switch (filter.type) {
    case "string":
    case "text":
      return (
        <Input
          type="text"
          value={filter.value as string}
          onChange={handleChange}
          placeholder="Enter value"
          {...commonInputProps}
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
                value={Array.isArray(filter.value) ? filter.value[0] || "" : ""}
                onChange={handleBetweenChange(0)}
                className="w-1/2"
              />
              <Input
                {...commonInputProps}
                label="End Value"
                type="number"
                value={Array.isArray(filter.value) ? filter.value[1] || "" : ""}
                onChange={handleBetweenChange(1)}
                className="w-1/2"
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
            type="number"
            value={filter.value as number}
            onChange={handleChange}
            placeholder="Enter number"
            {...commonInputProps}
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
      if (filter.operator === "between") {
        return (
          <div className="space-y-2">
            <div className="flex max-w-full items-center justify-normal gap-[2px]">
              <Input
                {...commonInputProps}
                label="Start Date"
                type="date"
                value={Array.isArray(filter.value) ? filter.value[0] || "" : ""}
                onChange={handleBetweenChange(0)}
                className="w-1/2"
              />
              <Input
                {...commonInputProps}
                label="End Date"
                type="date"
                value={Array.isArray(filter.value) ? filter.value[1] || "" : ""}
                onChange={handleBetweenChange(1)}
                className="w-1/2"
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
            label="Date"
            type="date"
            value={filter.value as string}
            onChange={handleChange}
          />
        );
      }

    case "enum":
      return (
        <EnumField
          value={filter.value as string}
          fieldName={filter.name}
          handleChange={(value: string) => {
            setFilter(value);
            validateFilter({ ...filter, value });
          }}
        />
      );

    case "array":
      return (
        <Input
          {...commonInputProps}
          type="text"
          label="Values"
          value={
            Array.isArray(filter.value) ? filter.value.join(", ") : filter.value
          }
          onChange={(e) => {
            const newValue = e.target.value
              .split(",")
              .map((item) => item.trim());
            setFilter(newValue);
            validateFilter({ ...filter, value: newValue });
          }}
          placeholder="Enter comma-separated values"
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
  value: boolean;
  handleBooleanChange: (value: "true" | "false") => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  return (
    <>
      <input type="hidden" value={String(value)} />
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap [&_span]:max-w-full [&_span]:truncate"
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">
              {value === undefined ? "Select value" : value ? "Yes" : "No"}
            </span>{" "}
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
}: {
  fieldName: string;
  value: string;
  handleChange: (value: string) => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const data = useLoaderData<AssetIndexLoaderData>();
  const customFields = data?.customFields || [];
  const isStatusField = fieldName === "status";

  const options = isStatusField
    ? Object.values(AssetStatus)
    : customFields.find((field) => field?.name === fieldName.slice(3))
        ?.options || [];

  const displayValue =
    value === ""
      ? "Select option"
      : isStatusField
      ? userFriendlyAssetStatus(value as AssetStatus)
      : value;

  function Content() {
    if (options.length === 0) {
      return (
        <div className="max-w-[400px] p-4">
          There are no options defined for this custom field. If you think this
          is a bug, please report the issue so it can get resolved.
        </div>
      );
    }

    return options.map((option) => (
      <div
        key={option}
        className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
        onClick={() => {
          handleChange(option);
          setIsPopoverOpen(false);
        }}
      >
        <span>
          {isStatusField
            ? userFriendlyAssetStatus(option as AssetStatus)
            : option}
        </span>
      </div>
    ));
  }

  return (
    <>
      <input type="hidden" value={value} />
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
              "z-[999999] mt-2 max-h-[400px] min-w-[100px] overflow-scroll rounded-md border border-gray-200 bg-white"
            )}
          >
            <Content />
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}
