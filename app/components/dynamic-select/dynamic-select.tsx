import React, { useState } from "react";
import { Separator } from "@radix-ui/react-select";
import { ReactTags, type Tag } from "react-tag-autocomplete";
import { useModelFilters, type ModelFilterProps } from "~/hooks";
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
  defaultValue?: string | Tag[];
  multi?: boolean;
  extraContent?: React.ReactNode;
};

export default function DynamicSelect({
  className,
  style,
  label,
  searchIcon = "search",
  showSearch = true,
  defaultValue,
  multi = false,
  model,
  countKey,
  initialDataKey,
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
  } = useModelFilters({
    model,
    countKey,
    initialDataKey,
  });

  const [selected, setSelected] = useState<Tag[]>(
    Array.isArray(defaultValue) ? defaultValue : []
  );

  const onAdd = (newTag: Tag) => {
    setSelected([...selected, newTag]);
  };

  const onDelete = (tagIndex: number) => {
    setSelected(selected.filter((_, i) => i !== tagIndex));
  };

  if (multi) {
    return (
      <>
        <input
          type="hidden"
          name="tags"
          value={selected.map((tag) => tag.value).join(",")}
        />
        <ReactTags
          selected={selected}
          suggestions={items.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          onAdd={onAdd}
          onDelete={onDelete}
          noOptionsText="No matching tags"
        />
      </>
    );
  }

  return (
    <div className="relative w-full">
      <Select name="category" defaultValue={defaultValue as string}>
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
                className="flex cursor-pointer select-none items-center justify-between rounded-none px-6 py-4 text-sm font-medium outline-none focus:bg-gray-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100"
              >
                {item.name}
              </SelectItem>
            ))}
          </div>
          <When truthy={totalItems > 4}>
            <div className="p-3 text-gray-500">
              Showing {items.length} out of {totalItems}, type to search for
              more
            </div>
          </When>

          <Separator />
          {extraContent}
        </SelectContent>
      </Select>
    </div>
  );
}
