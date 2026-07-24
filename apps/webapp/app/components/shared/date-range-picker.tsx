/**
 * DateRangePicker — shared, prefs-aware calendar date-range input
 *
 * A shadcn-style range picker built on Radix `Popover` + react-day-picker v9
 * (`mode="range"`, two months side by side). It is the range counterpart to the
 * single-date {@link DateTimePicker} and reuses the same calendar styling
 * primitives (`RDP_STYLE` / `RDP_CLASS_NAMES` / `CalendarChevron`) so both
 * calendars render 1:1.
 *
 * The component deals exclusively in **calendar dates** (date-only, no
 * time-of-day, no timezone conversion): `value`/`onChange` carry naive `Date`
 * objects representing wall-clock days, and — when `startName`/`endName` are
 * supplied — it emits hidden `<input>`s carrying date-only `YYYY-MM-DD` wires so
 * it drops into any `<Form>` without server changes. Consumers that need
 * timezone boundaries (e.g. start-of-day / end-of-day in the user's zone) apply
 * them on top of the returned dates.
 *
 * The trigger label is rendered through `useDateFormatter` so the summary
 * ("Jul 20, 2026 – Jul 24, 2026") honors the user's `dateFormat` pref.
 *
 * @see {@link file://./date-time-picker.tsx} single-date sibling + wire helpers
 * @see {@link file://./calendar-styles.tsx} shared calendar styling
 * @see {@link file://../../hooks/use-date-formatter.ts} prefs source
 */

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarIcon } from "lucide-react";
import type { DateRange, Matcher } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { useDateFormatter } from "~/hooks/use-date-formatter";
import { tw } from "~/utils/tw";
import {
  calendarBounds,
  CalendarChevron,
  RDP_CLASS_NAMES,
  RDP_STYLE,
} from "./calendar-styles";
import { partsToWire } from "./date-time-picker";

/** A calendar date range. Both ends optional (partial selection is valid). */
export type DateRangeValue = {
  /** Range start (inclusive), or undefined when nothing is selected. */
  from?: Date;
  /** Range end (inclusive), or undefined while only the start is picked. */
  to?: Date;
};

/** Props for {@link DateRangePicker}. */
export type DateRangePickerProps = {
  /** Controlled selected range. */
  value?: DateRangeValue;
  /** Called with the new range on every calendar selection. */
  onChange?: (range: DateRangeValue) => void;
  /**
   * Form field name for the range START. When set, a hidden `<input>` carries
   * the start as a date-only `YYYY-MM-DD` wire for form submission.
   */
  startName?: string;
  /**
   * Form field name for the range END. When set, a hidden `<input>` carries the
   * end as a date-only `YYYY-MM-DD` wire for form submission.
   */
  endName?: string;
  /** Trigger label shown when no range is selected. */
  placeholder?: string;
  /** Earliest selectable day (inclusive). */
  min?: Date;
  /** Latest selectable day (inclusive). */
  max?: Date;
  disabled?: boolean;
  /** Server/validation error to display below the trigger. */
  error?: string;
  className?: string;
};

/**
 * Format a calendar Date as a date-only `YYYY-MM-DD` wire (naive wall-clock,
 * never tz-shifted). Reuses {@link partsToWire} so the wire matches the format
 * the single-date picker emits and the servers already parse.
 *
 * @param date - the calendar day, or undefined
 * @returns the `YYYY-MM-DD` wire, or "" when no date
 */
function dateToWire(date: Date | undefined): string {
  return partsToWire(date, "", "date");
}

/**
 * Shared calendar date-range picker. See the file header for the wire contract.
 *
 * @param props - {@link DateRangePickerProps}
 */
export function DateRangePicker({
  value,
  onChange,
  startName,
  endName,
  placeholder = "Select start and end date",
  min,
  max,
  disabled = false,
  error,
  className,
}: DateRangePickerProps) {
  const { formatDate, prefs } = useDateFormatter();
  const [open, setOpen] = useState(false);

  const from = value?.from;
  const to = value?.to;

  // react-day-picker's optional range shape. undefined when nothing is picked.
  const selected: DateRange | undefined = from || to ? { from, to } : undefined;

  /** Map the calendar's range selection back onto the {from,to} contract. */
  const handleSelect = (range: DateRange | undefined) => {
    onChange?.({ from: range?.from, to: range?.to });
  };

  // Build react-day-picker disabled matchers from min/max bounds.
  const disabledMatchers: Matcher[] = [];
  if (min) disabledMatchers.push({ before: min });
  if (max) disabledMatchers.push({ after: max });

  // Trigger summary: empty → placeholder; start-only → "<from> – …"; complete
  // → "<from> – <to>". Formatted via the user's dateFormat pref. `from`/`to` are
  // NAIVE calendar days, so format the bare `YYYY-MM-DD` wire (never the Date):
  // passing the Date would tz-convert it through prefs.timeZone and land a day
  // off whenever the browser timezone differs from the pref timezone.
  let triggerLabel: string;
  if (from && to) {
    triggerLabel = `${formatDate(dateToWire(from))} – ${formatDate(
      dateToWire(to)
    )}`;
  } else if (from) {
    triggerLabel = `${formatDate(dateToWire(from))} – …`;
  } else {
    triggerLabel = placeholder;
  }

  // Stable id linking the trigger to its error message via aria-describedby.
  const errorId = startName ? `${startName}-error` : undefined;

  return (
    <div className={tw("w-full", className)}>
      {/* Hidden fields carry the date-only wires so the picker works inside a
          plain <Form> without any server change. Rendered per-name so a caller
          can supply just one end if needed. */}
      {startName ? (
        <input
          type="hidden"
          name={startName}
          value={dateToWire(from)}
          disabled={disabled}
        />
      ) : null}
      {endName ? (
        <input
          type="hidden"
          name={endName}
          value={dateToWire(to)}
          disabled={disabled}
        />
      ) : null}

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-describedby={error ? errorId : undefined}
            className={tw(
              "flex w-full items-center gap-2 rounded-[4px] border px-3.5 py-2 text-left shadow transition-colors",
              "focus:outline-none focus-visible:border-primary-300",
              error
                ? "border-error-300"
                : "border-gray-300 hover:border-gray-400",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-gray-500" />
            <span
              className={tw(
                "min-w-0 flex-1 truncate",
                from ? "text-gray-900" : "text-gray-500"
              )}
            >
              {triggerLabel}
            </span>
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className={tw(
              // z-[999999]: the repo's "above everything" layer — this picker is
              // used inside dialogs (z-[100]); a lower value renders the calendar
              // BEHIND the dialog. Matches DateTimePicker.
              // !mt-0: override global.css's `mt-2` on popper content so the
              // calendar sits tight under the trigger (just sideOffset={4}).
              "z-[999999] !mt-0 rounded-lg border border-gray-200 bg-white p-2 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
            sideOffset={4}
            align="start"
          >
            {/* react-doctor-safe static <style>: neutral shadcn-like day styling
                (filled dark "selected" pill, subtle "today"). See RDP_STYLE. */}
            <style>{RDP_STYLE}</style>
            <DayPicker
              mode="range"
              numberOfMonths={2}
              captionLayout="dropdown"
              {...calendarBounds()}
              selected={selected}
              onSelect={handleSelect}
              showOutsideDays
              weekStartsOn={prefs.weekStartsOn}
              disabled={
                disabledMatchers.length > 0 ? disabledMatchers : undefined
              }
              classNames={RDP_CLASS_NAMES}
              components={{ Chevron: CalendarChevron }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {error ? (
        <div id={errorId} className="mt-1 text-sm text-error-500">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default DateRangePicker;
