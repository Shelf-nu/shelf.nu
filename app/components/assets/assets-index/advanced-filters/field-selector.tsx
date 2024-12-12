import type { KeyboardEvent } from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { Search } from "lucide-react";
import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  parseColumnName,
  type Column,
} from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { getAvailableColumns, getUIFieldType } from "./helpers";
import type { Filter } from "./schema";

export function FieldSelector({
  filter,
  filters,
  setFilter,
}: {
  filter: Filter & { isNew?: boolean };
  filters: Filter[];
  setFilter: (name: string) => void;
}) {
  const { settings } = useLoaderData<AssetIndexLoaderData>();
  const columns = settings.columns as Column[];
  const [fieldName, setFieldName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setFieldName(filter.name);
  }, [filter.name]);

  const baseAvailableColumns = useMemo(
    () => getAvailableColumns(columns, filters, "filter"),
    [columns, filters]
  );

  const filteredColumns = useMemo(() => {
    if (!searchQuery) return baseAvailableColumns;

    return baseAvailableColumns.filter((column) =>
      parseColumnName(column.name)
        .toLowerCase()
        .includes(searchQuery.toLowerCase())
    );
  }, [baseAvailableColumns, searchQuery]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setSelectedIndex(0); // Reset selection when search changes
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredColumns.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
        event.preventDefault();
        if (filteredColumns[selectedIndex]) {
          setFilter(filteredColumns[selectedIndex].name);
        }
        break;
    }
  };

  // Ensure selected item is visible in viewport
  useEffect(() => {
    const selectedElement = document.getElementById(
      `column-option-${selectedIndex}`
    );
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const displayText = fieldName ? parseColumnName(fieldName) : "Select column";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className="w-[150px] justify-start truncate whitespace-nowrap font-normal [&_span]:max-w-full [&_span]:truncate"
        >
          <ChevronRight className="ml-[2px] inline-block rotate-90" />
          <span className="ml-2">{displayText}</span>
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999] mt-2 max-h-[400px] overflow-scroll rounded-md border border-gray-200 bg-white"
          )}
        >
          <div className="flex items-center border-b">
            <Search className="ml-4 size-4 text-gray-500" />
            <input
              ref={searchInputRef}
              placeholder="Search column..."
              className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={handleSearch}
              onKeyDown={handleKeyDown}
            />
          </div>
          {filteredColumns.map((column, index) => (
            <div
              id={`column-option-${index}`}
              key={column.name + index}
              className={tw(
                "px-4 py-2 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                selectedIndex === index && [
                  "bg-gray-50",
                  // Add borders only when item is selected
                  "relative",
                  // Top border - exclude for first item
                  index !== 0 &&
                    "before:absolute before:inset-x-0 before:top-0 before:border-t before:border-gray-200",
                  // Bottom border - exclude for last item
                  index !== filteredColumns.length - 1 &&
                    "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200",
                ]
              )}
              onClick={() => setFilter(column.name)}
            >
              <span className="font-medium">
                {parseColumnName(column.name)}
              </span>
              <span className="ml-2 font-normal text-gray-500">
                {getUIFieldType({ column, friendlyName: true })}
              </span>
            </div>
          ))}
          {filteredColumns.length === 0 && (
            <div className="px-4 py-2 text-[14px] text-gray-500">
              No columns found
            </div>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
