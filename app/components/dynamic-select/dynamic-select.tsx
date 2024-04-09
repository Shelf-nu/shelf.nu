import React, { useRef, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "@remix-run/react";
import { useModelFilters } from "~/hooks";
import type { ModelFilterItem, ModelFilterProps } from "~/hooks";
import { isFormProcessing, tw } from "~/utils";
import { EmptyState } from "../dynamic-dropdown/empty-state";
import Input from "../forms/input";
import { CheckIcon } from "../icons";
import { Button } from "../shared";
import type { Icon } from "../shared/icons-map";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

type Props = ModelFilterProps & {
  className?: string;
  style?: React.CSSProperties;
  fieldName?: string;
  label?: React.ReactNode;
  searchIcon?: Icon;
  showSearch?: boolean;
  defaultValue?: string;
  renderItem?: (item: ModelFilterItem) => React.ReactNode;
  extraContent?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
  closeOnSelect?: boolean;
  valueExtractor?: (item: ModelFilterItem) => string;
};

export default function DynamicSelect({
  className,
  style,
  fieldName,
  label,
  searchIcon = "search",
  showSearch = true,
  defaultValue,
  model,
  countKey,
  initialDataKey,
  renderItem,
  extraContent,
  disabled,
  placeholder = `Select ${model.name}`,
  closeOnSelect = false,
  valueExtractor,
}: Props) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue
  );

  const {
    searchQuery,
    handleSearchQueryChange,
    items,
    totalItems,
    clearFilters,
    selectedItems,
    resetModelFiltersFetcher,
    handleSelectItemChange,
    getAllEntries,
  } = useModelFilters({
    model,
    countKey,
    initialDataKey,
    selectionMode: "none",
    valueExtractor,
  });

  return (
    <div className="relative w-full">
      <input
        type="hidden"
        value={selectedValue}
        name={fieldName ?? model.name}
      />

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger disabled={disabled} asChild>
          <div
            ref={triggerRef}
            className="flex items-center justify-between rounded border border-gray-300 px-[14px] py-2 text-[16px] text-gray-500 hover:cursor-pointer disabled:opacity-50"
          >
            {items.find((i) => i.id === selectedValue)?.name ?? placeholder}
            <ChevronDownIcon />
          </div>
        </PopoverTrigger>

        <PopoverContent
          className={tw(
            "z-[100] overflow-y-auto rounded-md border border-gray-300 bg-white",
            className
          )}
          style={{
            ...style,
            width: triggerRef?.current?.clientWidth,
          }}
          align="center"
          sideOffset={5}
        >
          <div className="flex items-center justify-between p-3">
            <div className="text-xs font-semibold text-gray-700">{label}</div>
            <When truthy={selectedItems?.length > 0 && showSearch}>
              <Button
                as="button"
                variant="link"
                className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                onClick={() => {
                  setSelectedValue(undefined);
                  clearFilters();
                }}
              >
                Clear selection
              </Button>
            </When>
          </div>

          <When truthy={showSearch}>
            <div className="filters-form relative border-y border-y-gray-200 p-3">
              <Input
                type="text"
                label={`Search ${label}`}
                placeholder={`Search ${label}`}
                hideLabel
                className="text-gray-500"
                icon={searchIcon}
                value={searchQuery}
                onChange={handleSearchQueryChange}
                autoFocus
              />
              <When truthy={Boolean(searchQuery)}>
                <Button
                  icon="x"
                  variant="tertiary"
                  disabled={Boolean(searchQuery)}
                  onClick={() => {
                    setSelectedValue(undefined);
                    resetModelFiltersFetcher();
                  }}
                  className="z-100 pointer-events-auto absolute right-6 top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                />
              </When>
            </div>
          </When>

          <div className="max-h-[320px] divide-y overflow-y-auto">
            {searchQuery !== "" && items.length === 0 && (
              <EmptyState searchQuery={searchQuery} modelName={model.name} />
            )}
            {items.map((item) => (
              <div
                key={item.id}
                className={tw(
                  "flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100",
                  item.id === selectedValue && "bg-gray-100"
                )}
                onClick={() => {
                  setSelectedValue(item.id);
                  handleSelectItemChange(item.id);
                  if (closeOnSelect) {
                    setIsPopoverOpen(false);
                  }
                }}
              >
                <div>
                  {typeof renderItem === "function" ? (
                    renderItem({ ...item, metadata: item })
                  ) : (
                    <div className="flex items-center truncate text-sm font-medium">
                      {item.name}
                    </div>
                  )}
                </div>

                <When truthy={item.id === selectedValue}>
                  <CheckIcon className="text-primary" />
                </When>
              </div>
            ))}

            {items.length < totalItems && searchQuery === "" && (
              <button
                type="button"
                disabled={isSearching}
                onClick={getAllEntries}
                className=" flex w-full cursor-pointer select-none items-center justify-between px-6 py-3 text-sm font-medium text-gray-600 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
              >
                Show all
                <span>
                  {isSearching ? (
                    <Spinner className="size-4" />
                  ) : (
                    <ChevronDownIcon className="size-4" />
                  )}
                </span>
              </button>
            )}
          </div>

          <When truthy={totalItems > 6}>
            <div className="border-t p-3 text-gray-500">
              Showing {items.length} out of {totalItems}, type to search for
              more
            </div>
          </When>

          <When truthy={typeof extraContent !== "undefined"}>
            <div className="border-t px-3 pb-3">{extraContent}</div>
          </When>
        </PopoverContent>
      </Popover>
    </div>
  );
}
