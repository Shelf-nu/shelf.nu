/**
 * Timeframe Picker Component
 *
 * Allows users to select a report timeframe using preset buttons or a custom
 * date range picker. Syncs selection to URL search params for bookmarkable
 * report states.
 *
 * Features:
 * - Preset buttons (Today, Last 7d, Last 30d, etc.)
 * - Custom range via the shared {@link DateRangePicker}
 * - URL state synchronization
 * - Keyboard accessible
 *
 * The custom range deals in **calendar dates**; before serializing to the URL
 * `from`/`to` params it converts each end to the start-of-day / end-of-day
 * instant in the user's pref timezone (see {@link toZonedBoundaryISO}). This
 * keeps the queried range aligned with how dates are displayed and fixes the
 * prior `.toISOString()` browser-tz off-by-one.
 *
 * @see {@link file://../shared/date-range-picker.tsx} the shared range picker
 * @see {@link file://../../modules/reports/types.ts}
 */

import { useCallback, useState } from "react";
import { DateTime } from "luxon";

import { DateRangePicker } from "~/components/shared/date-range-picker";
import type { DateRangeValue } from "~/components/shared/date-range-picker";
import { useSearchParams } from "~/hooks/search-params";
import { useDateFormatter } from "~/hooks/use-date-formatter";
import {
  resolveTimeframe,
  toZonedBoundaryISO,
} from "~/modules/reports/timeframe";
import type {
  TimeframePreset,
  ResolvedTimeframe,
} from "~/modules/reports/types";
import { tw } from "~/utils/tw";

