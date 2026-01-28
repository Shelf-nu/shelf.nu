import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { getCurrencyName, ISO_4217_CURRENCIES } from "~/utils/currency-codes";
import { handleActivationKeyPress } from "~/utils/keyboard";
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

  const [isOpen, setIsOpen] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState(defaultValue);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const [searchQuery, setSearchQuery] = useState("");

  const filteredCurrencies = useMemo(() => {
    if (!searchQuery) {
      return ISO_4217_CURRENCIES;
    }

    const query = searchQuery.toLowerCase();
    return ISO_4217_CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(query) ||
        c.name.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Reset selected index when filtered results change to avoid out-of-bounds selection
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCurrencies.length]);

  function handleSelect(code: string) {
    setSelectedCurrency(code);
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
          setSelectedCurrency(filteredCurrencies[selectedIndex].code);
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
            "flex h-[44px] w-full items-center justify-between rounded-md border px-3 py-2",
            className
          )}
        >
          <span>
            {selectedCurrency} - {getCurrencyName(selectedCurrency)}
          </span>
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
              placeholder="Search currency code or name..."
              className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          {filteredCurrencies.map((currency, index) => {
            const isSelected = selectedCurrency === currency.code;
            const isHovered = selectedIndex === index;

            return (
              <div
                id={`currency-option-${index}`}
                key={currency.code}
                className={tw(
                  "flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  isHovered && "bg-gray-50"
                )}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => {
                  handleSelect(currency.code);
                }}
                onKeyDown={handleActivationKeyPress(() =>
                  handleSelect(currency.code)
                )}
              >
                <span>
                  <span className="font-medium">{currency.code}</span>
                  <span className="ml-2 text-gray-500">{currency.name}</span>
                </span>
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
