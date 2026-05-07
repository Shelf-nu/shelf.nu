/**
 * Bar Chart Component
 *
 * Categorical bar chart built on Recharts with Shelf's design tokens.
 * Supports both vertical and horizontal orientations.
 *
 * Features:
 * - Responsive container
 * - Custom tooltip
 * - Horizontal/vertical layout
 * - Monochrome styling with hover highlight
 *
 * @see {@link https://recharts.org/en-US/api/BarChart}
 */

import { useMemo } from "react";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import type { ChartSeries } from "~/modules/reports/types";

/** Color palette for multi-series charts */
const SERIES_COLORS = [
  "#EF6820", // primary-500 (Shelf orange)
  "#22c55e", // green-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
  "#f59e0b", // amber-500
];

/** Shelf's color palette for charts */
const CHART_COLORS = {
  grid: "#F2F4F7", // gray-100
  axis: "#667085", // gray-500
};

export interface BarChartProps {
  /** Chart data series */
  series: ChartSeries[];
  /** Chart layout */
  layout?: "vertical" | "horizontal";
  /** Bar corner radius */
  radius?: number;
  /** Whether bars should be stacked */
  stacked?: boolean;
  /** Custom tooltip formatter */
  tooltipFormatter?: (value: number, name: string) => string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Bar chart for categorical data with multi-series support.
 *
 * Features:
 * - Multiple series displayed as grouped bars
 * - Vertical bars (horizontal layout) for time series
 * - Horizontal bars (vertical layout) for categories
 * - Auto-coloring for each series
 */
export function BarChart({
  series,
  layout = "horizontal",
  radius = 4,
  stacked = false,
  tooltipFormatter,
  className,
}: BarChartProps) {
  // Transform series data into Recharts format
  // Each data point has { name, series1Value, series2Value, ... }
  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    // Use first series as the base for category names
    const primarySeries = series[0];
    return primarySeries.data.map((point, index) => {
      const dataPoint: Record<string, string | number> = {
        name: point.label || point.date,
      };

      // Add value from each series
      series.forEach((s) => {
        dataPoint[s.id] = s.data[index]?.value ?? 0;
      });

      return dataPoint;
    });
  }, [series]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        No data available
      </div>
    );
  }

  const isVerticalBars = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <RechartsBarChart
        data={chartData}
        layout={layout}
        margin={
          isVerticalBars
            ? { top: 10, right: 10, left: 0, bottom: 0 }
            : { top: 10, right: 10, left: 80, bottom: 0 }
        }
      >
        {/* Grid */}
        <CartesianGrid
          strokeDasharray="0"
          vertical={!isVerticalBars}
          horizontal={isVerticalBars}
          stroke={CHART_COLORS.grid}
        />

        {/* Axes */}
        {isVerticalBars ? (
          <>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickMargin={8}
            />
            <YAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickMargin={8}
              width={40}
              tickFormatter={(value) => {
                if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                return value.toString();
              }}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickMargin={8}
              tickFormatter={(value) => {
                if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                return value.toString();
              }}
            />
            <YAxis
              type="category"
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
              tickMargin={8}
              width={70}
            />
          </>
        )}

        {/* Tooltip */}
        <Tooltip
          cursor={{ fill: CHART_COLORS.grid }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;

            return (
              <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-lg">
                <p className="text-xs font-medium text-gray-900">
                  {payload[0]?.payload?.name}
                </p>
                <div className="mt-1 space-y-1">
                  {payload.map((entry, idx) => (
                    <p key={idx} className="flex items-center gap-2 text-sm">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="text-gray-600">{entry.name}:</span>
                      <span className="font-medium text-gray-900">
                        {tooltipFormatter
                          ? tooltipFormatter(
                              entry.value as number,
                              entry.name as string
                            )
                          : (entry.value as number).toLocaleString()}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            );
          }}
        />

        {/* Legend for multi-series */}
        {series.length > 1 && (
          <Legend
            verticalAlign="top"
            align="right"
            wrapperStyle={{ paddingBottom: 10 }}
            iconType="circle"
            iconSize={8}
          />
        )}

        {/* Bars - one per series */}
        {series.map((s, index) => (
          <Bar
            key={s.id}
            dataKey={s.id}
            name={s.name}
            fill={s.color || SERIES_COLORS[index % SERIES_COLORS.length]}
            radius={
              isVerticalBars ? [radius, radius, 0, 0] : [0, radius, radius, 0]
            }
            stackId={stacked ? "stack" : undefined}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export default BarChart;
