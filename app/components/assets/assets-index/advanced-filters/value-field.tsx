import { useCallback, useEffect, useMemo, useState } from "react";
import { AssetStatus } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { parseISO } from "date-fns";
import { useLoaderData } from "react-router";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import Input from "~/components/forms/input";

import {
  CheckIcon,
  ChevronRight,
  HelpIcon,
  PlusIcon,
} from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { useHints } from "~/utils/client-hints";
import {
  adjustDateToUserTimezone,
  adjustDateToUTC,
  isDateString,
} from "~/utils/date-fns";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { extractQrIdFromValue } from "./helpers";
import type { Filter } from "./schema";
import { userFriendlyAssetStatus } from "../../asset-status-badge";

export function ValueField({
  filter,
  setFilter,
  applyFilters,
  fieldName, // From zorm
  zormError, // From zorm
  disabled,
}: {
  filter: Filter;
  setFilter: (value: Filter["value"]) => void;
  applyFilters: () => void;
  fieldName: string;
  zormError?: string;
  disabled?: boolean;
}) {
  const data = useLoaderData<AssetIndexLoaderData>();
  const customFields = useMemo(() => data?.customFields || [], [data]);
  const [localValue, setLocalValue] = useState<[string, string]>(
    Array.isArray(filter.value) ? (filter.value as [string, string]) : ["", ""]
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const validateBetweenFilter = useCallback(() => {
    if (filter.operator === "between") {
      const [start, end] = localValue;
      if (start !== "" && end !== "") {
        if (filter.type === "date") {
          const startDate = new Date(start);
          const endDate = new Date(end);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            if (startDate > endDate) {
              setLocalError("Start date must be before or equal to end date");
              return;
            }
          }
        } else if (filter.type === "number" || filter.type === "amount") {
          const startNum = parseFloat(start);
          const endNum = parseFloat(end);
          if (!isNaN(startNum) && !isNaN(endNum)) {
            // For AMOUNT fields, enforce start <= end since amounts are always positive
            if (filter.type === "amount" && startNum > endNum) {
              setLocalError(
                "Start value must be less than or equal to end value"
              );
              return;
            }
            // For NUMBER fields, no validation needed - any numeric range is valid
            // This allows ranges like "50 to -50" or "-100 to 100"
          }
        }
      }
    }
    setLocalError(null);
  }, [filter.operator, filter.type, localValue]);

  // Use a combined error that takes both into account
  const error = useMemo(() => {
    // If there's a local validation error from validateBetweenFilter, show that
    if (localError) return localError;
    // Otherwise show any zorm validation error
    return zormError;
  }, [localError, zormError]);

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
        // For number and amount fields, sort the values to ensure backend gets [min, max]
        if (filter.type === "number" || filter.type === "amount") {
          const num1 = parseFloat(newValue[0]);
          const num2 = parseFloat(newValue[1]);
          if (!isNaN(num1) && !isNaN(num2)) {
            const sortedValues: [number, number] = [
              Math.min(num1, num2),
              Math.max(num1, num2),
            ];
            setFilter(sortedValues);
            return;
          }
        }
        setFilter(newValue);
      }
    };
  }

  const commonInputProps = {
    inputClassName: "px-4 py-2 text-[14px] leading-5",
    hideLabel: true,
    hideMd: true,
    label: filter.name,
    disabled,
  };

  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !disabled) {
      applyFilters();
    }
  };

  /** Generates placeholder for text input fields, based on the operator */
  function placeholder(operator: Filter["operator"]) {
    if (disabled) return "Select a column first";
    return ["contains", "containsAll", "containsAny", "matchesAny"].includes(
      operator
    )
      ? "Enter comma-separated values"
      : "Enter value";
  }

  // Add error display for components that don't support error prop
  const ErrorDisplay = ({ error }: { error?: string }) =>
    error ? <div className="mt-1 text-sm text-red-500">{error}</div> : null;
  switch (filter.type) {
    case "string":
    case "text":
      if (filter.name === "qrId") {
        return (
          <div className={tw("flex w-full md:w-auto")}>
            <div className="relative flex-1">
              <Input
                {...commonInputProps}
                type="text"
                value={filter.value as string}
                onChange={(e) => {
                  setFilter(e.target.value);
                }}
                placeholder={placeholder(filter.operator)}
                onKeyUp={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter") {
                    setTimeout(() => {
                      // Assert the target as HTMLInputElement to access value
                      const input = e.target as HTMLInputElement;
                      const cleanValue = extractQrIdFromValue(input.value);
                      setFilter(cleanValue);
                      // Create a new keyboard event for submitOnEnter
                      submitOnEnter(e as React.KeyboardEvent<HTMLInputElement>);
                    }, 10);
                  }
                }}
                error={error}
                name={fieldName}
              />
              {!["contains", "containsAny", "matchesAny"].includes(
                filter.operator
              ) ? (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <i className="absolute right-3.5 top-1/2 flex -translate-y-1/2 cursor-pointer text-gray-600 hover:text-gray-700">
                        <HelpIcon />
                      </i>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="z-[9999999]">
                      <div className="max-w-[260px] sm:max-w-[320px]">
                        <h6 className="mb-1 text-xs font-semibold text-gray-700">
                          Barcode scanner ready
                        </h6>
                        <p className="text-xs font-medium text-gray-500">
                          This fields supports barcode scanners. Simply place
                          your cursor in the field and scan a Shelf QR code with
                          your barcode scanner. The value will be automatically
                          filled in for you.
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </div>
        );
      }
      if (
        filter.name === "sequentialId" &&
        ["is", "isNot"].includes(filter.operator) &&
        !filter.isNew
      ) {
        return (
          <div className="relative">
            <div className="absolute left-2 top-1/2 z-50 -translate-y-1/2 text-gray-500">
              SAM-
            </div>
            <Input
              {...commonInputProps}
              type="text"
              value={(filter.value as string).split("SAM-")[1]}
              onChange={(e) => {
                const newValue = e.target.value;
                setFilter(newValue !== "" ? `SAM-${newValue}` : "");
              }}
              placeholder={placeholder(filter.operator)}
              onKeyUp={submitOnEnter}
              error={error}
              inputClassName={tw(commonInputProps.inputClassName, "pl-[44px]")}
            />
          </div>
        );
      }
      return (
        <Input
          {...commonInputProps}
          type="text"
          value={filter.value as string}
          onChange={handleChange}
          placeholder={placeholder(filter.operator)}
          onKeyUp={submitOnEnter}
          error={error}
          name={fieldName}
        />
      );

    case "amount":
      if (filter.operator === "between") {
        return (
          <div className="space-y-2">
            <div className="flex max-w-full items-center justify-normal gap-[2px]">
              <Input
                {...commonInputProps}
                type="number"
                value={localValue[0]}
                onChange={handleBetweenChange(0)}
                className="w-1/2"
                name={`${fieldName}_start`}
                min={0}
                onKeyUp={submitOnEnter}
              />
              <Input
                {...commonInputProps}
                type="number"
                value={localValue[1]}
                onChange={handleBetweenChange(1)}
                className="w-1/2"
                min={0}
                name={`${fieldName}_end`}
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
            placeholder={placeholder(filter.operator)}
            min={0}
            onKeyUp={submitOnEnter}
            error={error}
            name={fieldName}
          />
        );
      }

    case "number":
      if (filter.operator === "between") {
        return (
          <div className="space-y-2">
            <div className="flex max-w-full items-center justify-normal gap-[2px]">
              <Input
                {...commonInputProps}
                type="number"
                value={localValue[0]}
                onChange={handleBetweenChange(0)}
                className="w-1/2"
                name={`${fieldName}_start`}
                onKeyUp={submitOnEnter}
              />
              <Input
                {...commonInputProps}
                type="number"
                value={localValue[1]}
                onChange={handleBetweenChange(1)}
                className="w-1/2"
                name={`${fieldName}_end`}
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
            placeholder={placeholder(filter.operator)}
            onKeyUp={submitOnEnter}
            error={error}
            name={fieldName}
          />
        );
      }

    case "boolean":
      return (
        <>
          <BooleanField
            value={filter.value as boolean}
            handleBooleanChange={handleBooleanChange}
            name={fieldName}
            disabled={disabled}
          />
          <ErrorDisplay error={error} />
        </>
      );

    case "date":
      return (
        <>
          <DateField
            filter={filter}
            setFilter={setFilter}
            applyFilters={applyFilters}
            name={fieldName}
            disabled={disabled}
          />
          <ErrorDisplay error={error} />
        </>
      );

    case "enum":
      return (
        <>
          <ValueEnumField
            fieldName={filter.name}
            value={filter.value as string}
            handleChange={setFilter}
            multiSelect={filter.operator === "containsAny"}
            name={fieldName}
            disabled={disabled}
          />
          <ErrorDisplay error={error} />
        </>
      );

    case "array":
      if (filter.name === "tags") {
        return (
          <>
            <ValueEnumField
              fieldName={filter.name}
              value={filter.value as string}
              handleChange={setFilter}
              multiSelect={filter.operator !== "contains"}
              name={fieldName}
              disabled={disabled}
            />
            <ErrorDisplay error={error} />
          </>
        );
      }

      return (
        <Input
          {...commonInputProps}
          type="text"
          label="Values"
          value={
            Array.isArray(filter.value)
              ? filter.value.join(", ")
              : typeof filter.value === "boolean"
              ? "yes"
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
          error={error}
          name={fieldName}
        />
      );

    default:
      return null;
  }
}

