/**
 * DateTimePicker — shared, prefs-aware date & datetime input
 *
 * A shadcn-style picker (Radix Popover + react-day-picker DayPicker +
 * TimeSelect) that replaces the native `<input type="date">` /
 * `type="datetime-local"` fields across the app. It renders and reads dates in
 * the user's `dateFormat` / `weekStart` / `timeFormat` (via `useDateFormatter`)
 * but **emits the exact wire strings the existing servers already parse** —
 * `YYYY-MM-DD` (date) or `YYYY-MM-DDTHH:mm` (datetime, = DATE_TIME_FORMAT) —
 * through a hidden `<input name>`, so it drops into both zorm forms
 * (`zo.fields.x()`) and plain `<Form>`s without any server-side change.
 *
 * The picker operates on a NAIVE wall-clock Date: the trigger label is rendered
 * with `formatDate(..., { localeOnly: true })` (no timezone conversion), and the
 * emitted wire is the wall-clock string. Each call site's server keeps its own
 * timezone handling (booking `coerceLocalDate`, audit `DateTime.fromFormat`,
 * filters `adjustDateToUTC`, reminder/update naive parse).
 *
 * @see {@link file://../reports/timeframe-picker.tsx} composition reference
 * @see {@link file://../forms/time-select.tsx} time control
 * @see {@link file://../../hooks/use-date-formatter.ts} prefs source
 */

import type React from "react";
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarIcon, X } from "lucide-react";
import type { Matcher } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { InnerLabel } from "~/components/forms/inner-label";
import { TimeSelect } from "~/components/forms/time-select";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { tw } from "~/utils/tw";

/** CSS custom properties theming react-day-picker (mirrors timeframe-picker). */
const dayPickerStyles = {
  "--rdp-accent-color": "#F97316",
  "--rdp-accent-background-color": "#FFF7ED",
  "--rdp-day-width": "32px",
  "--rdp-day-height": "32px",
  "--rdp-day_button-width": "32px",
  "--rdp-day_button-height": "32px",
  "--rdp-months-gap": "16px",
  "--rdp-selected-font-weight": "400",
  "--rdp-range_middle-font-weight": "400",
  fontSize: "13px",
  fontWeight: 400,
} as React.CSSProperties;

/** Props for {@link DateTimePicker}. Frozen by the interfaces contract. */
export type DateTimePickerProps = {
  /** Form field name — carried by the hidden input the server reads. */
  name: string;
  /** "date" → YYYY-MM-DD; "datetime" → YYYY-MM-DDTHH:mm. Default "date". */
  mode?: "date" | "datetime";
  /** Controlled wire string. */
  value?: string;
  /** Uncontrolled initial wire string. */
  defaultValue?: string;
  /** Called with the new wire string on every change. */
  onChange?: (wire: string) => void;
  /** Earliest selectable date (inclusive). */
  min?: Date;
  /** Latest selectable date (inclusive). */
  max?: Date;
  /** Field label. */
  label?: string;
  /** Visually hide the label on large screens. */
  hideLabel?: boolean;
  /** Server/validation error to display below the field. */
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Trigger placeholder when no value is selected. */
  placeholder?: string;
  /** Show a Clear affordance that empties the field. */
  clearable?: boolean;
};

/**
 * Parse a wire string into a NAIVE local Date + a 24h `HH:mm` time string.
 * Uses component-wise construction (never `Date.parse`) so a bare `YYYY-MM-DD`
 * is not interpreted as UTC midnight and shifted across the date line.
 *
 * @param wire - `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (or undefined/empty)
 * @returns `{ date, time }` — `date` undefined for empty/invalid input
 */
export function parseWireToParts(wire: string | undefined): {
  date: Date | undefined;
  time: string;
} {
  if (!wire) return { date: undefined, time: "" };
  const [datePart, timePart] = wire.split("T");
  const [y, m, d] = datePart.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return { date: undefined, time: "" };
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return { date: undefined, time: "" };
  return { date, time: timePart ? timePart.slice(0, 5) : "" };
}

/**
 * Build the wire string from a selected Date + 24h time for the given mode.
 *
 * @param date - selected day (naive wall-clock) or undefined
 * @param time - 24h `HH:mm` (datetime mode); ignored for date mode
 * @param mode - "date" | "datetime"
 * @returns wire string, or "" when no date is selected
 */
