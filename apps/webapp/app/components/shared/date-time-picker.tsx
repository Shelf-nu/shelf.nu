/**
 * DateTimePicker — shared, prefs-aware date & datetime input
 *
 * A shadcn-style picker that replaces the native `<input type="date">` /
 * `type="datetime-local"` fields across the app. The DATE part is a **typeable**
 * text input (parsed in the user's `dateFormat`) paired with a calendar-icon
 * button that opens a Radix Popover holding a react-day-picker calendar. In
 * `mode="datetime"` a **separate native `<input type="time">`** sits beside the
 * date field (matching shadcn's split date/time layout) — there is no nested
 * time dropdown inside the popover.
 *
 * It renders and reads dates in the user's `dateFormat` / `weekStart` /
 * `timeFormat` (via `useDateFormatter`) but **emits the exact wire strings the
 * existing servers already parse** — `YYYY-MM-DD` (date) or `YYYY-MM-DDTHH:mm`
 * (datetime, = DATE_TIME_FORMAT) — through a hidden `<input name>`, so it drops
 * into both zorm forms (`zo.fields.x()`) and plain `<Form>`s without any
 * server-side change.
 *
 * The picker operates on a NAIVE wall-clock Date: the typed text and the emitted
 * wire are the wall-clock value (no timezone conversion). Each call site's server
 * keeps its own timezone handling (booking `coerceLocalDate`, audit
 * `DateTime.fromFormat`, filters `adjustDateToUTC`, reminder/update naive parse).
 *
 * @see {@link file://../reports/timeframe-picker.tsx} composition reference
 * @see {@link file://../../hooks/use-date-formatter.ts} prefs source
 */

import { useEffect, useState } from "react";
import type { DateFormatPreference } from "@prisma/client";
import * as Popover from "@radix-ui/react-popover";
import { format, isValid, parse } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Matcher } from "react-day-picker";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { InnerLabel } from "~/components/forms/inner-label";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import { tw } from "~/utils/tw";

/**
 * Neutral, shadcn-style day-button appearance for react-day-picker v9. v9's
 * default "selected" is an accent-colored ring; we override it to a filled dark
 * pill with white text and give "today" a subtle gray fill — the clean default
 * shadcn look. Structural layout (nav, caption, weekday header, sizing) is set
 * via RDP_CLASS_NAMES; only the day pill lives in this static <style>.
 */
const RDP_STYLE = `
  .rdp-day_button {
    width: 34px;
    height: 34px;
    margin: 0 auto;
    border: none;
    border-radius: 9999px;
    box-shadow: none;
    outline: none;
    font-size: 13px;
    font-weight: 400;
    color: #101828;
    transition: background-color 0.15s ease;
  }
  .rdp-day_button:hover:not([disabled]) { background-color: #F2F4F7; }
  .rdp-day_button:focus-visible {
    background-color: #F2F4F7;
  }
  .rdp-today:not(.rdp-selected) .rdp-day_button {
    background-color: #F2F4F7;
    font-weight: 500;
  }
  /* Filled dark pill IS the selected indicator — strip v9's default accent
     (blue) border/outline/shadow so there's no ring around it. */
  .rdp-selected .rdp-day_button {
    background-color: #101828 !important;
    color: #ffffff !important;
    font-weight: 500 !important;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
  }
  .rdp-outside .rdp-day_button { color: #98A2B3; }
  .rdp-disabled .rdp-day_button { color: #D0D5DD; opacity: 0.5; }
`;

/**
 * shadcn-style structural classes for react-day-picker v9 parts: centered month
 * caption with the nav arrows pinned left/right, muted weekday header, compact
 * 36px grid.
 */
const RDP_CLASS_NAMES = {
  months: "relative",
  month: "flex flex-col gap-3",
  month_caption: "flex h-8 items-center justify-center",
  caption_label: "text-sm font-semibold text-gray-900",
  nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
  button_previous:
    "inline-flex size-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40",
  button_next:
    "inline-flex size-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40",
  weekdays: "flex",
  weekday: "w-9 pb-1 text-[0.8rem] font-normal text-gray-500",
  week: "flex w-full",
  day: "size-9 p-0 text-center",
  hidden: "invisible",
};

/**
 * Neutral nav chevrons for react-day-picker v9's `Chevron` slot — replaces the
 * default themed (blue) chevron with plain lucide icons.
 *
 * @param props.orientation - which arrow to render
 */
function CalendarChevron({
  orientation,
}: {
  orientation?: "up" | "down" | "left" | "right";
}) {
  return orientation === "left" ? (
    <ChevronLeft className="size-4" />
  ) : (
    <ChevronRight className="size-4" />
  );
}

/**
 * Map a workspace `dateFormat` preference to the date-fns token string used both
 * to RENDER the selected date in the typeable text input and to PARSE the user's
 * typed value back into a Date. Also drives the field placeholder (lowercased).
 *
 * @param dateFormat - the workspace date-format preference
 * @returns a date-fns format token string, e.g. `"dd/MM/yyyy"`
 */
