/**
 * DateFormatSelect
 *
 * Controlled small-enum Popover selector for a user's short-date field order
 * ({@link DateFormatPreference}). Mirrors the workspace date-format selector's
 * listbox pattern, but is controlled (`value` + `onChange`) so the parent
 * LanguageRegionForm can drive its live "Dates will look like…" preview. The
 * chosen value rides the surrounding form via a hidden input named `name`.
 *
 * Thin wrapper over {@link EnumPreferenceSelect} — it owns only this
 * selector's OPTIONS, its `DateFormatPreference` typing, and its aria-label;
 * the shared markup/behavior lives in the generic component.
 *
 * @see {@link file://./enum-preference-select.tsx}
 * @see {@link file://./language-region-form.tsx}
 */
import type { DateFormatPreference } from "@prisma/client";
import { EnumPreferenceSelect } from "./enum-preference-select";

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
export function DateFormatSelect(props: DateFormatSelectProps) {
  return (
    <EnumPreferenceSelect
      {...props}
      options={OPTIONS}
      ariaLabel="Date format options"
    />
  );
}
