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
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import When from "../when/when";

type QrIdDisplayPreferenceSelectorProps = {
  className?: string;
  defaultValue: QrIdDisplayPreference;
  name?: string;
  /**
   * When true, barcode-type options (Code128, Code39, DataMatrix, ExternalQR,
   * EAN13) are appended to the list. Reflects `Organization.barcodesEnabled`.
   */
  canUseBarcodes?: boolean;
};

type Option = {
  value: QrIdDisplayPreference;
  label: string;
  description: string;
  /**
   * Synthetic value used by the inline AssetCodeBadge preview chip — gives the
   * user a feel for what their list rows will look like once they save. Kept
   * in sync with the `(e.g., …)` example baked into `description` so the chip
   * and the dropdown row never tell different stories.
   */
  exampleValue: string;
};

/** Options always available — QR id and SAM id work without the barcode add-on. */
const BASE_OPTIONS: Option[] = [
  {
    value: "QR_ID",
    label: "QR Code ID",
    description: "Shelf-generated — every asset has one (e.g., abc123xyz)",
    exampleValue: "abc123xyz",
  },
  {
    value: "SAM_ID",
    label: "SAM ID",
    description:
      "Sequential Asset Marker — short, human-readable (e.g., SAM-0001)",
    exampleValue: "SAM-0001",
  },
];

/** Barcode-type options — gated behind Organization.barcodesEnabled. */
const BARCODE_OPTIONS: Option[] = [
  {
    value: "Code128",
    label: "Code 128",
    description: "Most flexible: letters + numbers + symbols (e.g., ABC-123)",
    exampleValue: "ABC-123",
  },
  {
    value: "Code39",
    label: "Code 39",
    description: "Letters and numbers only, no symbols (e.g., ABC123)",
    exampleValue: "ABC123",
  },
  {
    value: "DataMatrix",
    label: "DataMatrix",
    description: "2D matrix code, supports any characters (e.g., ABC-123)",
    exampleValue: "ABC-123",
  },
  {
    value: "ExternalQR",
    label: "External QR",
    description:
      "Third-party QR codes — URLs or text (e.g., https://example.com)",
    exampleValue: "https://example.com",
  },
  {
    value: "EAN13",
    label: "EAN-13",
    description: "Retail barcodes, exactly 13 digits (e.g., 9780201379624)",
    exampleValue: "9780201379624",
  },
];

export default function QrIdDisplayPreferenceSelector({
  className,
  defaultValue,
  name,
  canUseBarcodes = false,
}: QrIdDisplayPreferenceSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Available options depend on the org's barcode add-on. Computed once per
  // mount since `canUseBarcodes` reflects a server-known org-level setting.
  const availableOptions = useMemo<Option[]>(
    () =>
      canUseBarcodes ? [...BASE_OPTIONS, ...BARCODE_OPTIONS] : BASE_OPTIONS,
    [canUseBarcodes]
  );

  const [isOpen, setIsOpen] = useState(false);
  // Lazy initializer avoids a false-positive derived-state lint: after mount this
  // state is user-controlled via the selector, so it must NOT re-sync with the prop.
  const [selectedPreference, setSelectedPreference] = useState(
    () => defaultValue
  );
  const [selectedIndex, setSelectedIndex] = useState<number>(() =>
    Math.max(
      0,
      availableOptions.findIndex((option) => option.value === defaultValue)
    )
  );

  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = useMemo(() => {
    if (!searchQuery) {
      return availableOptions;
    }

    return availableOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        option.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, availableOptions]);

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

  const selectedOption =
    availableOptions.find((option) => option.value === selectedPreference) ??
    // Defensive: data drift (e.g., addon revoked while org had a Code128 pref
    // saved). Fall back to QR_ID for the UI label; the resolver also falls back.
    BASE_OPTIONS[0];

  return (
    <div className="flex flex-col gap-2">
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
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => {
                    handleSelect(option.value);
                  }}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option.value)
                  )}
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

      {/*
      Live preview chip — renders the exact AssetCodeBadge users will see on
      every list view once they save. Updates instantly as they change the
      dropdown selection, so "Preferred display code" stops being abstract
      copy and becomes "this is literally what shows up on every row."
      Synthetic example value (defined per-option above) — no live data needed.
    */}
      <div
        className="flex items-center gap-2 text-xs text-gray-500"
        aria-live="polite"
      >
        <span>List rows will look like:</span>
        <AssetCodeBadge
          value={selectedOption.exampleValue}
          type={selectedPreference}
          isFallback={false}
          workspacePreference={selectedPreference}
        />
      </div>
    </div>
  );
}
