/**
 * Compliance Donut Chart
 *
 * Visual representation of on-time vs late booking returns.
 * Uses Tremor's DonutChart with Shelf's primary colors.
 *
 * @see {@link file://../../components/dashboard/assets-by-status-chart.tsx}
 */

import { DonutChart } from "@tremor/react";
import { ClientOnly } from "remix-utils/client-only";

import { tw } from "~/utils/tw";

export interface ComplianceDonutProps {
  /** Number of bookings completed on time */
  onTime: number;
  /** Number of bookings completed late */
  late: number;
  /** Label for the selected timeframe (e.g., "Last 30 days") */
  timeframeLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Donut chart showing compliance rate (on-time vs late returns).
 *
 * The hero visualization for the Booking Compliance report.
 * Green = on-time, Orange = late.
 */
export function ComplianceDonut({
  onTime,
  late,
  timeframeLabel,
  className,
}: ComplianceDonutProps) {
  const total = onTime + late;
  const complianceRate = total > 0 ? Math.round((onTime / total) * 100) : 0;

  const chartData = [
    { status: "On-time", count: onTime, color: "#22c55e" }, // green-500
    { status: "Late", count: late, color: "#f97316" }, // orange-500
  ];

  // Filter out zero values to avoid empty segments
  const filteredData = chartData.filter((d) => d.count > 0);

  if (total === 0) {
    return (
      <div
        className={tw(
          "flex flex-col items-center justify-center rounded border border-gray-200 bg-white p-6",
          className
        )}
      >
        <p className="text-sm text-gray-500">No completed bookings yet</p>
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
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-gray-900">
            Return Breakdown
          </h3>
          {timeframeLabel && (
            <span className="text-xs text-gray-400">{timeframeLabel}</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center gap-8 p-6">
        {/* Donut with center label */}
        <div className="relative">
          <ClientOnly
            fallback={
              <div className="size-[140px] animate-pulse rounded-full bg-gray-100" />
            }
          >
            {() => (
              <DonutChart
                className="size-[140px]"
                data={filteredData}
                category="count"
                index="status"
                colors={["green", "orange"]}
                showAnimation={true}
                animationDuration={400}
                showTooltip={true}
                showLabel={false}
              />
            )}
          </ClientOnly>

          {/* Center percentage */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-gray-900">
              {complianceRate}%
            </span>
            <span className="text-xs text-gray-500">on-time</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">
              <strong className="text-gray-900">{onTime}</strong> on-time
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-orange-500" />
            <span className="text-sm text-gray-600">
              <strong className="text-gray-900">{late}</strong> late
            </span>
          </div>
          <div className="mt-1 border-t border-gray-100 pt-2">
            <span className="text-xs text-gray-500">
              {total} total completions
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ComplianceDonut;
