/**
 * DateFormatSelect
 *
 * Controlled small-enum Popover selector for a user's short-date field order
 * ({@link DateFormatPreference}). Mirrors the workspace date-format selector's
 * listbox pattern, but is controlled (`value` + `onChange`) so the parent
 * LanguageRegionForm can drive its live "Dates will look like…" preview. The
 * chosen value rides the surrounding form via a hidden input named `name`.
 *
 * @see {@link file://./language-region-form.tsx}
 */
import { useRef, useState } from "react";

import type { DateFormatPreference } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import When from "~/components/when/when";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";

/** One selectable date-format option. */
type Option = {
  value: DateFormatPreference;
  label: string;
  description: string;
};

const OPTIONS: Option[] = [
  {
    value: "DD_MM_YYYY",
    label: "Day / Month / Year",
    description: "e.g. 03/04/2026",
  },
  {
    value: "MM_DD_YYYY",
    label: "Month / Day / Year",
    description: "e.g. 04/03/2026",
  },
  {
    value: "YYYY_MM_DD",
    label: "Year / Month / Day",
    description: "e.g. 2026-04-03",
  },
];

/** Props for the controlled date-format selector. */
type DateFormatSelectProps = {
  /** Name of the hidden input the value is submitted under. */
  name: string;
  /** Current concrete date-format preference. */
  value: DateFormatPreference;
  /** Called with the newly-chosen value. */
  onChange: (value: DateFormatPreference) => void;
  /** Optional class applied to the trigger button. */
  className?: string;
};

/**
 * Controlled date-format dropdown.
 *
 * @param props.name - Hidden-input name for form submission
 * @param props.value - Current concrete date-format preference
 * @param props.onChange - Selection callback
 * @param props.className - Optional trigger class
 * @returns The date-format selector control
 */
export function DateFormatSelect({
  name,
  value,
  onChange,
  className,
}: DateFormatSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption =
    OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  function handleSelect(next: DateFormatPreference) {
    onChange(next);
    setIsOpen(false);
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          // type="button" required by local-rules/require-button-type — the
          // trigger sits inside the LanguageRegionForm <Form>, so the native
          // "submit" default would submit on open.
          type="button"
          className={tw(
            "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
            className
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-gray-900">
              {selectedOption.label}
            </span>
            <span className="truncate text-xs text-gray-500">
              {selectedOption.description}
            </span>
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
          <input type="hidden" name={name} value={selectedOption.value} />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
          side="bottom"
          style={{ width: triggerRef?.current?.clientWidth }}
          role="listbox"
          aria-label="Date format options"
        >
          {OPTIONS.map((option) => {
            const isSelected = selectedOption.value === option.value;
            return (
              <div
                key={option.value}
                className="flex items-start justify-between gap-3 px-4 py-3 hover:cursor-pointer hover:bg-gray-50"
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => handleSelect(option.value)}
                onKeyDown={handleActivationKeyPress(() =>
                  handleSelect(option.value)
                )}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span className="text-xs text-gray-500">
                    {option.description}
                  </span>
                </div>
                <When truthy={isSelected}>
                  <CheckIcon className="size-4 shrink-0 text-primary" />
                </When>
              </div>
            );
          })}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
