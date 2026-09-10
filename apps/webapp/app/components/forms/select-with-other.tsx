import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";

import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";

import Input from "~/components/forms/input";
import When from "~/components/when/when";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { resolveSelectState } from "~/utils/options";
import { tw } from "~/utils/tw";

export const OTHER_OPTION_VALUE = "other";

/**
 * Value submitted by the no-JavaScript fallback when the user picks "Other".
 *
 * It is a plain human-readable string rather than {@link OTHER_OPTION_VALUE} so
 * that it is safe to persist as-is, and so that re-rendering the form with it as
 * `defaultValue` puts the enhanced control into its "Other" state with "Other"
 * as the custom text (see `resolveSelectState`).
 */
const OTHER_FALLBACK_VALUE = "Other";

/** Classes shared by the enhanced trigger and the fallback <select>. */
const CONTROL_CLASSES =
  "h-[44px] w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-gray-900 hover:border-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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

/**
 * Server-rendered version of the control that works without JavaScript.
 *
 * The enhanced control is a Radix popover writing into a hidden input, so it is
 * inert until React hydrates. Onboarding is the first screen of the product and
 * these answers are required, so a browser that never hydrates (JavaScript
 * blocked, a bundle that fails to parse, an extension breaking the page) would
 * otherwise dead-end the signup with no way to answer. A native <select> carries
 * the same `name`, submits with the plain form POST, and supports type-ahead and
 * the browser's own required-field validation with no scripting at all.
 */
function UnhydratedSelectWithOther({
  label,
  name,
  options,
  error,
  defaultValue,
  placeholder = "Select an option",
  required,
  children,
  className,
  selectRef,
}: SelectWithOtherProps & {
  selectRef?: RefObject<HTMLSelectElement | null>;
}) {
  const { selection, customValue } = resolveSelectState(
    options,
    defaultValue ?? undefined
  );

  /**
   * A previously stored free-text answer is not in `options`, so it needs its
   * own <option> or the select would silently drop it on the next submit.
   */
  const preservedCustomValue =
    selection === OTHER_OPTION_VALUE && customValue !== OTHER_FALLBACK_VALUE
      ? customValue
      : null;

  const selectedValue =
    selection === OTHER_OPTION_VALUE
      ? preservedCustomValue ?? OTHER_FALLBACK_VALUE
      : selection;

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={name} required={required}>
        {label}
      </FieldLabel>
      <select
        ref={selectRef}
        id={name}
        name={name}
        required={required}
        defaultValue={selectedValue}
        className={tw(
          CONTROL_CLASSES,
          // Greys out the placeholder the way the enhanced trigger does: a
          // required select with no answer is :invalid.
          required && "invalid:text-gray-500",
          error &&
            "border-error-300 focus:border-error-300 focus:ring-error-100",
          className
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        {preservedCustomValue ? (
          <option value={preservedCustomValue}>{preservedCustomValue}</option>
        ) : null}
        <option value={OTHER_FALLBACK_VALUE}>{OTHER_FALLBACK_VALUE}</option>
      </select>
      {error ? <p className="text-sm text-error-500">{error}</p> : null}
      {children}
    </div>
  );
}

/**
 * A single-choice field with a free-text "Other" escape hatch.
 *
 * Renders a plain <select> on the server and swaps to the styled popover once
 * React has hydrated, so the field is answerable even when the page's
 * JavaScript never runs. Mirrors the `useHydrated` split used by the app's
 * other dropdowns (see `components/kits/actions-dropdown.tsx`).
 */
export function SelectWithOther(props: SelectWithOtherProps) {
  const isHydrated = useHydrated();
  const fallbackRef = useRef<HTMLSelectElement>(null);

  if (!isHydrated) {
    return <UnhydratedSelectWithOther {...props} selectRef={fallbackRef} />;
  }

  /**
   * The fallback is a real control, so on a slow connection the user can answer
   * it before the bundle arrives. React has not committed its removal yet while
   * this render runs, so read the live answer here: seeding the enhanced control
   * from `defaultValue` alone would silently throw that answer away and leave a
   * required field empty.
   *
   * The ref, not the value, decides which one wins. An empty live value means
   * the user cleared the field on purpose and must stay cleared, while a missing
   * ref means the fallback never rendered — a client-side navigation onto the
   * form — and the saved answer is all there is. `EnhancedSelectWithOther` only
   * reads `defaultValue` to seed its initial state, so it does not matter that
   * the ref is empty again on later renders.
   */
  const fallbackSelect = fallbackRef.current;

  return (
    <EnhancedSelectWithOther
      {...props}
      defaultValue={fallbackSelect ? fallbackSelect.value : props.defaultValue}
    />
  );
}

function EnhancedSelectWithOther({
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
  const inputId = `${name}-other`;

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
              "flex items-center justify-between",
              CONTROL_CLASSES,
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
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(option)}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option)
                  )}
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
              role="button"
              tabIndex={0}
              onClick={() => handleSelect(OTHER_OPTION_VALUE)}
              onKeyDown={handleActivationKeyPress(() =>
                handleSelect(OTHER_OPTION_VALUE)
              )}
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
