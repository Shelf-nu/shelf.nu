/**
 * EnumPreferenceSelect
 *
 * Generic controlled small-enum Popover selector shared by the language/region
 * preference dropdowns (date format, time format, week start). Renders a Radix
 * Popover with a listbox of `{ value, label, description }` options; the chosen
 * value rides the surrounding form via a hidden input named `name`, and the
 * control is fully controlled (`value` + `onChange`) so a parent form can drive
 * a live preview.
 *
 * Each concrete selector (DateFormatSelect, TimeFormatSelect, WeekStartSelect)
 * is a thin wrapper that supplies its own typed `options` and `ariaLabel`; the
 * entire Popover / trigger / hidden-input / listbox / keyboard / selection
 * markup lives here so the three stay byte-identical in behavior.
 *
 * @see {@link file://./date-format-select.tsx}
 * @see {@link file://./time-format-select.tsx}
 * @see {@link file://./week-start-select.tsx}
 * @see {@link file://./language-region-form.tsx}
 */
import { useRef, useState } from "react";

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

/**
 * Props for the generic enum preference selector.
 *
 * @typeParam T - The string-enum value type the selector chooses between.
 */
export type EnumPreferenceSelectProps<T extends string> = {
  /** Name of the hidden input the value is submitted under. */
  name: string;
  /** Current concrete preference value. */
  value: T;
  /** Called with the newly-chosen value. */
  onChange: (value: T) => void;
  /** The selectable options, in display order. */
  options: { value: T; label: string; description: string }[];
  /** Accessible label for the listbox popover. */
  ariaLabel: string;
  /** Optional class applied to the trigger button. */
  className?: string;
};

/**
 * Generic controlled small-enum dropdown.
 *
 * @typeParam T - The string-enum value type the selector chooses between.
 * @param props.name - Hidden-input name for form submission
 * @param props.value - Current concrete preference value
 * @param props.onChange - Selection callback
 * @param props.options - Selectable options in display order
 * @param props.ariaLabel - Accessible label for the listbox popover
 * @param props.className - Optional trigger class
 * @returns The enum preference selector control
 */
export function EnumPreferenceSelect<T extends string>({
  name,
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: EnumPreferenceSelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  function handleSelect(next: T) {
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
          aria-label={ariaLabel}
        >
          {options.map((option) => {
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
