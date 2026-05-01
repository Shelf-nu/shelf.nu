/**
 * @file Timeframe range indicator.
 *
 * Small inline helper that displays the actual start/end dates of the
 * currently selected timeframe along with the inclusive day count. This
 * gives users context for why two seemingly similar presets (e.g.
 * "This quarter" vs "Last 90 days") can return different volumes of
 * data.
 *
 * Extracted from the monolithic reports route during the
 * `reports.$reportId.tsx` decomposition. Pure presentational helper —
 * no data fetching, no state.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://./timeframe-picker.tsx}
 */

import type { ResolvedTimeframe } from "~/modules/reports/types";

/** Props for {@link TimeframeRangeIndicator}. */
type Props = {
  /** Resolved timeframe with concrete `from`/`to` Date objects. */
  timeframe: ResolvedTimeframe;
};

/**
 * Shows the actual date range and day count for the selected timeframe.
 * Helps users understand why "This quarter" might show fewer bookings than "Last 90 days"
 * (e.g., Q2 starting Apr 1 is only 24 days so far vs a full 90 days).
 */
export function TimeframeRangeIndicator({ timeframe }: Props) {
  const { from, to } = timeframe;

  // Calculate day count (inclusive of both start and end dates)
  // Normalize both dates to midnight to avoid time-of-day issues
  const fromMidnight = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate()
  );
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const dayCount =
    Math.round(
      (toMidnight.getTime() - fromMidnight.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  // Format dates compactly
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  // Check if dates span different years
  const fromYear = from.getFullYear();
  const toYear = to.getFullYear();
  const showYear = fromYear !== toYear || toYear !== new Date().getFullYear();

  const fromStr =
    formatDate(from) + (showYear && fromYear !== toYear ? `, ${fromYear}` : "");
  const toStr = formatDate(to) + (showYear ? `, ${toYear}` : "");

  return (
    <span className="hidden text-xs text-gray-500 sm:inline-flex sm:items-center sm:gap-1.5">
      <span>
        {fromStr} – {toStr}
      </span>
      <span className="text-gray-300">·</span>
      <span className="font-medium text-gray-600">
        {dayCount} day{dayCount !== 1 ? "s" : ""}
      </span>
    </span>
  );
}
