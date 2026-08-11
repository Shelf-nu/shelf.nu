/**
 * TimezoneSelect
 *
 * Controlled searchable Popover selector for the user's IANA time zone. Built
 * on the asset advanced-filter field-selector pattern (search input +
 * arrow-key navigation) because the IANA list is ~400 entries. Options come
 * from Intl.supportedValuesOf("timeZone") at module scope, with a small
 * fallback array for runtimes that lack it. The chosen value rides the
 * surrounding form via a hidden input named `name`.
 *
 * @see {@link file://./language-region-form.tsx}
 * @see {@link file://../../assets/assets-index/advanced-filters/field-selector.tsx}
 */
import type { ChangeEvent, KeyboardEvent } from "react";
import { useId, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronDownIcon, Search } from "lucide-react";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { tw } from "~/utils/tw";

/**
 * Minimal fallback list for runtimes without Intl.supportedValuesOf.
 * Kept short and representative — full coverage comes from the runtime call.
 */
const TIMEZONE_FALLBACK: string[] = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/**
 * The IANA time-zone list, computed once at module scope.
 * Guards `Intl.supportedValuesOf` (not universally available; TS lib may not
 * type it) and falls back to a representative subset on failure.
 */
export const TIMEZONE_OPTIONS: string[] = (() => {
  try {
    const supported = (
      Intl as {
        supportedValuesOf?: (input: "timeZone") => string[];
      }
    ).supportedValuesOf;
    if (typeof supported === "function") {
      const list = supported("timeZone");
      if (Array.isArray(list) && list.length > 0) {
        // Ensure UTC is present so the hardcoded default is always selectable.
        return list.includes("UTC") ? list : ["UTC", ...list];
      }
    }
  } catch {
    // fall through to fallback
  }
  return TIMEZONE_FALLBACK;
})();

/** Props for the controlled timezone selector. */
type TimezoneSelectProps = {
  /** Name of the hidden input the value is submitted under. */
  name: string;
  /** Current concrete IANA time-zone name. */
  value: string;
  /** Called with the newly-chosen IANA name. */
  onChange: (value: string) => void;
  /** Optional class applied to the trigger button. */
  className?: string;
};

/**
 * Controlled, searchable timezone dropdown.
 *
 * @param props.name - Hidden-input name for form submission
 * @param props.value - Current IANA time-zone name
 * @param props.onChange - Selection callback
 * @param props.className - Optional trigger class
 * @returns The timezone selector control
 */

/**
 * Format an IANA timezone name for DISPLAY: underscores become spaces so
 * "America/New_York" reads as "America/New York" and "Africa/Addis_Ababa" as
 * "Africa/Addis Ababa". The stored/submitted value stays the raw IANA name.
 *
 * @param tz - the IANA timezone name (e.g. "America/New_York")
 * @returns the display label with underscores replaced by spaces
 */
function formatTimeZoneLabel(tz: string): string {
  return tz.replace(/_/g, " ");
}

export function TimezoneSelect({
  name,
  value,
  onChange,
  className,
}: TimezoneSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Stable id roots for combobox wiring. The listbox id backs `aria-controls`
  // and each option's id (derived from its filtered-list index) backs
  // `aria-activedescendant`, so assistive tech can announce the highlighted
  // option while DOM focus stays on the search input.
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const getOptionId = (index: number) => `${baseId}-option-${index}`;

  // Focus the search box when the popover opens (re-focuses on each open).
  // Radix portals mount on the next tick, so the hook's rAF defer is required.
  const searchInputRef = useAutoFocus<HTMLInputElement>({ when: isOpen });

  const filtered = useMemo(() => {
    if (!searchQuery) return TIMEZONE_OPTIONS;
    // Match against the human display form (underscores → spaces) and normalize
    // the query the same way, so typing "New York" matches "America/New_York".
    const q = searchQuery.toLowerCase().replace(/_/g, " ");
    return TIMEZONE_OPTIONS.filter((tz) =>
      formatTimeZoneLabel(tz).toLowerCase().includes(q)
    );
  }, [searchQuery]);

  function handleSearch(event: ChangeEvent<HTMLInputElement>) {
    setSearchQuery(event.target.value);
    setSelectedIndex(0);
  }

  function handleSelect(tz: string) {
    onChange(tz);
    setIsOpen(false);
    setSearchQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < filtered.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case "Enter":
        event.preventDefault();
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex]);
        }
        break;
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          // type="button" required by local-rules/require-button-type.
          type="button"
          className={tw(
            "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
            className
          )}
        >
          <span className="truncate text-sm font-medium text-gray-900">
            {formatTimeZoneLabel(value)}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
          <input type="hidden" name={name} value={value} />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className="z-[999999] max-h-[400px] overflow-scroll rounded-md border border-gray-200 bg-white"
          style={{ width: triggerRef?.current?.clientWidth }}
        >
          <div className="flex items-center border-b">
            <Search className="ml-4 size-4 text-gray-500" />
            <input
              ref={searchInputRef}
              // Combobox semantics: DOM focus stays here while the arrow keys
              // move the highlight, announced via aria-activedescendant.
              role="combobox"
              aria-label="Search time zone"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-activedescendant={
                filtered[selectedIndex] ? getOptionId(selectedIndex) : undefined
              }
              aria-autocomplete="list"
              placeholder="Search time zone..."
              className="border-0 px-4 py-2 pl-2 text-sm focus:border-0 focus:ring-0"
              value={searchQuery}
              onChange={handleSearch}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div id={listboxId} role="listbox" aria-label="Time zone options">
            {filtered.map((tz, index) => (
              <div
                key={tz}
                id={getOptionId(index)}
                className={tw(
                  "px-4 py-2 text-sm text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  selectedIndex === index && "bg-gray-50",
                  tz === value && "font-medium text-gray-900"
                )}
                role="option"
                aria-selected={tz === value}
                // Options are not tab stops; keyboard nav lives on the input
                // (arrow keys + Enter). Kept clickable/tappable for pointers.
                tabIndex={-1}
                onClick={() => handleSelect(tz)}
              >
                {formatTimeZoneLabel(tz)}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-2 text-sm text-gray-500">
                No time zones found
              </div>
            )}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
