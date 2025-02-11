import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import type { loader } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";
import { tw } from "~/utils/tw";
import When from "../when/when";

type CurrencySelectorProps = {
  className?: string;
  defaultValue: string;
  name?: string;
};

export default function CurrencySelector({
  className,
  defaultValue,
  name,
}: CurrencySelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { curriences } = useLoaderData<typeof loader>();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(defaultValue);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredCurrencies = useMemo(() => {
    if (!searchQuery) {
      return curriences;
    }

    return curriences.filter((currency) =>
      currency.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [curriences, searchQuery]);

  function handleSelect(currency: string) {
    setSelectedCurrency(currency);
    setIsOpen(false);
  }

  // Ensure selected item is visible in viewport
  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(
        `currency-option-${index}`
      );
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
          const newIndex =
            prev < filteredCurrencies.length - 1 ? prev + 1 : prev;
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
        if (filteredCurrencies[selectedIndex]) {
          setSelectedCurrency(filteredCurrencies[selectedIndex]);
          setIsOpen(false);
        }
        break;
    }
  };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(v) => {
        scrollToIndex(selectedIndex);
        setIsOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          className={tw(
            "flex w-full items-center justify-between rounded-md border p-3",
            className
          )}
        >
          <span>{selectedCurrency}</span>
          <ChevronDownIcon className="inline-block size-4 text-gray-500" />
          <input type="hidden" name={name} value={selectedCurrency} />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
          side="bottom"
          style={{ width: triggerRef?.current?.clientWidth }}
        >
          <div className="flex items-center border-b">
            <SearchIcon className="ml-4 size-4 text-gray-500" />
            <input
              placeholder="Search currency..."
              className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          {filteredCurrencies.map((currency, index) => {
            const isSelected = selectedCurrency === currency;
            const isHovered = selectedIndex === index;

            return (
              <div
                id={`currency-option-${index}`}
                key={currency}
                className={tw(
                  "flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  isHovered && "bg-gray-50"
                )}
                onClick={() => {
                  handleSelect(currency);
                }}
              >
                <span>{currency}</span>
                <When truthy={isSelected}>
                  <CheckIcon className="size-4 text-primary" />
                </When>
              </div>
            );
          })}
          {filteredCurrencies.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500">
              No currency found
            </div>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
