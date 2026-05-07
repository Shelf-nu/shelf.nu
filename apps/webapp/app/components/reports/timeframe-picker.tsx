/**
 * Timeframe Picker Component
 *
 * Allows users to select a report timeframe using preset buttons or a custom
 * date range picker. Syncs selection to URL search params for bookmarkable
 * report states.
 *
 * Features:
 * - Preset buttons (Today, Last 7d, Last 30d, etc.)
 * - Custom range picker with calendar
 * - URL state synchronization
 * - Keyboard accessible
 *
 * @see {@link file://../../modules/reports/types.ts}
 */

import type React from "react";
import { useCallback, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { useSearchParams } from "~/hooks/search-params";
import { resolveTimeframe } from "~/modules/reports/timeframe";
import type {
  TimeframePreset,
  ResolvedTimeframe,
} from "~/modules/reports/types";
import { tw } from "~/utils/tw";

/** CSS custom properties to theme react-day-picker with Shelf's primary color and compact sizing */
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

/**
 * Timeframe picker with preset buttons and custom date range.
 *
 * Compact design: preset pills on left, custom range button on right.
 * Selected preset is highlighted. Custom range opens a calendar popover.
 */
export function TimeframePicker({
  value,
  onChange,
  syncToUrl = true,
  excludePresets = [],
  disabled = false,
  className,
}: TimeframePickerProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter out excluded presets
  const visiblePresets = PRESETS.filter((p) => !excludePresets.includes(p.id));
  const [customOpen, setCustomOpen] = useState(false);
  const [customRange, setCustomRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: value.preset === "custom" ? value.from : undefined,
    to: value.preset === "custom" ? value.to : undefined,
  });

  const handlePresetClick = useCallback(
    (preset: TimeframePreset) => {
      const resolved = resolveTimeframe(preset);

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
    [searchParams, setSearchParams, syncToUrl, onChange]
  );

  const handleCustomApply = useCallback(() => {
    if (!customRange.from || !customRange.to) return;

    const resolved = resolveTimeframe(
      "custom",
      customRange.from,
      customRange.to
    );

    if (syncToUrl) {
      const params = new URLSearchParams(searchParams);
      params.set("timeframe", "custom");
      params.set("from", customRange.from.toISOString());
      params.set("to", customRange.to.toISOString());
      params.delete("page"); // Reset to page 1 when filter changes
      setSearchParams(params, { replace: true });
    }

    onChange?.(resolved);
    setCustomOpen(false);
  }, [customRange, searchParams, setSearchParams, syncToUrl, onChange]);

  /** Clears custom selection and reverts to default preset (Last 30 days) */
  const handleClear = useCallback(() => {
    setCustomRange({ from: undefined, to: undefined });
    handlePresetClick("last_30d");
    setCustomOpen(false);
  }, [handlePresetClick]);

  const isCustomActive = value.preset === "custom";

  return (
    <div className={tw("flex items-center gap-3", className)}>
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

      {/* Custom range picker */}
      <Popover.Root open={customOpen} onOpenChange={setCustomOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={tw(
              "flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
              isCustomActive
                ? "border-primary-600 bg-primary-600 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:hover:border-gray-200 disabled:hover:bg-white"
            )}
            aria-expanded={customOpen}
          >
            <CalendarIcon className="size-3.5" />
            <span>{isCustomActive ? value.label : "Custom"}</span>
            <ChevronDown
              className={tw(
                "size-3 transition-transform",
                customOpen && "rotate-180"
              )}
            />
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className={tw(
              "z-50 rounded border border-gray-200 bg-white p-4 shadow-lg",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
            )}
            sideOffset={8}
            align="end"
          >
            <div className="space-y-4">
              <div className="text-sm font-medium text-gray-900">
                Select date range
              </div>

              <div>
                <style>{`
                  .rdp-day button,
                  .rdp-day_button,
                  .rdp-selected .rdp-day_button,
                  .rdp-range_middle .rdp-day_button,
                  .rdp-range_start .rdp-day_button,
                  .rdp-range_end .rdp-day_button {
                    font-weight: 400 !important;
                  }
                `}</style>
                <DayPicker
                  mode="range"
                  selected={{
                    from: customRange.from,
                    to: customRange.to,
                  }}
                  onSelect={(range) => {
                    setCustomRange({
                      from: range?.from,
                      to: range?.to,
                    });
                  }}
                  numberOfMonths={2}
                  showOutsideDays
                  weekStartsOn={0}
                  style={dayPickerStyles}
                />
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="flex items-center gap-3">
                  {/* Clear button - only show when there's a selection or custom is active */}
                  {(customRange.from || isCustomActive) && (
                    <button
                      type="button"
                      onClick={handleClear}
                      className={tw(
                        "text-xs font-medium text-gray-500",
                        "hover:text-gray-700 focus:outline-none focus-visible:text-gray-700"
                      )}
                    >
                      Clear
                    </button>
                  )}
                  <div className="text-xs text-gray-500">
                    {customRange.from && customRange.to && (
                      <>
                        {formatDate(customRange.from)} –{" "}
                        {formatDate(customRange.to)}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomOpen(false)}
                    className={tw(
                      "rounded-md px-3 py-1.5 text-xs font-medium text-gray-600",
                      "hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    )}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCustomApply}
                    disabled={!customRange.from || !customRange.to}
                    className={tw(
                      "rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white",
                      "hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>

            <Popover.Arrow className="fill-white" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default TimeframePicker;
