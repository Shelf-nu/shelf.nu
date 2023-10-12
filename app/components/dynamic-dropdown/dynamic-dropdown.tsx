import { cloneElement } from "react";
import type { ModelFilterItems, ModelFilterProps } from "~/hooks";
import { useModelFilters } from "~/hooks";
import { tw } from "~/utils";
import Input from "../forms/input";
import { CheckIcon } from "../icons";
import { Button } from "../shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import type { Icon } from "../shared/icons-map";
import When from "../when/when";

type Props = ModelFilterProps & {
  className?: string;
  style?: React.CSSProperties;
  trigger: React.ReactElement;
  label?: React.ReactNode;
  searchIcon?: Icon;
  showSearch?: boolean;
  renderItem?: (options: {
    item: ModelFilterItems;
    checked: boolean;
  }) => React.ReactNode;
};

export default function DynamicDropdown({
  className,
  style,
  label = "Filter",
  trigger,
  searchIcon = "search",
  model,
  initialDataKey,
  countKey,
  showSearch = true,
  renderItem,
}: Props) {
  const {
    selectedItems,
    searchQuery,
    setSearchQuery,
    handleSearchQueryChange,
    totalItems,
    items,
    handleSelectItemChange,
    clearFilters,
  } = useModelFilters({
    model,
    countKey,
    initialDataKey,
  });

  return (
    <div className="relative w-full">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className="inline-flex items-center gap-2 text-gray-500"
          asChild
        >
          <div>
            {cloneElement(trigger)}
            <When truthy={selectedItems.length > 0}>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700">
                {selectedItems.length}
              </div>
            </When>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className={tw(
            "max-h-[400px] w-[290px] overflow-y-auto p-0 md:w-[350px]",
            className
          )}
          style={style}
        >
          <div className="mb-[6px] flex items-center justify-between p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <When truthy={selectedItems.length > 0}>
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
                label={`Search ${label?.toLocaleString()}`}
                placeholder={`Search ${label?.toLocaleString()}`}
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
                    setSearchQuery("");
                  }}
                  className="z-100 pointer-events-auto absolute right-[14px] top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                />
              </When>
            </div>
          </When>
          <div className="divide-y">
            {items.map((item) => {
              const checked = selectedItems.includes(item.id);
              if (typeof renderItem === "function") {
                return (
                  <label
                    key={item.id}
                    htmlFor={item.id}
                    className="flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 "
                  >
                    {renderItem({ item, checked })}
                    <input
                      id={item.id}
                      type="checkbox"
                      value={item.id}
                      className="hidden"
                      checked={checked}
                      onChange={handleSelectItemChange}
                    />
                    <When truthy={checked}>
                      <CheckIcon className="text-primary" />
                    </When>
                  </label>
                );
              }

              return (
                <label
                  key={item.id}
                  htmlFor={item.id}
                  className="flex cursor-pointer select-none items-center justify-between px-6 py-4 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 "
                >
                  {item.name}
                  <input
                    id={item.id}
                    type="checkbox"
                    value={item.id}
                    className="hidden"
                    checked={checked}
                    onChange={handleSelectItemChange}
                  />
                  <When truthy={checked}>
                    <CheckIcon className="text-primary" />
                  </When>
                </label>
              );
            })}
          </div>
          <When truthy={totalItems > 4}>
            <div className="p-3 text-gray-500">
              Showing {items.length} out of {totalItems}, type to search for
              more
            </div>
          </When>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
