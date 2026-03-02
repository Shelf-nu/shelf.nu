import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Kit } from "@prisma/client";

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import When from "../when/when";

type KitSelectorProps = {
  className?: string;
  kits: Array<Pick<Kit, "id" | "name">>;
  name?: string;
  placeholder?: string;
  isLoading?: boolean;
  error?: string;
};

export default function KitSelector({
  className,
  kits,
  name,
  placeholder = "Select a kit",
  isLoading = false,
  error,
}: KitSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [selectedKit, setSelectedKit] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredKits = useMemo(() => {
    if (!searchQuery) {
      return kits;
    }

    return kits.filter((kit) =>
      kit.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [kits, searchQuery]);

  const selectedKitName = useMemo(
    () => kits.find((kit) => kit.id === selectedKit)?.name || "",
    [kits, selectedKit]
  );

  function handleSelect(kitId: string) {
    setSelectedKit(kitId);
    setIsOpen(false);
    setSearchQuery(""); // Reset search when selecting
  }

  // Ensure selected item is visible in viewport
  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(`kit-option-${index}`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev < filteredKits.length - 1 ? prev + 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "Enter":
        event.preventDefault();
        if (filteredKits[selectedIndex]) {
          handleSelect(filteredKits[selectedIndex].id);
        }
        break;
      case "Escape":
        event.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  return (
    <div>
      <Popover
        open={isOpen}
        onOpenChange={(v) => {
          if (v) {
            setSelectedIndex(0);
            setSearchQuery("");
          }
          scrollToIndex(selectedIndex);
          setIsOpen(v);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            ref={triggerRef}
            disabled={isLoading}
            className={tw(
              "flex w-full items-center justify-between rounded border p-3 text-left focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
              error && "border-error-300",
              className
            )}
          >
            <span className="truncate">
              {isLoading ? "Loading..." : selectedKitName || placeholder}
            </span>
            <ChevronDownIcon className="ml-2 size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={selectedKit} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] !mt-1 max-h-[400px] overflow-hidden rounded border bg-white shadow-lg"
            side="bottom"
            style={{ width: triggerRef?.current?.clientWidth }}
          >
            <div className="flex items-center border-b">
              <SearchIcon className="ml-4 size-4 text-gray-500" />
              <input
                placeholder="Search kits..."
                className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelectedIndex(0); // Reset selection when searching
                }}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {filteredKits.map((kit, index) => {
                const isSelected = selectedKit === kit.id;
                const isHovered = selectedIndex === index;

                return (
                  <div
                    id={`kit-option-${index}`}
                    key={kit.id}
                    className={tw(
                      "flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                      isHovered && "bg-gray-50"
                    )}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={() => {
                      handleSelect(kit.id);
                    }}
                    onKeyDown={handleActivationKeyPress(() =>
                      handleSelect(kit.id)
                    )}
                  >
                    <span className="truncate">{kit.name}</span>
                    <When truthy={isSelected}>
                      <CheckIcon className="ml-2 size-4 shrink-0 text-primary" />
                    </When>
                  </div>
                );
              })}
              {filteredKits.length === 0 && !isLoading && (
                <div className="px-4 py-3 text-sm text-gray-500">
                  {searchQuery ? "No kits found" : "No kits available"}
                </div>
              )}
              {isLoading && (
                <div className="px-4 py-3 text-sm text-gray-500">
                  Loading kits...
                </div>
              )}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      {error && <p className="mt-1 text-sm text-error-500">{error}</p>}
    </div>
  );
}
