/**
 * TimeFormatSelect
 *
 * Controlled small-enum Popover selector for the 12- vs 24-hour clock
 * ({@link TimeFormatPreference}). Same listbox pattern as DateFormatSelect;
 * value rides the surrounding form via a hidden input named `name`.
 *
 * Thin wrapper over {@link EnumPreferenceSelect} — it owns only this
 * selector's OPTIONS, its `TimeFormatPreference` typing, and its aria-label;
 * the shared markup/behavior lives in the generic component.
 *
 * @see {@link file://./enum-preference-select.tsx}
 * @see {@link file://./language-region-form.tsx}
 */
import type { TimeFormatPreference } from "@prisma/client";
import { EnumPreferenceSelect } from "./enum-preference-select";

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
export function TimeFormatSelect(props: TimeFormatSelectProps) {
  return (
    <EnumPreferenceSelect
      {...props}
      options={OPTIONS}
      ariaLabel="Time format options"
    />
  );
}