export function partsToWire(
  date: Date | undefined,
  time: string,
  mode: "date" | "datetime"
): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const datePart = `${y}-${m}-${d}`;
  if (mode === "date") return datePart;
  return `${datePart}T${time || "00:00"}`;
}

/**
 * Shared date / datetime picker. See file header for the wire contract.
 *
 * @param props - {@link DateTimePickerProps}
 */
export function DateTimePicker({
  name,
  mode = "date",
  value,
  defaultValue,
  onChange,
  min,
  max,
  label,
  hideLabel,
  error,
  disabled = false,
  required = false,
  className,
  placeholder = "Select date",
  clearable = false,
}: DateTimePickerProps) {
  const { prefs, formatDate } = useDateFormatter();
  const isControlled = value !== undefined;

  const [open, setOpen] = useState(false);
  const [internalWire, setInternalWire] = useState<string>(
    () => value ?? defaultValue ?? ""
  );

  // In controlled mode, reflect the external value into internal state.
  useEffect(() => {
    if (isControlled) setInternalWire(value ?? "");
  }, [isControlled, value]);

  const wire = internalWire;
  const { date: selectedDate, time } = parseWireToParts(wire);

  /** Commit a new wire string: update internal state + notify parent. */
  const commit = (nextWire: string) => {
    setInternalWire(nextWire);
    onChange?.(nextWire);
  };

  const handleDaySelect = (day: Date | undefined) => {
    // Datetime keeps the current time, or defaults to 09:00 for a fresh pick.
    const nextTime = mode === "datetime" ? time || "09:00" : "";
    commit(partsToWire(day, nextTime, mode));
    if (mode === "date") setOpen(false);
  };

  const handleTimeChange = (nextTime: string) => {
    commit(partsToWire(selectedDate ?? new Date(), nextTime, mode));
  };

  const handleClear = () => {
    commit("");
    setOpen(false);
  };

  // Trigger label uses localeOnly so the wall-clock value is shown verbatim
  // (no timezone conversion of the picker's naive Date).
  const displayLabel = selectedDate
    ? formatDate(selectedDate, {
        localeOnly: true,
        includeTime: mode === "datetime",
      })
    : placeholder;

  // Build react-day-picker disabled matchers from min/max bounds.
  const disabledMatchers: Matcher[] = [];
  if (min) disabledMatchers.push({ before: min });
  if (max) disabledMatchers.push({ after: max });

  return (
    <div className={tw("w-full", className)}>
      {label ? (
        <InnerLabel hideLg={hideLabel} required={required}>
          {label}
        </InnerLabel>
      ) : null}

      {/* Hidden field carries the wire string to the server — works for both
          zorm (zo.fields.x()) and plain-name forms. */}
      <input type="hidden" name={name} value={wire} />

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={label ?? "Select date"}
            className={tw(
              "flex w-full items-center gap-2 rounded border px-3.5 py-2 text-left text-sm transition-colors",
              "focus:outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-100",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error
                ? "border-error-500"
                : "border-gray-300 hover:border-gray-400",
              !selectedDate && "text-gray-500"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-gray-500" />
            <span className="truncate">{displayLabel}</span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className={tw(
              "z-50 rounded border border-gray-200 bg-white p-4 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
            sideOffset={8}
            align="start"
          >
            {/* react-doctor-safe static <style> forcing non-bold day buttons */}
            <style>{`
              .rdp-day button,
              .rdp-day_button,
              .rdp-selected .rdp-day_button {
                font-weight: 400 !important;
              }
            `}</style>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDaySelect}
              showOutsideDays
              weekStartsOn={prefs.weekStartsOn}
              disabled={
                disabledMatchers.length > 0 ? disabledMatchers : undefined
              }
              style={dayPickerStyles}
            />

            {mode === "datetime" ? (
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                <span className="text-xs font-medium text-gray-600">Time</span>
                <TimeSelect
                  // Namespaced, display-only helper field: the datetime wire is
                  // already carried by the hidden input above; this name is not
                  // read by any server action.
                  name={`${name}__time`}
                  value={time || "09:00"}
                  onValueChange={handleTimeChange}
                  timeFormat={prefs.timeFormat}
                  aria-label="Select time"
                />
              </div>
            ) : null}

            {clearable && selectedDate ? (
              <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
                >
                  <X className="size-3" />
                  Clear
                </button>
              </div>
            ) : null}

            <Popover.Arrow className="fill-white" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error ? (
        <div className="mt-1 text-sm text-error-500">{error}</div>
      ) : null}
    </div>
  );
}

export default DateTimePicker;
