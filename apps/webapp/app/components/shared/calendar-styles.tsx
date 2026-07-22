/**
 * Shared react-day-picker (v9) styling primitives — 1:1 with the default shadcn
 * calendar.
 *
 * Used by every calendar in the app ({@link DateTimePicker} single-date and the
 * reusable `DateRangePicker`) so they render identically. Keeping the `<style>`
 * block, structural class map, and nav chevron in one module prevents drift.
 *
 * Design (matches shadcn/ui's Calendar):
 * - Compact 32px day cells, `rounded-md` (not full circles).
 * - Selected day / range endpoints = a dark rounded square (gray-900/white).
 * - Range middle = a light-gray connecting background (NOT dark), square, so the
 *   run reads as one continuous band with rounded ends.
 * - Multiple months render side-by-side (`sm:flex-row`), not stacked.
 *
 * Pure presentation — no state, no prefs. Consumers own `mode`, `selected`,
 * `weekStartsOn`, `numberOfMonths`, etc.
 *
 * @see {@link file://./date-time-picker.tsx} single-date consumer
 * @see {@link file://./date-range-picker.tsx} range consumer
 */

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Day-cell appearance for react-day-picker v9, matching the default shadcn
 * calendar. The structural layout (months, nav, weekday header, sizing) lives in
 * {@link RDP_CLASS_NAMES}; the day pills + range band live in this static
 * `<style>` because they hinge on v9's modifier classes (`.rdp-selected`,
 * `.rdp-range_middle`, …) which are simplest to target with plain CSS.
 *
 * Rule ORDER matters: `.rdp-range_middle` overrides come AFTER `.rdp-selected`
 * so a middle day (which v9 also marks selected) renders as the light band, not
 * a dark pill.
 */
export const RDP_STYLE = `
  /* Compact the nav/caption row (v9 defaults it to 2.75rem) and tighten the
     multi-month gap so the calendar reads tight under the input. */
  .rdp-root {
    --rdp-nav-height: 2rem;
    --rdp-months-gap: 1.5rem;
  }
  .rdp-day_button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    margin: 0 auto;
    border: none;
    border-radius: 6px;
    /* Kill v9's default accent ring + the app's global focus ring so the dark
       fill is the ONLY selected indicator (no blue outline). */
    box-shadow: none !important;
    outline: none !important;
    font-size: 14px;
    font-weight: 400;
    color: #101828;
    transition: background-color 0.15s ease;
  }
  .rdp-day_button:hover:not([disabled]) { background-color: #F2F4F7; }
  .rdp-day_button:focus,
  .rdp-day_button:focus-visible {
    background-color: #F2F4F7;
    outline: none !important;
    box-shadow: none !important;
  }
  .rdp-today:not(.rdp-selected) .rdp-day_button {
    background-color: #F2F4F7;
    font-weight: 500;
  }

  /* Selected single day + range endpoints: dark rounded square, no accent ring. */
  .rdp-selected .rdp-day_button {
    background-color: #101828 !important;
    color: #ffffff !important;
    font-weight: 500;
    border-radius: 6px;
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
  }

  /* Range band: a light-gray connecting background on the CELLS. The band is
     rounded at the range ENDS and at each week-row's first/last cell, so a
     multi-week range caps per row (the shadcn look). Endpoints' dark pills sit
     on top. Placed after .rdp-selected so middle days lose the dark pill. */
  .rdp-range_start,
  .rdp-range_middle,
  .rdp-range_end { background-color: #F2F4F7; }
  .rdp-range_start,
  .rdp-range_middle:first-child,
  .rdp-range_end:first-child {
    border-top-left-radius: 6px;
    border-bottom-left-radius: 6px;
  }
  .rdp-range_end,
  .rdp-range_middle:last-child,
  .rdp-range_start:last-child {
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
  }
  .rdp-range_middle .rdp-day_button {
    background-color: transparent !important;
    color: #101828 !important;
    font-weight: 400;
    border-radius: 0;
  }
  .rdp-range_middle .rdp-day_button:hover { background-color: #EAECF0 !important; }

  .rdp-outside .rdp-day_button { color: #98A2B3; }
  .rdp-disabled .rdp-day_button { color: #D0D5DD; opacity: 0.5; }
`;

/**
 * shadcn-style structural classes for react-day-picker v9 parts: months laid out
 * side-by-side on ≥sm, each month's caption centered with the nav arrows pinned
 * to the outer left/right edges, a muted weekday header, and a compact grid.
 */
export const RDP_CLASS_NAMES = {
  months: "relative flex flex-col gap-4 sm:flex-row sm:gap-6",
  month: "flex flex-col gap-3",
  month_caption: "flex h-8 items-center justify-center",
  // Month + year selectors (captionLayout="dropdown"): a native <select>
  // (invisible) overlays a button-like pill showing the value + a down chevron.
  dropdowns: "flex items-center gap-1",
  dropdown_root:
    "relative inline-flex items-center rounded-md px-1.5 py-1 transition-colors hover:bg-gray-100",
  dropdown: "absolute inset-0 cursor-pointer appearance-none opacity-0",
  caption_label: "flex items-center gap-1 text-sm font-medium text-gray-900",
  nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
  button_previous:
    "inline-flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40",
  button_next:
    "inline-flex size-7 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday: "w-8 pb-1 text-[0.8rem] font-normal text-gray-500",
  week: "mt-1 flex w-full",
  day: "size-8 p-0 text-center",
  hidden: "invisible",
};

/**
 * Neutral nav chevrons for react-day-picker v9's `Chevron` slot — replaces the
 * default themed chevron with plain lucide icons.
 *
 * @param props.orientation - which arrow to render
 */
export function CalendarChevron({
  orientation,
}: {
  orientation?: "up" | "down" | "left" | "right";
}) {
  if (orientation === "left") return <ChevronLeft className="size-4" />;
  // "down" is the month/year dropdown affordance — smaller + muted.
  if (orientation === "down")
    return <ChevronDown className="size-3.5 text-gray-500" />;
  return <ChevronRight className="size-4" />;
}

/**
 * Default selectable-month range for the caption month/year dropdowns
 * (`captionLayout="dropdown"`). Wide enough for typical business dates; the
 * prev/next arrows still reach beyond it, and the picker's own `min`/`max`
 * independently disable non-selectable days.
 *
 * @returns `{ startMonth, endMonth }` for react-day-picker
 */
export function calendarBounds(): { startMonth: Date; endMonth: Date } {
  const year = new Date().getFullYear();
  return {
    startMonth: new Date(year - 30, 0, 1),
    endMonth: new Date(year + 10, 11, 1),
  };
}
