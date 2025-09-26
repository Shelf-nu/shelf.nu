import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { QrIdDisplayPreference } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { tw } from "~/utils/tw";
import When from "../when/when";

type QrIdDisplayPreferenceSelectorProps = {
  className?: string;
  defaultValue: QrIdDisplayPreference;
  name?: string;
};

const QR_ID_DISPLAY_OPTIONS = [
  {
    value: "QR_ID" as const,
    label: "QR Code ID",
    description: "e.g., clm123abc...",
  },
  {
    value: "SAM_ID" as const,
    label: "SAM ID",
    description: "e.g., SAM-0001",
  },
];

export default function QrIdDisplayPreferenceSelector({
  className,
  defaultValue,
  name,
}: QrIdDisplayPreferenceSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [selectedPreference, setSelectedPreference] = useState(defaultValue);
  const [selectedIndex, setSelectedIndex] = useState<number>(() =>
    QR_ID_DISPLAY_OPTIONS.findIndex((option) => option.value === defaultValue)
  );

  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = useMemo(() => {
    if (!searchQuery) {
      return QR_ID_DISPLAY_OPTIONS;
    }

    return QR_ID_DISPLAY_OPTIONS.filter(
      (option) =>
        option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        option.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  function handleSelect(preference: QrIdDisplayPreference) {
    setSelectedPreference(preference);
    setIsOpen(false);
  }

  // Ensure selected item is visible in viewport
  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(
        `qr-preference-option-${index}`
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
          const newIndex = prev < filteredOptions.length - 1 ? prev + 1 : prev;
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
        if (filteredOptions[selectedIndex]) {
          setSelectedPreference(filteredOptions[selectedIndex].value);
          setIsOpen(false);
        }
        break;
    }
  };

  const selectedOption = QR_ID_DISPLAY_OPTIONS.find(
    (option) => option.value === selectedPreference
  );

  return (
    <Popover
      open={isOpen}
      onOpenChange={(v) => {
        if (v) {
          scrollToIndex(selectedIndex);
        }
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
          <span className="font-medium">
            {selectedOption?.label}{" "}
            <span className="text-sm font-normal text-gray-500">
              ({selectedOption?.description})
            </span>
          </span>
          <ChevronDownIcon className="inline-block size-4 text-gray-500" />
          <input type="hidden" name={name} value={selectedPreference} />
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
              placeholder="Search options..."
              className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>
          {filteredOptions.map((option, index) => {
            const isSelected = selectedPreference === option.value;
            const isHovered = selectedIndex === index;

            return (
              <div
                id={`qr-preference-option-${index}`}
                key={option.value}
                className={tw(
                  "flex items-center justify-between px-4 py-3 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  isHovered && "bg-gray-50"
                )}
                onClick={() => {
                  handleSelect(option.value);
                }}
              >
                <span className="font-medium">
                  {option.label}{" "}
                  <span className="text-sm font-normal text-gray-500">
                    ({option.description})
                  </span>
                </span>
                <When truthy={isSelected}>
                  <CheckIcon className="size-4 text-primary" />
                </When>
              </div>
            );
          })}
          {filteredOptions.length === 0 && (
            <div className="px-4 py-2 text-sm text-gray-500">
              No options found
            </div>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
