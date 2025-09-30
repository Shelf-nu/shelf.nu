import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import Input from "~/components/forms/input";
import When from "~/components/when/when";
import { resolveSelectState } from "~/utils/options";
import { tw } from "~/utils/tw";

export const OTHER_OPTION_VALUE = "other";

type SelectWithOtherProps = {
  /** Accessible label for the select field. */
  label: ReactNode;
  /** Name for the hidden input that will hold the resolved value. */
  name: string;
  /** Options displayed in the select. */
  options: readonly string[];
  /** Error message to display underneath the control. */
  error?: string;
  /** Initial value coming from persisted data. */
  defaultValue?: string | null;
  /** Placeholder text shown when no value has been chosen. */
  placeholder?: string;
  /** Whether the associated answer is required. */
  required?: boolean;
  /** Additional content rendered under the field (e.g. helper text). */
  children?: ReactNode;
  /**
   * Label for the free-form text input that appears when "Other" is selected.
   * The label is visually hidden but read by screen readers.
   */
  otherInputLabel: string;
  /** Placeholder for the free-form text input. */
  otherInputPlaceholder?: string;
  /**
   * Invoked whenever the resolved value (preset or custom) changes. The value
   * is trimmed and may be an empty string when nothing has been provided.
   */
  onValueChange?: (value: string) => void;
  /** Additional class name for styling. */
  className?: string;
};

function FieldLabel({
  children,
  htmlFor,
  required,
}: {
  children: ReactNode;
  htmlFor: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-2" htmlFor={htmlFor}>
      <span className="text-sm font-medium text-gray-700">
        {children}
        {required ? <span className="ml-1 text-error-500">*</span> : null}
      </span>
    </label>
  );
}

export function SelectWithOther({
  label,
  name,
  options,
  error,
  defaultValue,
  placeholder = "Select an option",
  required,
  children,
  otherInputLabel,
  otherInputPlaceholder,
  onValueChange,
  className,
}: SelectWithOtherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputId = useMemo(() => `${name}-other`, [name]);

  const { selection: initialSelection, customValue: initialOther } = useMemo(
    () => resolveSelectState(options, defaultValue ?? undefined),
    [options, defaultValue]
  );

  const [isOpen, setIsOpen] = useState(false);
  const [selection, setSelection] = useState(initialSelection);
  const [otherValue, setOtherValue] = useState(initialOther);
  const [selectedIndex, setSelectedIndex] = useState<number>(() => {
    if (!initialSelection) return 0;
    if (initialSelection === OTHER_OPTION_VALUE) return options.length;
    return options.findIndex((opt) => opt === initialSelection);
  });

  const resolvedValue =
    selection === OTHER_OPTION_VALUE ? otherValue : selection;

  useEffect(() => {
    onValueChange?.(resolvedValue);
  }, [resolvedValue, onValueChange]);

  const allOptions = useMemo(() => [...options, OTHER_OPTION_VALUE], [options]);

  function handleSelect(value: string) {
    setSelection(value as typeof selection);
    if (value !== OTHER_OPTION_VALUE) {
      setOtherValue("");
    }
    setIsOpen(false);
  }

  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(
        `${name}-option-${index}`
      );
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev < allOptions.length - 1 ? prev + 1 : prev;
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
        if (allOptions[selectedIndex]) {
          handleSelect(allOptions[selectedIndex]);
        }
        break;
    }
  };

  const selectedLabel = useMemo(() => {
    if (!selection) return placeholder;
    if (selection === OTHER_OPTION_VALUE) return otherValue || "Other";
    return selection;
  }, [selection, otherValue, placeholder]);

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={inputId} required={required}>
        {label}
      </FieldLabel>
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
            type="button"
            tabIndex={0}
            className={tw(
              "flex h-[44px] w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-gray-900 hover:border-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
              !selection && "text-gray-500",
              error &&
                "border-error-300 focus:border-error-300 focus:ring-error-100",
              className
            )}
            aria-label={typeof label === "string" ? label : undefined}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronDownIcon className="ml-2 size-4 shrink-0 text-gray-500" />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] max-h-[320px] overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"
            side="bottom"
            align="start"
            style={{ width: triggerRef?.current?.clientWidth }}
            onKeyDown={handleKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = selection === option;
              const isHovered = selectedIndex === index;

              return (
                <div
                  id={`${name}-option-${index}`}
                  key={option}
                  className={tw(
                    "flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:cursor-pointer hover:bg-gray-50",
                    isHovered && "bg-gray-50"
                  )}
                  onClick={() => handleSelect(option)}
                >
                  <span className="font-medium">{option}</span>
                  <When truthy={isSelected}>
                    <CheckIcon className="size-4 text-primary" />
                  </When>
                </div>
              );
            })}
            <div
              id={`${name}-option-${options.length}`}
              className={tw(
                "flex items-center justify-between px-4 py-3 text-sm text-gray-700 hover:cursor-pointer hover:bg-gray-50",
                selectedIndex === options.length && "bg-gray-50"
              )}
              onClick={() => handleSelect(OTHER_OPTION_VALUE)}
            >
              <span className="font-medium">Other</span>
              <When truthy={selection === OTHER_OPTION_VALUE}>
                <CheckIcon className="size-4 text-primary" />
              </When>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
      <input type="hidden" name={name} value={resolvedValue} />
      <When truthy={selection === OTHER_OPTION_VALUE}>
        <div className="mt-2">
          <Input
            id={inputId}
            label={otherInputLabel}
            hideLabel
            placeholder={otherInputPlaceholder}
            value={otherValue}
            onChange={(event) => setOtherValue(event.target.value)}
            hideErrorText
          />
        </div>
      </When>
      {error ? <p className="text-sm text-error-500">{error}</p> : null}
      {children}
    </div>
  );
}