export interface TimeframePickerProps {
  /** Currently selected timeframe */
  value: ResolvedTimeframe;
  /** Callback when timeframe changes */
  onChange?: (timeframe: ResolvedTimeframe) => void;
  /** Whether to sync to URL search params (default: true) */
  syncToUrl?: boolean;
  /** Preset IDs to exclude from the picker (e.g., ["today"] for reports where daily view isn't meaningful) */
  excludePresets?: TimeframePreset[];
  /** Disable all buttons (e.g., while loading) */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/** Preset button configuration */
const PRESETS: { id: TimeframePreset; label: string; shortLabel: string }[] = [
  { id: "today", label: "Today", shortLabel: "Today" },
  { id: "last_7d", label: "Last 7 days", shortLabel: "7d" },
  { id: "last_30d", label: "Last 30 days", shortLabel: "30d" },
  { id: "last_90d", label: "Last 90 days", shortLabel: "90d" },
  { id: "this_month", label: "This month", shortLabel: "Month" },
  { id: "this_quarter", label: "This quarter", shortLabel: "Qtr" },
  { id: "this_year", label: "This year", shortLabel: "Year" },
  { id: "all_time", label: "All time", shortLabel: "All" },
];

const EMPTY_EXCLUDE_PRESETS: TimeframePreset[] = [];

/**
 * Project a pref-tz boundary INSTANT back to the naive calendar `Date` the
 * {@link DateRangePicker} expects (date-only, wall-clock).
 *
 * The active timeframe carries `from`/`to` as start-of-day / end-of-day instants
 * in the user's pref timezone (see {@link resolveTimeframe}'s custom case). The
 * picker deals in naive calendar days, so when seeding it from an existing custom
 * range we read the Y/M/D off the instant IN the pref timezone and rebuild a
 * browser-local `Date` for that day. Without this the highlighted day would be
 * off-by-one whenever the browser timezone differs from the pref timezone.
 *
 * @param instant - a pref-tz boundary instant from the active timeframe
 * @param timeZone - the user's pref IANA timezone (e.g. "Asia/Tokyo")
 * @returns a naive calendar `Date` for the same day the user picked
 */
function toNaiveCalendarDate(instant: Date, timeZone: string): Date {
  const zoned = DateTime.fromJSDate(instant).setZone(timeZone);
  return new Date(zoned.year, zoned.month - 1, zoned.day);
}

/**
 * Timeframe picker with preset buttons and custom date range.
 *
 * Compact design: preset pills on left, custom range picker on right.
 * Selected preset is highlighted. The custom range uses the shared
 * {@link DateRangePicker}, committing to the URL (and `onChange`) once both ends
 * of the range are selected.
 */
export function TimeframePicker({
  value,
  onChange,
  syncToUrl = true,
  excludePresets = EMPTY_EXCLUDE_PRESETS,
  disabled = false,
  className,
}: TimeframePickerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { prefs } = useDateFormatter();

  // Filter out excluded presets
  const visiblePresets = PRESETS.filter((p) => !excludePresets.includes(p.id));

  // Controlled custom-range selection. Seeded from the active timeframe when it
  // is already a custom range so re-opening the picker shows the current dates.
  // The active timeframe's from/to are pref-tz boundary INSTANTS; convert each
  // back to the picker's naive calendar day so the correct day is highlighted
  // even when the browser timezone differs from the pref timezone.
  const [customRange, setCustomRange] = useState<DateRangeValue>(() => ({
    from:
      value.preset === "custom"
        ? toNaiveCalendarDate(value.from, prefs.timeZone)
        : undefined,
    to:
      value.preset === "custom"
        ? toNaiveCalendarDate(value.to, prefs.timeZone)
        : undefined,
  }));

  const handlePresetClick = useCallback(
    (preset: TimeframePreset) => {
      const resolved = resolveTimeframe(preset, undefined, undefined, prefs);

      if (syncToUrl) {
        const params = new URLSearchParams(searchParams);
        params.set("timeframe", preset);
        params.delete("from");
        params.delete("to");
        params.delete("page"); // Reset to page 1 when filter changes
        setSearchParams(params, { replace: true });
      }

      onChange?.(resolved);
    },
    [searchParams, setSearchParams, syncToUrl, onChange, prefs]
  );

  /**
   * Handle a calendar-range change from the shared picker. Tracks partial
   * selections locally, and once BOTH ends are set resolves the timeframe and
   * syncs it to the URL — converting each end to a start-of-day / end-of-day
   * instant in the user's pref timezone before serializing.
   */
  const handleCustomChange = useCallback(
    (range: DateRangeValue) => {
      setCustomRange({ from: range.from, to: range.to });

      // Only commit a complete range; wait for the user to pick both ends.
      if (!range.from || !range.to) return;

      const resolved = resolveTimeframe("custom", range.from, range.to, prefs);

      if (syncToUrl) {
        const params = new URLSearchParams(searchParams);
        params.set("timeframe", "custom");
        // Anchor boundaries in the user's pref timezone (not the browser's).
        params.set(
          "from",
          toZonedBoundaryISO(range.from, prefs.timeZone, "start")
        );
        params.set("to", toZonedBoundaryISO(range.to, prefs.timeZone, "end"));
        params.delete("page"); // Reset to page 1 when filter changes
        setSearchParams(params, { replace: true });
      }

      onChange?.(resolved);
    },
    [searchParams, setSearchParams, syncToUrl, onChange, prefs]
  );

  return (
    <div className={tw("flex flex-wrap items-center gap-3", className)}>
      {/* Preset buttons */}
      <div className="flex items-center gap-1 rounded border border-gray-200 bg-white p-1">
        {visiblePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={disabled}
            onClick={() => handlePresetClick(preset.id)}
            className={tw(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
              value.preset === preset.id
                ? "bg-primary-600 text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:hover:bg-transparent"
            )}
            aria-pressed={value.preset === preset.id}
          >
            <span className="hidden sm:inline">{preset.label}</span>
            <span className="sm:hidden">{preset.shortLabel}</span>
          </button>
        ))}
      </div>

      {/* Custom range picker — shared DateRangePicker; commits once both ends
          are selected (see handleCustomChange). */}
      <DateRangePicker
        value={customRange}
        onChange={handleCustomChange}
        disabled={disabled}
        placeholder="Custom range"
        className="w-full min-w-0 text-sm sm:w-[260px]"
      />
    </div>
  );
}

export default TimeframePicker;