function dateFormatTokens(dateFormat: DateFormatPreference): string {
  switch (dateFormat) {
    case "DD_MM_YYYY":
      return "dd/MM/yyyy";
    case "YYYY_MM_DD":
      return "yyyy-MM-dd";
    case "MM_DD_YYYY":
    default:
      return "MM/dd/yyyy";
  }
}

/**
 * Compare two dates at DAY granularity (ignoring time-of-day) so min/max bounds
 * apply to the calendar day, not the wall-clock instant.
 *
 * @param a - first date
 * @param b - second date
 * @returns `-1` when `a`'s day is before `b`'s, `1` when after, `0` when equal
 */
function compareDay(a: Date, b: Date): number {
  if (a.getFullYear() !== b.getFullYear()) {
    return a.getFullYear() < b.getFullYear() ? -1 : 1;
  }
  if (a.getMonth() !== b.getMonth()) {
    return a.getMonth() < b.getMonth() ? -1 : 1;
  }
  if (a.getDate() !== b.getDate()) {
    return a.getDate() < b.getDate() ? -1 : 1;
  }
  return 0;
}

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
  /**
   * Placeholder for the date text input. When left at the default, the
   * lowercased format tokens are used (e.g. "dd/mm/yyyy").
   */
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
  // Strictly reject anything that isn't exactly YYYY-MM-DD so suffix garbage
  // (e.g. "2026-06-22junk") or "2026-6-2" shorthand can't slip through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return { date: undefined, time: "" };
  }
  const [y, m, d] = datePart.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return { date: undefined, time: "" };
  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return { date: undefined, time: "" };
  // Guard against JS Date rollover: "2026-02-31" would construct March 3 and
  // "2026-13-01" would roll into the next year. Reject if the constructed
  // calendar date no longer matches the parsed components.
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return { date: undefined, time: "" };
  }
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
  const { prefs } = useDateFormatter();
  const isControlled = value !== undefined;

  // date-fns tokens for the workspace format — drives both rendering the typed
  // text and parsing it back. A value-stable string (safe in effect deps).
  const tokens = dateFormatTokens(prefs.dateFormat);

  /** Render a Date as canonical text in the workspace format ("" for none). */
  const dateToText = (day: Date | undefined): string =>
    day ? format(day, tokens) : "";

  const [open, setOpen] = useState(false);
  const [internalWire, setInternalWire] = useState<string>(
    () => value ?? defaultValue ?? ""
  );
  // The RAW text in the date input. It is the user's source-of-truth WHILE
  // typing; every other source updates it explicitly (never a blanket
  // wire→text effect, which would clobber mid-typing input).
  const [typedText, setTypedText] = useState<string>(() => {
    const { date } = parseWireToParts(value ?? defaultValue ?? "");
    return date ? format(date, tokens) : "";
  });

  // In controlled mode, reflect the external value into internal state AND
  // re-normalize the text to canonical format. This only fires on external
  // `value` changes (uncontrolled typing never reaches here), so it can't
  // overwrite a half-typed value.
  useEffect(() => {
    if (isControlled) {
      const nextWire = value ?? "";
      setInternalWire(nextWire);
      const { date } = parseWireToParts(nextWire);
      setTypedText(date ? format(date, tokens) : "");
    }
  }, [isControlled, value, tokens]);

  const wire = internalWire;
  const { date: selectedDate, time } = parseWireToParts(wire);

  // The wire SUBMITTED to the server is always re-derived from the parsed parts,
  // never `internalWire` verbatim. A seeded/controlled value may carry seconds
  // (e.g. `dateForDateTimeInputValue` → "YYYY-MM-DDTHH:mm:ss") or an offset; the
  // servers parse with DATE_TIME_FORMAT ("yyyy-MM-dd'T'HH:mm") / "YYYY-MM-DD" and
  // reject anything else. Normalizing here guarantees a canonical wire regardless
  // of the incoming format. Empty/invalid selection → "" (caught by validation).
  const submittedWire = partsToWire(
    selectedDate,
    mode === "datetime" ? time : "",
    mode
  );

  /** Commit a new wire string: update internal state + notify parent. */
  const commit = (nextWire: string) => {
    setInternalWire(nextWire);
    onChange?.(nextWire);
  };

  /**
   * Handle typing in the date text input. Always mirrors the raw text; commits
   * the wire only when the text parses to a valid date within min/max (day
   * granularity). Empty text commits "". Invalid/partial text leaves the wire
   * unchanged (mid-typing) — reverted to canonical on blur.
   */
  const handleTypedChange = (text: string) => {
    setTypedText(text);

    if (text.trim() === "") {
      commit("");
      return;
    }

    const parsed = parse(text, tokens, new Date());
    if (!isValid(parsed)) return;
    if (min && compareDay(parsed, min) < 0) return;
    if (max && compareDay(parsed, max) > 0) return;

    // Preserve the current time in datetime mode; a fresh pick falls back to the
    // partsToWire default ("00:00") for consistency across the picker.
    const nextTime = mode === "datetime" ? time : "";
    commit(partsToWire(parsed, nextTime, mode));
  };

  /** Normalize the text back to the committed date's canonical format on blur. */
  const handleTypedBlur = () => {
    setTypedText(dateToText(selectedDate));
  };

  const handleDaySelect = (day: Date | undefined) => {
    // Datetime keeps the current time; a fresh pick falls back to the
    // partsToWire default ("00:00") for consistency across the picker.
    const nextTime = mode === "datetime" ? time : "";
    setTypedText(dateToText(day));
    commit(partsToWire(day, nextTime, mode));
    setOpen(false);
  };

  const handleNativeTimeChange = (nextTime: string) => {
    // No date selected yet → ignore the time change rather than silently
    // committing today as the base date (which would set the field to today).
    if (!selectedDate) return;
    setTypedText(dateToText(selectedDate));
    commit(partsToWire(selectedDate, nextTime, "datetime"));
  };

  const handleClear = () => {
    setTypedText("");
    commit("");
    setOpen(false);
  };

  // Stable id linking the field to its error message via aria-describedby.
  const errorId = `${name}-error`;

  // Placeholder: caller-supplied wins; otherwise the lowercased format tokens.
  const placeholderText =
    placeholder && placeholder !== "Select date"
      ? placeholder
      : tokens.toLowerCase();

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
      <input
        type="hidden"
        name={name}
        value={submittedWire}
        disabled={disabled}
      />

      <Popover.Root open={open} onOpenChange={setOpen}>
        <div className="flex items-stretch gap-2">
          {/* Anchor the calendar to the whole date field (not just the icon
              button) so it aligns with the field's left edge. */}
          <Popover.Anchor asChild>
            <div
              className={tw(
                "flex min-w-0 flex-1 items-center rounded-[4px] border shadow transition-colors",
                "focus-within:border-primary-300",
                error
                  ? "border-error-300"
                  : "border-gray-300 hover:border-gray-400",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <input
                type="text"
                value={typedText}
                onChange={(e) => handleTypedChange(e.target.value)}
                onBlur={handleTypedBlur}
                placeholder={placeholderText}
                disabled={disabled}
                required={required}
                aria-label={label ?? "Date"}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={tw(
                  // border-0: kill the browser's default input border (dark inner
                  // box). outline-none + focus:ring-[0]: the app sets a global
                  // --tw-ring-color (light blue); without this the input shows a
                  // blue focus ring (the container's orange focus-within border is
                  // the intended focus indicator). Mirrors the standard Input.
                  "min-w-0 flex-1 border-0 bg-transparent px-3.5 py-2 text-[16px] text-gray-900 outline-none focus:outline-none focus:ring-[0]",
                  "placeholder:text-gray-500 disabled:cursor-not-allowed"
                )}
              />
              <Popover.Trigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label="Open calendar"
                  className={tw(
                    "flex shrink-0 items-center px-3 text-gray-500 transition-colors",
                    "hover:text-gray-700 focus:outline-none focus-visible:text-primary-500",
                    "disabled:cursor-not-allowed"
                  )}
                >
                  <CalendarIcon className="size-4" />
                </button>
              </Popover.Trigger>
            </div>
          </Popover.Anchor>

          {mode === "datetime" ? (
            <input
              type="time"
              value={time}
              onChange={(e) => handleNativeTimeChange(e.target.value)}
              disabled={disabled}
              aria-label="Select time"
              aria-invalid={error ? true : undefined}
              className={tw(
                "shrink-0 rounded-[4px] border px-3 py-2 text-[16px] text-gray-900 shadow transition-colors",
                "outline-none focus:border-primary-300 focus:ring-[0]",
                error
                  ? "border-error-300"
                  : "border-gray-300 hover:border-gray-400",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            />
          ) : null}
        </div>

        <Popover.Portal>
          <Popover.Content
            className={tw(
              // z-[999999]: the repo's "above everything" layer — the picker is
              // used inside dialogs (z-[100]); a lower value renders the calendar
              // BEHIND the dialog. This is the shared picker, so it fixes every
              // date field at once.
              "z-[999999] rounded-lg border border-gray-200 bg-white p-3 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
            sideOffset={4}
            align="start"
          >
            {/* react-doctor-safe static <style>: neutral shadcn-like day styling
                (filled dark "selected" pill, subtle "today"). See RDP_STYLE. */}
            <style>{RDP_STYLE}</style>
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDaySelect}
              showOutsideDays
              weekStartsOn={prefs.weekStartsOn}
              disabled={
                disabledMatchers.length > 0 ? disabledMatchers : undefined
              }
              classNames={RDP_CLASS_NAMES}
              components={{ Chevron: CalendarChevron }}
            />

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
        <div id={errorId} className="mt-1 text-sm text-error-500">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export default DateTimePicker;
