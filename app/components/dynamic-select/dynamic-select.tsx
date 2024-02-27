import React from "react";
import { useModelFilters } from "~/hooks";
import type { ModelFilterItem, ModelFilterProps } from "~/hooks";
import { tw } from "~/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms";
import Input from "../forms/input";
import { Button } from "../shared";
import type { Icon } from "../shared/icons-map";
import When from "../when/when";

type Props = ModelFilterProps & {
  className?: string;
  style?: React.CSSProperties;
  label?: React.ReactNode;
  searchIcon?: Icon;
  showSearch?: boolean;
  defaultValue?: string;
  renderItem?: (item: ModelFilterItem) => React.ReactNode;
  extraContent?: React.ReactNode;
};

export default function DynamicSelect({
  className,
  style,
  label,
  searchIcon = "search",
  showSearch = true,
  defaultValue,
  model,
  countKey,
  initialDataKey,
  renderItem,
  extraContent,
}: Props) {
  const {
    searchQuery,
    setSearchQuery,
    handleSearchQueryChange,
    items,
    totalItems,
    clearFilters,
    selectedItems,
    resetModelFiltersFetcher,
    handleSelectItemChange,
  } = useModelFilters({
    model,
    countKey,
    initialDataKey,
    selectionMode: "set",
  });

  return (
    <div className="relative w-full">
      <Select
        name={model.name}
        defaultValue={defaultValue}
        onValueChange={(value) => {
          handleSelectItemChange(value);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={`Select ${model.name}`} />
        </SelectTrigger>

        <SelectContent
          align="end"
          className={tw(
            "max-h-[400px] w-[290px] overflow-y-auto p-0 md:w-[350px]",
            className
          )}
          style={style}
        >
          <div className="mb-[6px] flex items-center justify-between p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <When truthy={selectedItems.length > 0 && showSearch}>
              <Button
                as="button"
                variant="link"
                className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                onClick={clearFilters}
              >
                Clear filter
              </Button>
            </When>
          </div>
          <When truthy={showSearch}>
            <div className="filters-form relative mx-3">
              <Input
                type="text"
                label={`Search ${label}`}
                placeholder={`Search ${label}`}
                hideLabel
                className="mb-2 text-gray-500"
                icon={searchIcon}
                autoFocus
                value={searchQuery}
                onChange={handleSearchQueryChange}
              />
              <When truthy={Boolean(searchQuery)}>
                <Button
                  icon="x"
                  variant="tertiary"
                  disabled={Boolean(searchQuery)}
                  onClick={() => {
                    resetModelFiltersFetcher();
                    setSearchQuery("");
                  }}
                  className="z-100 pointer-events-auto absolute right-[14px] top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                />
              </When>
            </div>
          </When>

          <div className="divide-y">
            {items.map((item) => (
              <SelectItem
                value={item.id}
                key={item.id}
                className="cursor-pointer select-none px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
              >
                {typeof renderItem === "function" ? (
                  renderItem({ ...item, metadata: item })
                ) : (
                  <div className="flex items-center text-sm font-medium">
                    {item.name}
                  </div>
                )}
              </SelectItem>
            ))}
          </div>
          <When truthy={totalItems > 4}>
            <div className="p-3 text-gray-500">
              Showing {items.length} out of {totalItems}, type to search for
              more
            </div>
          </When>

          {typeof extraContent !== "undefined" ? (
            <div className="border-t px-3 pb-3">{extraContent}</div>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
