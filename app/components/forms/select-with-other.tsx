import { useEffect, useMemo, useState } from "react";
import type { PropsWithChildren, ReactNode } from "react";

import Input from "~/components/forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import When from "~/components/when/when";

import { resolveSelectState } from "~/utils/options";

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
   * Label for the free-form text input that appears when “Other” is selected.
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
};

type FieldLabelProps = PropsWithChildren<{
  htmlFor: string;
  required?: boolean;
}>;

function FieldLabel({ children, htmlFor, required }: FieldLabelProps) {
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
}: SelectWithOtherProps) {
  const inputId = useMemo(() => `${name}-other`, [name]);
  const { selection: initialSelection, customValue: initialOther } = useMemo(
    () => resolveSelectState(options, defaultValue ?? undefined),
    [options, defaultValue]
  );

  const [selection, setSelection] = useState(initialSelection);
  const [otherValue, setOtherValue] = useState(initialOther);

  const resolvedValue =
    selection === OTHER_OPTION_VALUE ? otherValue : selection;

  useEffect(() => {
    onValueChange?.(resolvedValue);
  }, [resolvedValue, onValueChange]);

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={inputId} required={required}>
        {label}
      </FieldLabel>
      <Select
        value={selection || undefined}
        onValueChange={(value) => {
          setSelection(value as typeof selection);
          if (value !== OTHER_OPTION_VALUE) {
            setOtherValue("");
          }
        }}
      >
        <SelectTrigger
          aria-label={typeof label === "string" ? label : undefined}
          className="px-3 py-2 text-left text-gray-900 data-[placeholder]:text-gray-500"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[260px]"
          align="start"
        >
          <div className="max-h-60 overflow-auto">
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
            <SelectItem value={OTHER_OPTION_VALUE}>Other</SelectItem>
          </div>
        </SelectContent>
      </Select>
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
