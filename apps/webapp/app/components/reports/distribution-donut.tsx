/**
 * Distribution Donut Chart
 *
 * Interactive visualization of asset distribution across categories, locations, or statuses.
 * Uses Tremor's DonutChart with a consistent color palette.
 * Legend items are clickable to navigate to filtered asset views.
 *
 * @see {@link file://./compliance-donut.tsx} for similar pattern
 */

import { useState } from "react";
import { DonutChart } from "@tremor/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";

import { tw } from "~/utils/tw";

/** Data item for the distribution chart */
export interface DistributionItem {
  id: string;
  groupName: string;
  assetCount: number;
  percentage: number;
}

export interface DistributionDonutProps {
  /** Chart title */
  title: string;
  /** Distribution data items */
  data: DistributionItem[];
  /** Empty state message */
  emptyMessage?: string;
  /** Maximum items to show in legend (collapsed state) */
  maxLegendItems?: number;
  /** Called when a legend item is clicked */
  onItemClick?: (item: DistributionItem) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Color palette for distribution charts.
 * Uses a harmonious progression from warm to cool colors.
 */
const DISTRIBUTION_COLORS = [
  "orange", // Primary (Shelf brand)
  "blue", // Secondary
  "emerald", // Tertiary
  "violet", // Quaternary
  "amber", // 5th
  "cyan", // 6th
  "rose", // 7th
  "lime", // 8th
  "indigo", // 9th
  "slate", // 10th (fallback neutral)
];

/**
 * Donut chart showing distribution breakdown.
 *
 * Features:
 * - Responsive donut chart with hover tooltips
 * - Legend showing top items with counts and percentages
 * - Graceful empty state handling
 */
export function DistributionDonut({
  title,
  data,
  emptyMessage = "No data available",
  maxLegendItems = 5,
  onItemClick,
  className,
}: DistributionDonutProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const total = data.reduce((sum, item) => sum + item.assetCount, 0);

  // Prepare chart data with proper field names
  const chartData = data.slice(0, 10).map((item) => ({
    name: item.groupName,
    value: item.assetCount,
  }));

  // Calculate "Other" if there are more items than we're showing
  const otherCount = data
    .slice(10)
    .reduce((sum, item) => sum + item.assetCount, 0);
  if (otherCount > 0) {
    chartData.push({ name: "Other", value: otherCount });
  }

  if (data.length === 0 || total === 0) {
    return (
      <div
        className={tw(
          "flex flex-col rounded border border-gray-200 bg-white",
          className
        )}
      >
        <div className="border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="flex h-[200px] items-center justify-center p-4">
          <p className="text-sm text-gray-500">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  // Get legend items - show all if expanded, otherwise top N
  const legendItems = isExpanded ? data : data.slice(0, maxLegendItems);
  const remainingCount = data.length - maxLegendItems;
  const canExpand = remainingCount > 0;
  const isClickable = !!onItemClick;

  return (
    <div
      className={tw(
        "flex flex-col rounded border border-gray-200 bg-white",
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3 md:px-6">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>

      {/* Content */}
      <div className="flex flex-col items-center gap-4 p-4 md:p-6">
        {/* Donut chart */}
        <div className="relative">
          <ClientOnly
            fallback={
              <div className="size-[140px] animate-pulse rounded-full bg-gray-100" />
            }
          >
            {() => (
              <DonutChart
                className="size-[140px]"
                data={chartData}
                category="value"
                index="name"
                colors={DISTRIBUTION_COLORS.slice(0, chartData.length)}
                showAnimation={true}
                animationDuration={400}
                showTooltip={true}
                showLabel={false}
              />
            )}
          </ClientOnly>

          {/* Center total */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-gray-900">{total}</span>
            <span className="text-xs text-gray-500">total</span>
          </div>
        </div>

        {/* Legend */}
        <div className="w-full space-y-1">
          {legendItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onItemClick?.(item)}
              disabled={!isClickable}
              className={tw(
                "-mx-2 flex w-full items-center justify-between rounded-md px-2 py-1.5",
                isClickable &&
                  "cursor-pointer transition-colors hover:bg-gray-50",
                !isClickable && "cursor-default"
              )}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: getColorValue(
                      DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]
                    ),
                  }}
                />
                <span
                  className={tw(
                    "truncate text-sm",
                    isClickable ? "text-gray-900" : "text-gray-700"
                  )}
                  title={item.groupName}
                >
                  {item.groupName}
                </span>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-gray-900">
                  {item.assetCount}
                </span>
                <span className="text-xs text-gray-500">
                  ({item.percentage.toFixed(0)}%)
                </span>
              </div>
            </button>
          ))}

          {/* Expand/collapse toggle */}
          {canExpand && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex w-full items-center gap-1 pt-1 text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="size-3" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="size-3" />+{remainingCount} more
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Get the actual hex color value for a Tremor color name.
 * Used for the legend dots since Tailwind classes may not all be included.
 */
function getColorValue(colorName: string): string {
  const colorMap: Record<string, string> = {
    orange: "#f97316",
    blue: "#3b82f6",
    emerald: "#10b981",
    violet: "#8b5cf6",
    amber: "#f59e0b",
    cyan: "#06b6d4",
    rose: "#f43f5e",
    lime: "#84cc16",
    indigo: "#6366f1",
    slate: "#64748b",
  };
  return colorMap[colorName] || "#6b7280";
}

export default DistributionDonut;
