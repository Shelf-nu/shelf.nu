/**
 * WeekStartSelect
 *
 * Controlled small-enum Popover selector for the first day of the week
 * ({@link WeekStartPreference}). Same listbox pattern as DateFormatSelect;
 * value rides the surrounding form via a hidden input named `name`.
 *
 * Thin wrapper over {@link EnumPreferenceSelect} — it owns only this
 * selector's OPTIONS, its `WeekStartPreference` typing, and its aria-label;
 * the shared markup/behavior lives in the generic component.
 *
 * @see {@link file://./enum-preference-select.tsx}
 * @see {@link file://./language-region-form.tsx}
 */
import type { WeekStartPreference } from "@prisma/client";
import { EnumPreferenceSelect } from "./enum-preference-select";

/** One selectable week-start option. */
type Option = {
  value: WeekStartPreference;
  label: string;
  description: string;
};

const OPTIONS: Option[] = [
  {
    value: "MONDAY",
    label: "Monday",
    description: "Weeks start on Monday",
  },
  {
    value: "SUNDAY",
    label: "Sunday",
    description: "Weeks start on Sunday",
  },
  {
    value: "SATURDAY",
    label: "Saturday",
    description: "Weeks start on Saturday",
  },
];

/** Props for the controlled week-start selector. */
type WeekStartSelectProps = {
  /** Name of the hidden input the value is submitted under. */
  name: string;
  /** Current concrete week-start preference. */
  value: WeekStartPreference;
  /** Called with the newly-chosen value. */
  onChange: (value: WeekStartPreference) => void;
  /** Optional class applied to the trigger button. */
  className?: string;
};

/**
 * Controlled week-start dropdown.
 *
 * @param props.name - Hidden-input name for form submission
 * @param props.value - Current concrete week-start preference
 * @param props.onChange - Selection callback
 * @param props.className - Optional trigger class
 * @returns The week-start selector control
 */
export function WeekStartSelect(props: WeekStartSelectProps) {
  return (
    <EnumPreferenceSelect
      {...props}
      options={OPTIONS}
      ariaLabel="Week start options"
    />
  );
}
