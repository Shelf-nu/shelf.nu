/**
 * Compliance Trend Chart
 *
 * Line/area chart showing weekly compliance rate over the selected period.
 * Helps users understand if compliance is improving or declining.
 *
 * Uses Tremor's AreaChart with Shelf's primary colors.
 */

import { AreaChart } from "@tremor/react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";

import type { ComplianceTrendPoint } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

export type { ComplianceTrendPoint };

export interface ComplianceTrendProps {
  /** Weekly compliance data points */
  data: ComplianceTrendPoint[];
  /** Label for the selected timeframe (e.g., "Last 30 days") */
  timeframeLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Area chart showing compliance trend over time.
 *
 * Key insight: Is compliance improving or declining within this period?
 */
export function ComplianceTrend({
  data,
  timeframeLabel,
  className,
}: ComplianceTrendProps) {
  // Filter to only points with actual data for trend calculation
  const pointsWithData = data.filter((d) => d.total > 0);

  // Calculate trend direction (comparing first half to second half of non-empty points)
  const trend = calculateTrend(pointsWithData);

  // Total completions across all periods
  const totalCompletions = data.reduce((sum, d) => sum + d.total, 0);

  // Transform data for Tremor chart - use null for empty periods (creates gaps)
  const chartData = data.map((point) => ({
    period: point.label,
    "Compliance Rate": point.rate, // null values create gaps in chart
    "On-time": point.onTime,
    Late: point.late,
    hasData: point.total > 0,
  }));

  // If no data at all, show empty state
  if (totalCompletions === 0) {
    return (
      <div
        className={tw(
          "flex flex-col items-center justify-center rounded border border-gray-200 bg-white p-6",
          className
        )}
      >
        <p className="text-sm text-gray-500">
          No completed bookings in this period.
        </p>
      </div>
    );
  }

  // If only 1 data point, show simplified view
  if (pointsWithData.length < 2) {
    return (
      <div
        className={tw(
          "flex flex-col items-center justify-center rounded border border-gray-200 bg-white p-6",
          className
        )}
      >
        <p className="text-sm text-gray-500">
          Not enough periods with data to show trend.
        </p>
      </div>
    );
  }

  return (
    <div
      className={tw(
        "flex flex-col rounded border border-gray-200 bg-white",
        className
      )}
    >
      {/* Header with trend indicator */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-gray-900">
            Compliance Trend
          </h3>
          {timeframeLabel && (
            <span className="text-xs text-gray-400">{timeframeLabel}</span>
          )}
        </div>
        {pointsWithData.length >= 2 && <TrendIndicator trend={trend} />}
      </div>

      {/* Chart */}
      <div className="flex-1 p-4 md:p-6">
        <ClientOnly
          fallback={
            <div className="h-[180px] animate-pulse rounded bg-gray-100" />
          }
        >
          {() => (
            <AreaChart
              className="h-[180px]"
              data={chartData}
              index="period"
              categories={["Compliance Rate"]}
              colors={["emerald"]}
              valueFormatter={(value) => (value !== null ? `${value}%` : "—")}
              showLegend={false}
              showGridLines={true}
              showAnimation={true}
              animationDuration={400}
              curveType="monotone"
              yAxisWidth={40}
              minValue={0}
              maxValue={100}
              connectNulls={false}
              customTooltip={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const point = payload[0];
                const periodData = data.find(
                  (d) => d.label === point.payload.period
                );
                if (!periodData) return null;

                // Show different tooltip for empty periods
                if (periodData.total === 0) {
                  return (
                    <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-lg">
                      <p className="text-xs font-medium text-gray-600">
                        {periodData.label}
                      </p>
                      <p className="text-sm text-gray-400">No completions</p>
                    </div>
                  );
                }

                return (
                  <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-lg">
                    <p className="text-xs font-medium text-gray-600">
                      {periodData.label}
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {periodData.rate}%
                    </p>
                    <div className="mt-1 flex gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-green-500" />
                        {periodData.onTime} on-time
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-orange-500" />
                        {periodData.late} late
                      </span>
                    </div>
                  </div>
                );
              }}
            />
          )}
        </ClientOnly>

        {/* Mini legend */}
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-gray-500">
          <span>{totalCompletions} completions</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Calculate trend direction from data points with actual data.
 * Only considers points where rate is not null (has completions).
 */
function calculateTrend(
  pointsWithData: ComplianceTrendPoint[]
): "up" | "down" | "stable" {
  if (pointsWithData.length < 2) return "stable";

  // Compare average of first half vs second half
  const midpoint = Math.floor(pointsWithData.length / 2);
  const firstHalf = pointsWithData.slice(0, midpoint);
  const secondHalf = pointsWithData.slice(midpoint);

  // Calculate averages, filtering out any null rates (shouldn't happen since we pre-filter)
  const firstRates = firstHalf
    .filter((d) => d.rate !== null)
    .map((d) => d.rate as number);
  const secondRates = secondHalf
    .filter((d) => d.rate !== null)
    .map((d) => d.rate as number);

  if (firstRates.length === 0 || secondRates.length === 0) return "stable";

  const firstAvg =
    firstRates.reduce((sum, r) => sum + r, 0) / firstRates.length;
  const secondAvg =
    secondRates.reduce((sum, r) => sum + r, 0) / secondRates.length;

  const diff = secondAvg - firstAvg;

  // Use 5% threshold for significance (more conservative)
  if (diff > 5) return "up";
  if (diff < -5) return "down";
  return "stable";
}

/**
 * Trend indicator badge.
 */
function TrendIndicator({ trend }: { trend: "up" | "down" | "stable" }) {
  const config = {
    up: {
      icon: TrendingUp,
      label: "Improving",
      className: "bg-green-50 text-green-700",
    },
    down: {
      icon: TrendingDown,
      label: "Declining",
      className: "bg-red-50 text-red-700",
    },
    stable: {
      icon: Minus,
      label: "Stable",
      className: "bg-gray-50 text-gray-600",
    },
  };

  const { icon: Icon, label, className } = config[trend];

  return (
    <span
      className={tw(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      <Icon className="size-3" />
      {label}
    </span>
  );
}

export default ComplianceTrend;
