import { cloneElement, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useNavigation } from "react-router";
import { useModelFilters } from "~/hooks/use-model-filters";
import type {
  ModelFilterItem,
  ModelFilterProps,
} from "~/hooks/use-model-filters";

import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";

import { EmptyState } from "./empty-state";
import { MobileStyles } from "../dynamic-select/dynamic-select";
import Input from "../forms/input";
import { CheckIcon } from "../icons/library";
import { Button } from "../shared/button";

import type { IconType } from "../shared/icons-map";
import { Spinner } from "../shared/spinner";
import When from "../when/when";

type Props = ModelFilterProps & {
  name?: string;
  className?: string;
  triggerWrapperClassName?: string;
  style?: CSSProperties;
  trigger: ReactElement;
  label?: string;
  hideLabel?: boolean;
  hideCounter?: boolean;
  /** Overwrite the default placeholder will will be `Search ${model.name}s` */
  placeholder?: string;
  searchIcon?: IconType;
  showSearch?: boolean;
  renderItem?: (item: ModelFilterItem) => ReactNode;
  /**
   * A a new item will be added to the list in dropdown, this item can be used to filter items
   * like "uncategorized" or "untagged" etc.
   */
  withoutValueItem?: {
    id: string;
    name: string;
  };

  /**
   * If `true`, a "Select All" item will be added in dropdown which allow
   * the user to select all items in the list
   */
  allowSelectAll?: boolean;

  onSelectionChange?: (selectedIds: string[]) => void;
};

