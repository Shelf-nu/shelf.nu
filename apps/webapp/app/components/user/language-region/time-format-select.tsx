/**
 * TimeFormatSelect
 *
 * Controlled small-enum Popover selector for the 12- vs 24-hour clock
 * ({@link TimeFormatPreference}). Same listbox pattern as DateFormatSelect;
 * value rides the surrounding form via a hidden input named `name`.
 *
 * @see {@link file://./language-region-form.tsx}
 */
import { useRef, useState } from "react";

import type { TimeFormatPreference } from "@prisma/client";
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

/** One selectable time-format option. */
type Option = {
  value: TimeFormatPreference;
  label: string;
  description: string;
};

const OPTIONS: Option[] = [
  { value: "H12", label: "12-hour", description: "e.g. 2:30 PM" },
  { value: "H24", label: "24-hour", description: "e.g. 14:30" },
];

/** Props for the controlled time-format selector. */
type TimeFormatSelectProps = {
  /** Name of the hidden input the value is submitted under. */
  name: string;
  /** Current concrete time-format preference. */
  value: TimeFormatPreference;
  /** Called with the newly-chosen value. */
  onChange: (value: TimeFormatPreference) => void;
  /** Optional class applied to the trigger button. */
  className?: string;
};

/**
 * Controlled time-format dropdown.
 *
 * @param props.name - Hidden-input name for form submission
 * @param props.value - Current concrete time-format preference
 * @param props.onChange - Selection callback
 * @param props.className - Optional trigger class
 * @returns The time-format selector control
 */
export function TimeFormatSelect({
  name,
  value,
  onChange,
  className,
}: TimeFormatSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption =
    OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];

  function handleSelect(next: TimeFormatPreference) {
    onChange(next);
    setIsOpen(false);
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
          aria-label="Time format options"
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
