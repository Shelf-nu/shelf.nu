/**
 * @file Report filter bar.
 *
 * Renders whichever filter controls apply to the current report:
 *   - The shared `TimeframePicker` + `TimeframeRangeIndicator`
 *     (applicable to most analytics reports).
 *   - The `IdleThresholdSelector` (idle-assets only — that report uses
 *     a "days since last use" threshold instead of a date range).
 *
 * Owns its own URL state via `useSearchParams` so the consuming route
 * doesn't have to thread `searchParams` and `setSearchParams` down. A
 * loading spinner is shown next to the active control while a
 * navigation is in flight.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://./timeframe-picker.tsx}
 * @see {@link file://./idle-threshold-selector.tsx}
 */

import { useCallback } from "react";

import { useSearchParams } from "~/hooks/search-params";
import type {
  ResolvedTimeframe,
  TimeframePreset,
} from "~/modules/reports/types";

import { IdleThresholdSelector } from "./idle-threshold-selector";
import { TimeframePicker } from "./timeframe-picker";
import { TimeframeRangeIndicator } from "./timeframe-range-indicator";

/** Props for {@link ReportFilterBar}. */
type Props = {
  /** Current report id (drives which control is shown). */
  reportId: string;
  /** Resolved timeframe coming from the loader. */
  timeframe: ResolvedTimeframe;
  /** Whether a navigation (filter change, pagination, etc.) is in
   *  flight — used to disable controls and show a spinner. */
  isLoading: boolean;
};

/**
 * Renders the filter row above the report content. Returns `null`
 * when the current report has no applicable filter (e.g. snapshot
 * reports without a timeframe).
 */
export function ReportFilterBar({ reportId, timeframe, isLoading }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  const handleTimeframeChange = useCallback(
    (newTimeframe: ResolvedTimeframe) => {
      const params = new URLSearchParams(searchParams);
      params.set("timeframe", newTimeframe.preset);
      if (newTimeframe.preset === "custom") {
        params.set("from", newTimeframe.from.toISOString());
        params.set("to", newTimeframe.to.toISOString());
      } else {
        params.delete("from");
        params.delete("to");
      }
      params.delete("page"); // Reset to page 1 when filter changes
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleIdleThresholdChange = useCallback(
    (days: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("days", days.toString());
      params.delete("page"); // Reset to page 1 when filter changes
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  if (showTimeframePicker(reportId)) {
    return (
      <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-4">
          <TimeframePicker
            value={timeframe}
            onChange={handleTimeframeChange}
            syncToUrl={false}
            excludePresets={getExcludedPresets(reportId)}
            disabled={isLoading}
          />
          {/* Date range indicator - shows actual dates and day count */}
          <TimeframeRangeIndicator timeframe={timeframe} />
        </div>
        {isLoading ? <FilterLoadingIndicator /> : null}
      </div>
    );
  }

  if (reportId === "idle-assets") {
    return (
      <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-4 py-3">
        <IdleThresholdSelector
          value={parseInt(searchParams.get("days") || "30", 10)}
          onChange={handleIdleThresholdChange}
          disabled={isLoading}
        />
        {isLoading ? <FilterLoadingIndicator /> : null}
      </div>
    );
  }

  return null;
}

/** Spinner + label shown next to the active control while navigating. */
function FilterLoadingIndicator() {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <div className="animate-spin size-3 rounded-full border-2 border-gray-300 border-t-gray-600" />
      <span>Updating...</span>
    </div>
  );
}

/**
 * Determines if a report should show the timeframe picker.
 *
 * Some reports are "live" or "snapshot" views of current state and don't
 * benefit from timeframe filtering:
 * - Overdue Items: Shows currently overdue bookings (live state)
 * - Custody Snapshot: Shows current asset assignments (live state)
 * - Asset Inventory: Shows current inventory count (snapshot)
 * - Asset Distribution: Shows current distribution breakdown (snapshot)
 * - Idle Assets: Uses an idle threshold (days), not a timeframe range
 */
function showTimeframePicker(reportId: string): boolean {
  const liveOrSnapshotReports = [
    "overdue-items",
    "custody-snapshot",
    "asset-inventory",
    "distribution",
    "idle-assets",
  ];
  return !liveOrSnapshotReports.includes(reportId);
}

/**
 * Returns presets to exclude from the timeframe picker for a given report.
 *
 * Some reports don't benefit from very short timeframes (like "Today") because
 * their metrics only make sense over longer periods (e.g., booking duration
 * averages, monthly trends).
 */
function getExcludedPresets(reportId: string): TimeframePreset[] {
  switch (reportId) {
    // Top Booked Assets: Booking duration metrics need longer timeframes
    // "Today" would show incomplete/meaningless duration averages
    case "top-booked-assets":
    // Monthly Booking Trends: By definition needs multi-month data
    // falls through
    case "monthly-booking-trends":
    // Asset Utilization: Utilization rates need sufficient time to be meaningful
    // falls through
    case "asset-utilization":
      return ["today"];
    default:
      return [];
  }
}
