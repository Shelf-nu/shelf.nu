import type { FC } from "react";
import { useEffect, useState } from "react";
import { format, parse } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";

/**
 * Represents a time option for the select dropdown
 */
interface TimeOption {
  /** Display value in 12-hour format (e.g., "9:00 AM") */
  label: string;
  /** Value in 24-hour format for database storage (e.g., "09:00") */
  value: string;
}

/**
 * Props for the TimeSelect component
 */
interface TimeSelectProps {
  /** Form field name */
  name: string;
  /** Current value in 24-hour format (HH:MM) - for controlled mode */
  value?: string;
  /** Default value in 24-hour format (HH:MM) - for uncontrolled mode */
  defaultValue?: string;
  /** Callback when time selection changes, receives 24-hour format */
  onValueChange?: (value: string) => void;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Placeholder text when no value is selected */
  placeholder?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Error message to display */
  error?: string;
  /** Aria label for accessibility */
  "aria-label"?: string;
}

const TIME_FORMAT_24H = "HH:mm";
const TIME_FORMAT_12H = "h:mm a";

/**
 * Converts 24-hour time format to 12-hour format with AM/PM using date-fns
 * @param time24 - Time in 24-hour format (HH:MM)
 * @returns Time in 12-hour format (h:MM AM/PM)
 */
function convert24To12Hour(time24: string): string {
  try {
    // Parse the 24-hour time string into a Date object using an arbitrary date
    const date = parse(time24, TIME_FORMAT_24H, new Date(2000, 0, 1));
    // Format it as 12-hour time with AM/PM (uppercase)
    return format(date, TIME_FORMAT_12H);
  } catch (error) {
    throw new Error(`Invalid 24-hour time format: ${time24}`);
  }
}

/**
 * Converts 12-hour time format to 24-hour format using date-fns
 * @param time12 - Time in 12-hour format (h:MM AM/PM)
 * @returns Time in 24-hour format (HH:MM)
 */
function convert12To24Hour(time12: string): string {
  try {
    // Parse the 12-hour time string into a Date object using an arbitrary date
    const date = parse(time12, TIME_FORMAT_12H, new Date(2000, 0, 1));
    // Format it as 24-hour time
    return format(date, TIME_FORMAT_24H);
  } catch (error) {
    throw new Error(`Invalid 12-hour time format: ${time12}`);
  }
}

/**
 * Generates all time options from 12:00 AM to 11:45 PM in 15-minute increments,
 * with an additional 11:59 PM option at the end
 * @returns Array of time options with 12-hour labels and 24-hour values
 */
function generateTimeOptions(): TimeOption[] {
  const options: TimeOption[] = [];

  // Generate times for each 15-minute increment in a day
  for (let hours = 0; hours < 24; hours++) {
    for (let minutes = 0; minutes < 60; minutes += 15) {
      const time24 = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
      const time12 = convert24To12Hour(time24);

      options.push({
        label: time12,
        value: time24,
      });
    }
  }

  // Add 11:59 PM as end-of-day option for closing times
  options.push({
    label: "11:59 PM",
    value: "23:59", // Use 23:59 to represent "until midnight"
  });

  return options;
}

/**
 * Finds the display label for a given 24-hour time value
 * @param value24 - Time in 24-hour format
 * @returns Display label in 12-hour format, or empty string if not found
 */
function getDisplayLabel(value24: string): string {
  // First check if it's the special 23:59 case
  if (value24 === "23:59") {
    return "11:59 PM";
  }

  try {
    return convert24To12Hour(value24);
  } catch {
    return "";
  }
}

// Generate time options once at module level for performance
const TIME_OPTIONS = generateTimeOptions();

/**
 * TimeSelect Component
 *
 * A reusable time selection component that displays times in 12-hour AM/PM format
 * for user-friendly interaction while handling 24-hour format for database storage.
 *
 * Supports both controlled and uncontrolled modes:
 * - Controlled: Use `value` and `onValueChange`
 * - Uncontrolled: Use `defaultValue` (typical for form libraries)
 *
 * Features:
 * - 15-minute increments from 12:00 AM to 11:45 PM, plus 11:59 PM
 * - Automatic conversion between 12-hour display and 24-hour storage formats
 * - Consistent styling with existing Select components
 * - Full TypeScript type safety
 * - Accessibility support
 *
 * @example
 * ```tsx
 * // Controlled mode
 * <TimeSelect
 *   name="openTime"
 *   value="09:00"
 *   onValueChange={(time24) => setOpenTime(time24)}
 *   placeholder="Select opening time"
 *   required
 * />
 *
 * // Uncontrolled mode (typical for forms)
 * <TimeSelect
 *   name="openTime"
 *   defaultValue="09:00"
 *   placeholder="Select opening time"
 *   required
 * />
 * ```
 */
export const TimeSelect: FC<TimeSelectProps> = ({
  name,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  placeholder = "Select time",
  required = false,
  className,
  error,
  "aria-label": ariaLabel,
}) => {
  // Determine if we're in controlled mode
  const isControlled = value !== undefined;

  // Internal state to manage the current selection
  // Initialize with value (controlled) or defaultValue (uncontrolled) or empty string
  const [internalValue, setInternalValue] = useState<string>(
    () => value ?? defaultValue ?? ""
  );

  // In controlled mode, sync internal state with external value
  useEffect(() => {
    if (isControlled && value !== internalValue) {
      setInternalValue(value ?? "");
    }
  }, [value, isControlled, internalValue]);

  // The current value to display - always use internal state
  const currentValue = internalValue;
  const displayValue = currentValue ? getDisplayLabel(currentValue) : undefined;

  const handleValueChange = (selectedValue: string): void => {
    // Always update internal state
    setInternalValue(selectedValue);

    // In controlled mode, notify parent
    // In uncontrolled mode, parent can still listen if they want
    onValueChange?.(selectedValue);
  };

  return (
    <div className="w-full">
      <Select
        name={name}
        value={currentValue} // Always controlled with internal state
        onValueChange={handleValueChange}
        disabled={disabled}
        required={required}
      >
        <SelectTrigger
          aria-label={ariaLabel || "Select time"}
          className={`mt-2 w-[110px] px-3.5 py-2 text-left text-sm text-gray-500 md:mt-0 ${
            className || ""
          } ${error ? "border-error-500 focus:border-error-500" : ""}`}
        >
          <SelectValue placeholder={placeholder}>
            {displayValue || placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-full min-w-[200px] p-0"
          align="start"
        >
          <div className="max-h-[320px] overflow-auto">
            {TIME_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
              >
                <span className="mr-4 block text-[14px] text-gray-700">
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
      {error && <div className="mt-1 text-sm text-error-500">{error}</div>}
    </div>
  );
};

// Export utility functions for use in other components if needed
export { convert24To12Hour, convert12To24Hour, generateTimeOptions };

// Export types for external use
export type { TimeSelectProps, TimeOption };