function BooleanField({
  name,
  value,
  handleBooleanChange,
  disabled = false,
}: {
  name: string;
  value: boolean | string;
  handleBooleanChange: (value: "true" | "false") => void;
  disabled?: boolean;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const boolValue = value === "" ? true : value === "true" || value === true;

  // Reset selected index when popover opens
  useEffect(() => {
    if (isPopoverOpen) {
      // Set to "Yes" (0) if true, "No" (1) if false
      setSelectedIndex(boolValue ? 0 : 1);
    }
  }, [isPopoverOpen, boolValue]);

  const handleSelect = (value: "true" | "false") => {
    handleBooleanChange(value);
    setIsPopoverOpen(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => (prev < 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
      case " ": // Space key
        event.preventDefault();
        handleSelect(selectedIndex === 0 ? "true" : "false");
        break;
      case "Escape":
        event.preventDefault();
        setIsPopoverOpen(false);
        break;
    }
  };

  return (
    <>
      <input type="hidden" value={String(boolValue)} name={name} />
      <Popover
        open={isPopoverOpen && !disabled}
        onOpenChange={(open) => !disabled && setIsPopoverOpen(open)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap font-normal [&_span]:max-w-full [&_span]:truncate"
            disabled={disabled}
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">
              {disabled ? "Select a column first" : boolValue ? "Yes" : "No"}
            </span>{" "}
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] min-w-[100px] overflow-scroll rounded-md border border-gray-200 bg-white"
            )}
            onKeyDown={handleKeyDown}
          >
            <div
              className={tw(
                "px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                selectedIndex === 0 && "bg-gray-50"
              )}
              onClick={() => handleSelect("true")}
            >
              <span>Yes</span>
            </div>
            <div
              className={tw(
                "px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                selectedIndex === 1 && "bg-gray-50"
              )}
              onClick={() => handleSelect("false")}
            >
              <span>No</span>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

interface EnumOption {
  id: string;
  label: string;
}

interface EnumFieldProps {
  value: string;
  options: EnumOption[];
  handleChange: (value: string) => void;
  multiSelect?: boolean;
  name?: string;
  disabled?: boolean;
}

/**
 * Generic enum field component that handles single and multi-select scenarios
 */
function EnumField({
  value,
  options,
  handleChange,
  multiSelect = false,
  name,
  disabled = false,
}: EnumFieldProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  // Convert the value into an array for multi-select mode
  const selectedValues = multiSelect ? value.split(", ") : [value];

  // Reset selected index when popover opens
  useEffect(() => {
    if (isPopoverOpen) {
      // For single-select, find the currently selected option
      if (!multiSelect) {
        const currentIndex = options.findIndex((opt) => opt.id === value);
        setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
      } else {
        setSelectedIndex(0);
      }
    }
  }, [isPopoverOpen, value, options, multiSelect]);

  const displayValue = disabled
    ? "Select a column first"
    : multiSelect
    ? selectedValues
        .map((v) => options.find((opt) => opt.id === v)?.label ?? v)
        .join(", ")
    : value === ""
    ? options[0]?.label
    : options.find((opt) => opt.id === value)?.label ?? value;

  function handleOptionClick(optionId: string) {
    let newValue: string;
    if (multiSelect) {
      const isSelected = selectedValues.includes(optionId);
      const updatedValues = isSelected
        ? selectedValues.filter((val) => val !== optionId)
        : [...selectedValues, optionId];
      newValue = updatedValues.join(", ");
    } else {
      newValue = optionId;
    }
    handleChange(newValue);
    if (!multiSelect) {
      setIsPopoverOpen(false);
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < options.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
      case " ": // Space key
        event.preventDefault();
        if (options[selectedIndex]) {
          handleOptionClick(options[selectedIndex].id);
        }
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
        `enum-option-${selectedIndex}`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, isPopoverOpen]);

  return (
    <>
      <input
        type="hidden"
        value={multiSelect ? displayValue : value}
        name={name}
      />
      <Popover
        open={isPopoverOpen && !disabled}
        onOpenChange={(open) => !disabled && setIsPopoverOpen(open)}
      >
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className="w-full justify-start truncate whitespace-nowrap font-normal [&_span]:max-w-full [&_span]:truncate"
            disabled={disabled}
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">{displayValue}</span>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] min-w-[250px] overflow-scroll rounded-md border border-gray-200 bg-white"
            )}
            onKeyDown={handleKeyDown}
          >
            {options.length === 0 ? (
              <div className="max-w-[400px] p-4">
                No options available. Please contact support if you believe this
                is an error.
              </div>
            ) : (
              options.map((option, index) => {
                const isSelected = selectedValues.includes(option.id);
                return (
                  <div
                    id={`enum-option-${index}`}
                    key={option.id}
                    className={tw(
                      "flex items-center justify-between px-4 py-3 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                      selectedIndex === index && "bg-gray-50"
                    )}
                    onClick={() => handleOptionClick(option.id)}
                  >
                    <span>{option.label}</span>
                    {multiSelect && isSelected && (
                      <span className="h-auto w-[14px] text-primary">
                        <CheckIcon />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

/**
 * Status-specific enum field that handles asset statuses
 */
function StatusEnumField({
  value,
  handleChange,
  multiSelect,
  name,
  disabled = false,
}: Omit<EnumFieldProps, "options">) {
  const options: EnumOption[] = Object.values(AssetStatus).map((status) => ({
    id: status,
    label: userFriendlyAssetStatus(status),
  }));

  return (
    <EnumField
      value={value}
      options={options}
      handleChange={handleChange}
      multiSelect={multiSelect}
      name={name}
      disabled={disabled}
    />
  );
}

/**
 * Custom field-specific enum field that handles custom field options
 */
function CustomFieldEnumField({
  value,
  handleChange,
  fieldName,
  multiSelect,
  name,
  disabled,
}: Omit<EnumFieldProps, "options"> & { fieldName: string }) {
  const data = useLoaderData<AssetIndexLoaderData>();
  const customFields = useMemo(
    () => data?.customFields || [],
    [data?.customFields]
  );

  const options: EnumOption[] = useMemo(() => {
    const field = customFields.find((f) => f?.name === fieldName.slice(3));
    return (field?.options || []).map((opt) => ({
      id: opt,
      label: opt,
    }));
  }, [customFields, fieldName]);

  return (
    <EnumField
      value={value}
      options={options}
      handleChange={handleChange}
      multiSelect={multiSelect}
      name={name}
      disabled={disabled}
    />
  );
}

/**
 * Custody-specific field component that handles team members and users
 * Uses DynamicSelect for single selection and DynamicDropdown for multi-select
 */
function CustodyEnumField({
  value,
  handleChange,
  multiSelect,
  name,
  disabled,
}: Omit<EnumFieldProps, "options">) {
  const data = useLoaderData<AssetIndexLoaderData>();

  // Parse the existing value to get selected TeamMember IDs
  const selectedIds = useMemo(() => {
    if (!value) return [];
    // If it's a containsAny filter, split the values
    if (multiSelect && typeof value === "string") {
      return value.split(",").map((v) => v.trim());
    }
    return [value];
  }, [value, multiSelect]);

  const commonProps = {
    model: {
      name: "teamMember" as const,
      queryKey: "name",
      deletedAt: null,
    },
    transformItem: (item: any) => item,
    renderItem: (item: any) => resolveTeamMemberName(item, true),
    initialDataKey: "teamMembers",
    countKey: "totalTeamMembers",
    label: "Filter by custodian",
    hideLabel: true,
    hideCounter: true,
    placeholder: "Search team members",
    withoutValueItem: {
      id: "without-custody",
      name: "Without custody",
    },
    disabled,
  };

  if (multiSelect) {
    return (
      <DynamicDropdown
        {...commonProps}
        name={name}
        trigger={
          <Button
            variant="secondary"
            className="w-full justify-start  font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate"
            disabled={disabled}
          >
            <div className="flex items-center justify-between">
              <span
                className={tw(
                  "text-left",
                  selectedIds.length <= 0 && "text-gray-500"
                )}
              >
                {selectedIds.length > 0
                  ? selectedIds
                      .map((id) => {
                        if (id === "without-custody") {
                          return "Without custody";
                        }
                        const teamMember = data.teamMembers.find(
                          (tm) => tm.id === id
                        );
                        return resolveTeamMemberName({
                          name: teamMember?.name || "",
                        });
                      })
                      .join(", ")
                  : "Select custodian"}
              </span>
              <ChevronRight className="mr-1 inline-block rotate-90" />
            </div>
          </Button>
        }
        triggerWrapperClassName="w-full"
        className="z-[999999]"
        selectionMode="none"
        defaultValues={selectedIds}
        onSelectionChange={(selectedTeamMemberIds) => {
          handleChange(selectedTeamMemberIds.join(","));
        }}
      />
    );
  }

  return (
    <DynamicSelect
      {...commonProps}
      fieldName={name}
      placeholder="Select custodian"
      defaultValue={value as string}
      onChange={(selectedId) => {
        if (selectedId !== undefined) {
          handleChange(selectedId);
        }
      }}
      closeOnSelect={true}
      triggerWrapperClassName="w-full text-gray-700"
      className="z-[999999]"
      contentLabel="Custodian"
    />
  );
}

/** Component that handles category selection for both single and multi-select scenarios */
function CategoryEnumField({
  value,
  handleChange,
  multiSelect,
  name,
  disabled = false,
}: Omit<EnumFieldProps, "options">) {
  const data = useLoaderData<AssetIndexLoaderData>();

  // Parse the existing value to get selected Category IDs
  const selectedIds = useMemo(() => {
    if (!value) return [];
    // Handle multi-select values
    if (multiSelect && typeof value === "string") {
      return value.split(",").map((v) => v.trim());
    }
    return [value];
  }, [value, multiSelect]);

  /** Common props for both DynamicSelect and DynamicDropdown */
  const commonProps = {
    model: {
      name: "category" as const,
      queryKey: "name",
    },
    transformItem: (item: any) => ({
      ...item,
      id: item.id === "uncategorized" ? "uncategorized" : item.id,
    }),
    renderItem: (item: any) => (
      <div className="flex items-center gap-2">
        <div
          className="size-3 rounded-full"
          style={{ backgroundColor: item.metadata?.color || "#808080" }}
        />
        <span>{item.name}</span>
      </div>
    ),
    initialDataKey: "categories",
    countKey: "totalCategories",
    label: "Filter by category",
    hideLabel: true,
    hideCounter: true,
    placeholder: "Search categories",
    withoutValueItem: {
      id: "uncategorized",
      name: "Uncategorized",
    },
    disabled,
  };

  // For multi-select (containsAny operator), use DynamicDropdown
  if (multiSelect) {
    return (
      <DynamicDropdown
        {...commonProps}
        name={name}
        trigger={
          <Button
            variant="secondary"
            className="w-full justify-start font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate"
          >
            <div className="flex items-center justify-between">
              <span
                className={tw(
                  "text-left",
                  selectedIds.length <= 0 && "text-gray-500"
                )}
              >
                {disabled
                  ? "Select a column first"
                  : selectedIds.length > 0
                  ? selectedIds
                      .map((id) => {
                        if (id === "uncategorized") {
                          return "Uncategorized";
                        }
                        const category = data.categories?.find(
                          (cat) => cat.id === id
                        );
                        return category?.name || "";
                      })
                      .join(", ")
                  : "Select category"}
              </span>
              <ChevronRight className="mr-1 inline-block rotate-90" />
            </div>
          </Button>
        }
        triggerWrapperClassName="w-full"
        className="z-[999999]"
        selectionMode="none"
        defaultValues={selectedIds}
        onSelectionChange={(selectedCategoryIds) => {
          handleChange(selectedCategoryIds.join(","));
        }}
      />
    );
  }

  // For single select (is/isNot operators), use DynamicSelect
  return (
    <DynamicSelect
      {...commonProps}
      fieldName={name}
      placeholder={disabled ? "Select a column first" : "Select category"}
      defaultValue={value as string}
      onChange={(selectedId) => {
        if (selectedId !== undefined) {
          handleChange(selectedId);
        }
      }}
      closeOnSelect={true}
      triggerWrapperClassName="w-full text-gray-700"
      className="z-[999999]"
      contentLabel="Category"
    />
  );
}

/** Component that handles location selection for both single and multi-select scenarios */
function LocationEnumField({
  value,
  handleChange,
  multiSelect,
  name,
  disabled = false,
}: Omit<EnumFieldProps, "options">) {
  const data = useLoaderData<AssetIndexLoaderData>();

  // Parse the existing value to get selected Category IDs
  const selectedIds = useMemo(() => {
    if (!value) return [];
    // Handle multi-select values
    if (multiSelect && typeof value === "string") {
      return value.split(",").map((v) => v.trim());
    }
    return [value];
  }, [value, multiSelect]);

  /** Common props for both DynamicSelect and DynamicDropdown */
  const commonProps = {
    model: {
      name: "location" as const,
      queryKey: "name",
    },
    transformItem: (item: any) => ({
      ...item,
      id: item.id === "without-location" ? "without-location" : item.id,
    }),
    renderItem: (item: any) => (item.name ? item.name : "Without location"),
    initialDataKey: "locations",
    countKey: "totalLocations",
    label: "Filter by location",
    hideLabel: true,
    hideCounter: true,
    placeholder: "Search locations",
    withoutValueItem: {
      id: "without-location",
      name: "Without location",
    },
    disabled,
  };

  // For multi-select (containsAny operator), use DynamicDropdown
  if (multiSelect) {
    return (
      <DynamicDropdown
        {...commonProps}
        name={name}
        trigger={
          <Button
            variant="secondary"
            className="w-full justify-start font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate"
          >
            <div className="flex items-center justify-between">
              <span
                className={tw(
                  "text-left",
                  selectedIds.length <= 0 && "text-gray-500"
                )}
              >
                {disabled
                  ? "Select column first"
                  : selectedIds.length > 0
                  ? selectedIds
                      .map((id) => {
                        if (id === "without-location") {
                          return "Without location";
                        }
                        const location = data.locations?.find(
                          (loc) => loc.id === id
                        );
                        return location?.name || "";
                      })
                      .join(", ")
                  : "Select location"}
              </span>
              <ChevronRight className="mr-1 inline-block rotate-90" />
            </div>
          </Button>
        }
        triggerWrapperClassName="w-full"
        className="z-[999999]"
        selectionMode="none"
        defaultValues={selectedIds}
        onSelectionChange={(selectedLocationsIds) => {
          handleChange(selectedLocationsIds.join(","));
        }}
      />
    );
  }

  // For single select (is/isNot operators), use DynamicSelect
  return (
    <DynamicSelect
      {...commonProps}
      fieldName={name}
      placeholder={disabled ? "Select a column first" : "Select location"}
      defaultValue={value as string}
      onChange={(selectedId) => {
        if (selectedId !== undefined) {
          handleChange(selectedId);
        }
      }}
      closeOnSelect={true}
      triggerWrapperClassName="w-full text-gray-700"
      className="z-[999999]"
      contentLabel="Location"
    />
  );
}

/** Component that handles kit selection for both single and multi-select scenarios */
function KitEnumField({
  value,
  handleChange,
  multiSelect,
  name,
  disabled,
}: Omit<EnumFieldProps, "options">) {
  const data = useLoaderData<AssetIndexLoaderData>();

  // Parse the existing value to get selected Category IDs
  const selectedIds = useMemo(() => {
    if (!value) return [];
    // Handle multi-select values
    if (multiSelect && typeof value === "string") {
      return value.split(",").map((v) => v.trim());
    }
    return [value];
  }, [value, multiSelect]);

  /** Common props for both DynamicSelect and DynamicDropdown */
  const commonProps = {
    model: {
      name: "kit" as const,
      queryKey: "name",
    },
    transformItem: (item: any) => ({
      ...item,
      id: item.id === "without-kit" ? "without-kit" : item.id,
    }),
    renderItem: (item: any) => (item.name ? item.name : "Without kit"),
    initialDataKey: "kits",
    countKey: "totalKits",
    label: "Filter by kit",
    hideLabel: true,
    hideCounter: true,
    placeholder: "Search kits",
    withoutValueItem: {
      id: "without-kit",
      name: "Without kit",
    },
    disabled,
  };

  // For multi-select (containsAny operator), use DynamicDropdown
  if (multiSelect) {
    return (
      <DynamicDropdown
        {...commonProps}
        name={name}
        trigger={
          <Button
            variant="secondary"
            className="w-full justify-start font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate"
          >
            <div className="flex items-center justify-between">
              <span
                className={tw(
                  "text-left",
                  selectedIds.length <= 0 && "text-gray-500"
                )}
              >
                {disabled
                  ? "Select a column first"
                  : selectedIds.length > 0 && data.kits && data.kits.length > 0
                  ? selectedIds
                      .map((id) => {
                        if (id === "without-kit") {
                          return "Without kit";
                        }
                        const kit = data.kits?.find((kit) => kit.id === id);
                        return kit?.name || "";
                      })
                      .join(", ")
                  : "Select kit"}
              </span>
              <ChevronRight className="mr-1 inline-block rotate-90" />
            </div>
          </Button>
        }
        triggerWrapperClassName="w-full"
        className="z-[999999]"
        selectionMode="none"
        defaultValues={selectedIds}
        onSelectionChange={(selectedKitsIds) => {
          handleChange(selectedKitsIds.join(","));
        }}
      />
    );
  }

  // For single select (is/isNot operators), use DynamicSelect
  return (
    <DynamicSelect
      {...commonProps}
      fieldName={name}
      placeholder={disabled ? "Select a column first" : "Select kit"}
      defaultValue={value as string}
      onChange={(selectedId) => {
        if (selectedId !== undefined) {
          handleChange(selectedId);
        }
      }}
      closeOnSelect={true}
      triggerWrapperClassName="w-full text-gray-700"
      className="z-[999999]"
      contentLabel="Kit"
    />
  );
}

/** Component that handles tag selection for multi-select scenario  */
function TagsField({
  handleChange,
  value,
  disabled,
  multiSelect,
  name,
}: Omit<EnumFieldProps, "options">) {
  const data = useLoaderData<AssetIndexLoaderData>();

  // Parsing the existing value to get selected Tag Ids
  const selectedIds = useMemo(() => {
    if (!value) {
      return [];
    }

    if (multiSelect && typeof value === "string") {
      return value.split(",").map((v) => v.trim());
    }

    return [value];
  }, [multiSelect, value]);

  const commonProps = {
    model: {
      name: "tag" as const,
      queryKey: "name",
    },
    initialDataKey: "tags",
    countKey: "totalTags",
    label: "Filter by tag",
    hideLabel: true,
    hideCounter: true,
    withoutValueItem: {
      id: "untagged",
      name: "Untagged",
    },
    disabled,
  };

  if (multiSelect) {
    return (
      <DynamicDropdown
        {...commonProps}
        name={name}
        trigger={
          <Button
            variant="secondary"
            className="w-full justify-start font-normal [&_span]:w-full [&_span]:max-w-full [&_span]:truncate"
            disabled={disabled}
          >
            <div className="flex items-center justify-between">
              <span
                className={tw(
                  "text-left",
                  selectedIds.length <= 0 && "text-gray-500"
                )}
              >
                {disabled
                  ? "Select a column first"
                  : selectedIds.length > 0
                  ? selectedIds
                      .map((id) => {
                        if (id === "untagged") {
                          return "Untagged";
                        }
                        const tag = data.tags?.find((t) => t.id === id);
                        return tag?.name || "";
                      })
                      .join(", ")
                  : "Select Tag"}
              </span>
              <ChevronRight className="mr-1 inline-block rotate-90" />
            </div>
          </Button>
        }
        triggerWrapperClassName="w-full"
        className="z-[999999]"
        selectionMode="none"
        defaultValues={selectedIds}
        placeholder="Select tags"
        onSelectionChange={(selectedTagIds) => {
          handleChange(selectedTagIds.join(","));
        }}
      />
    );
  }

  return (
    <DynamicSelect
      {...commonProps}
      fieldName={name}
      placeholder={disabled ? "Select a column first" : "Select tag"}
      defaultValue={value}
      onChange={(selectedId) => {
        if (selectedId) {
          handleChange(selectedId);
        }
      }}
      closeOnSelect
      triggerWrapperClassName="w-full text-gray-700"
      className="z-[999999]"
      contentLabel="tags"
    />
  );
}

/**
 * Component that determines which enum field to render based on field name
 */
function ValueEnumField({
  fieldName,
  value,
  handleChange,
  multiSelect,
  name,
  error,
  disabled = false,
}: {
  fieldName: string;
  value: string;
  handleChange: (value: string) => void;
  multiSelect?: boolean;
  name?: string;
  error?: string;
  disabled?: boolean;
}) {
  if (fieldName === "status") {
    return (
      <>
        <StatusEnumField
          value={value}
          handleChange={handleChange}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  if (fieldName === "category") {
    return (
      <>
        <CategoryEnumField
          value={value}
          handleChange={handleChange}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  // Apply the same pattern to all other enum fields
  if (fieldName === "location") {
    return (
      <>
        <LocationEnumField
          value={value}
          handleChange={handleChange}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  if (fieldName === "custody") {
    return (
      <>
        <CustodyEnumField
          value={value}
          handleChange={handleChange}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  if (fieldName === "kit") {
    return (
      <>
        <KitEnumField
          value={value}
          handleChange={handleChange}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  if (fieldName.startsWith("cf_")) {
    return (
      <>
        <CustomFieldEnumField
          value={value}
          handleChange={handleChange}
          fieldName={fieldName}
          multiSelect={multiSelect}
          name={name}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-[12px] text-red-500">{error}</div>}
      </>
    );
  }

  if (fieldName === "tags") {
    return (
      <>
        <TagsField
          value={value}
          handleChange={handleChange}
          name={name}
          multiSelect={multiSelect}
          disabled={disabled}
        />
        {error && <div className="mt-1 text-xs text-red-500">{error}</div>}
      </>
    );
  }

  return null;
}
// Define the props for the DateField component
type DateFieldProps = {
  name?: string; // Add name prop for zorm
  error?: string; // Add error prop
  filter: Filter;
  setFilter: (value: Filter["value"]) => void;
  applyFilters: () => void;
  disabled?: boolean;
};

/**
 * DateField component for handling date-based filters
 * Supports both single date and date range selections
 */
export function DateField({
  name,
  filter,
  setFilter,
  applyFilters,
  error,
  disabled = false,
}: DateFieldProps) {
  const { timeZone } = useHints();
  const [localValue, setLocalValue] = useState<[string, string]>(["", ""]);
  const [localError, setLocalError] = useState<string | null>(null);
  // Combine local and zorm errors

  const combinedError = useMemo(() => {
    if (localError) return localError;
    return error;
  }, [localError, error]);

  useEffect(() => {
    if (Array.isArray(filter.value)) {
      const start = isDateString(filter.value[0])
        ? filter.value[0]
        : String(filter.value[0]);
      const end = isDateString(filter.value[1])
        ? filter.value[1]
        : String(filter.value[1]);
      setLocalValue([
        adjustDateToUserTimezone(start, timeZone),
        adjustDateToUserTimezone(end, timeZone),
      ]);
    } else {
      const value = isDateString(filter.value)
        ? filter.value
        : String(filter.value);
      setLocalValue([adjustDateToUserTimezone(value, timeZone), ""]);
    }
  }, [filter.value, timeZone]);

  function handleDateChange(index: 0 | 1) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = [...localValue] as [string, string];
      newValue[index] = event.target.value;
      setLocalValue(newValue);

      if (filter.operator === "between" && newValue[0] && newValue[1]) {
        setFilter([
          adjustDateToUTC(newValue[0], timeZone),
          adjustDateToUTC(newValue[1], timeZone),
        ]);
      } else if (filter.operator !== "between" && newValue[0]) {
        setFilter(adjustDateToUTC(newValue[0], timeZone));
      }
      validateDates(newValue);
    };
  }

  function validateDates([start, end]: [string, string]) {
    if (start && end) {
      const startDate = parseISO(start);
      const endDate = parseISO(end);
      if (startDate > endDate) {
        setLocalError("Start date must be before or equal to end date");
      } else {
        setLocalError(null);
      }
    } else {
      setLocalError(null);
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
    disabled,
  };

  if (disabled) {
    return (
      <Input
        {...commonInputProps}
        label={""}
        type="text"
        placeholder="Select a column first"
      />
    );
  }

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
            name={`${name}_start`}
          />
          <Input
            {...commonInputProps}
            label="End Date"
            type="date"
            value={localValue[1]}
            onChange={handleDateChange(1)}
            className="w-1/2"
            name={`${name}_end`}
          />
        </div>
        {combinedError && localValue[0] !== "" && localValue[1] !== "" && (
          <div className="!mt-0 text-[12px] text-red-500">{combinedError}</div>
        )}
      </div>
    );
  } else if (filter.operator === "inDates") {
    return (
      <MultiDateInput
        setValue={(value) => setFilter(value)}
        value={typeof filter.value === "string" ? filter.value : ""}
        timeZone={timeZone}
        commonInputProps={commonInputProps}
        error={combinedError}
        name={name}
      />
    );
  } else {
    return (
      <Input
        {...commonInputProps}
        type="date"
        value={localValue[0]}
        onChange={handleDateChange(0)}
        error={combinedError}
        name={name}
        disabled={disabled}
      />
    );
  }
}

function MultiDateInput({
  setValue,
  value,
  timeZone,
  commonInputProps,
  name,
  error,
}: {
  setValue: (value: string) => void;
  value: string;
  timeZone: string;
  commonInputProps: {
    inputClassName: string;
    hideLabel: boolean;
    label: string;
    onKeyUp: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  };
  name?: string;
  error?: string;
}) {
  // Parse initial dates from comma-separated string
  const [dates, setDates] = useState<string[]>(() => {
    if (!value) return [""];
    return value.split(",").map((d) => d.trim());
  });

  // Handle date change at specific index
  const handleDateChange =
    (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const newDates = [...dates];
      newDates[index] = event.target.value;
      setDates(newDates);

      // Filter out empty dates and convert to UTC
      const validDates = newDates
        .filter((date) => date)
        .map((date) => adjustDateToUTC(date, timeZone));

      // Update parent with comma-separated string
      setValue(validDates.join(","));
    };

  // Add new date field
  const addDateField = () => {
    setDates([...dates, ""]);
  };
  // Remove date field at index
  const removeDateField = (indexToRemove: number) => {
    const newDates = dates.filter((_, index) => index !== indexToRemove);
    setDates(newDates);

    // Update parent with remaining dates
    const validDates = newDates
      .filter((date) => date)
      .map((date) => adjustDateToUTC(date, timeZone));
    setValue(validDates.join(","));
  };

  return (
    <div className="space-y-1">
      {dates.map((date, index) => (
        <div key={index} className="relative flex items-center gap-2">
          <Input
            {...commonInputProps}
            type="date"
            value={date}
            onChange={handleDateChange(index)}
            className="flex-1"
            name={`${name}_${index}`}
          />
          {dates.length > 1 && (
            <Button
              variant="block-link-gray"
              className="absolute right-0 -mr-1 mt-[2px] shrink-0 translate-x-full  bg-white  text-[10px] font-normal text-gray-600"
              icon="x"
              onClick={() => removeDateField(index)}
            />
          )}
        </div>
      ))}
      {error && <div className="!mt-0 text-[12px] text-red-500">{error}</div>}
      <Button
        variant="block-link"
        className="text-[14px]"
        size="xs"
        onClick={addDateField}
      >
        <div className="mr-1 inline-block size-[14px] align-middle">
          <PlusIcon />
        </div>
        <span className="inline-block align-middle">Add another date</span>
      </Button>
    </div>
  );
}