export default function DynamicDropdown({
  name,
  className,
  triggerWrapperClassName,
  style,
  label = "Filter",
  hideLabel,
  hideCounter,
  placeholder,
  trigger,
  searchIcon = "search",
  model,
  showSearch = true,
  renderItem,
  withoutValueItem,
  allowSelectAll,
  ...hookProps
}: Props) {
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const {
    selectedItems,
    searchQuery,
    setSearchQuery,
    handleSearchQueryChange,
    totalItems,
    items,
    handleSelectItemChange,
    clearFilters,
    resetModelFiltersFetcher,
    getAllEntries,
    handleSelectAll,
  } = useModelFilters({ model, ...hookProps });

  return (
    <div className="relative w-full text-center">
      <MobileStyles open={isPopoverOpen} />

      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger
          className={tw(
            "inline-flex items-center gap-1 text-gray-500",
            triggerWrapperClassName
          )}
          asChild
        >
          <button>
            {cloneElement(trigger)}
            <When truthy={selectedItems.length > 0 && !hideCounter}>
              <div className="flex size-6 items-center justify-center rounded-full bg-primary-50 px-2 py-[2px] text-xs font-medium text-primary-700">
                {selectedItems.length}
              </div>
            </When>
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="end"
            className={tw(
              "z-[100]  overflow-y-auto rounded-md border border-gray-300 bg-white p-0",
              className
            )}
            style={style}
          >
            <div className="flex items-center justify-between ">
              {!hideLabel && (
                <div className="p-3 text-xs font-semibold text-gray-700">
                  {label}
                </div>
              )}
              <When truthy={selectedItems.length > 0 && showSearch}>
                <Button
                  as="button"
                  variant="link"
                  className="whitespace-nowrap p-3 text-xs font-normal text-gray-500 hover:text-gray-600"
                  onClick={clearFilters}
                >
                  Clear filter
                </Button>
              </When>
            </div>

            <When truthy={showSearch}>
              <div className="filters-form relative border-y border-y-gray-200 p-3">
                <Input
                  type="text"
                  label={label}
                  placeholder={
                    placeholder ? placeholder : `Search ${model.name}s`
                  }
                  hideLabel
                  className="text-gray-500"
                  icon={searchIcon}
                  autoFocus
                  value={searchQuery}
                  onChange={handleSearchQueryChange}
                />
                <When truthy={Boolean(searchQuery)}>
                  <Button
                    icon="x"
                    variant="tertiary"
                    disabled={!searchQuery || searchQuery === ""}
                    onClick={() => {
                      resetModelFiltersFetcher();
                      setSearchQuery("");
                    }}
                    className="z-100 pointer-events-auto absolute right-[14px] top-0 mr-2 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                  />
                </When>
              </div>
            </When>

            <div className="max-h-[320px] divide-y overflow-y-auto">
              {searchQuery !== "" && items.length === 0 && (
                <EmptyState searchQuery={searchQuery} modelName={model.name} />
              )}

              {/* Top Divider */}
              <When truthy={Boolean(allowSelectAll || withoutValueItem)}>
                <div className="h-2 w-full  bg-gray-50" />
              </When>

              <When truthy={!!allowSelectAll}>
                <label
                  key="select-all"
                  className="flex cursor-pointer select-none items-center justify-between px-6 py-4  text-sm font-medium outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                  onClick={handleSelectAll}
                >
                  <span className="pr-2">Select all</span>
                </label>
              </When>

              <When truthy={Boolean(withoutValueItem)}>
                <label
                  key={withoutValueItem?.id}
                  htmlFor={withoutValueItem?.id}
                  className={tw(
                    "flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm  outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100",
                    selectedItems.includes(withoutValueItem?.id ?? "") &&
                      "bg-gray-50"
                  )}
                >
                  <span className="pr-2 normal-case">
                    {withoutValueItem?.name}
                    <input
                      id={withoutValueItem?.id}
                      type="checkbox"
                      value={withoutValueItem?.id}
                      className="hidden"
                      checked={selectedItems.includes(
                        withoutValueItem?.id ?? ""
                      )}
                      onChange={(e) => {
                        handleSelectItemChange(e.currentTarget.value);
                      }}
                    />
                  </span>

                  <When
                    truthy={selectedItems.includes(withoutValueItem?.id ?? "")}
                  >
                    <span className="h-auto w-[18px] text-primary">
                      <CheckIcon />
                    </span>
                  </When>
                </label>
              </When>

              {/* Bottom Divider */}
              <When truthy={Boolean(allowSelectAll || withoutValueItem)}>
                <div className="h-2 w-full  bg-gray-50" />
              </When>

              {items.map((item) => {
                const checked = selectedItems.includes(item.id);
                return (
                  <label
                    key={item.id}
                    htmlFor={item.id}
                    className={tw(
                      "flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100",
                      checked && "bg-gray-50"
                    )}
                  >
                    <span className="max-w-[350px] truncate whitespace-nowrap pr-2">
                      {typeof renderItem === "function"
                        ? renderItem({ ...item, metadata: item })
                        : item.name}
                      <input
                        id={item.id}
                        type="checkbox"
                        value={item.id}
                        name={name}
                        className="hidden"
                        checked={checked}
                        onChange={(e) => {
                          handleSelectItemChange(e.currentTarget.value);
                        }}
                      />
                    </span>

                    <When truthy={checked}>
                      <span className="h-auto w-[18px] text-primary">
                        <CheckIcon />
                      </span>
                    </When>
                  </label>
                );
              })}

              {items.length < totalItems && searchQuery === "" && (
                <button
                  disabled={isSearching}
                  onClick={getAllEntries}
                  className="flex w-full cursor-pointer select-none items-center justify-between px-6 py-3 text-sm font-medium text-gray-600 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
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
            <When truthy={withoutValueItem ? totalItems > 7 : totalItems > 6}>
              <div className="border-t p-3 text-gray-500">
                Showing {withoutValueItem ? items.length - 1 : items.length} out
                of {totalItems}, type to search for more
              </div>
            </When>

            <div className="flex justify-between gap-3 border-t p-3 md:hidden">
              <Button
                onClick={() => {
                  setIsPopoverOpen(false);
                }}
                variant="secondary"
                width="full"
              >
                Done
              </Button>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
