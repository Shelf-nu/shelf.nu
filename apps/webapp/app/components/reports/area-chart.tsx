/**
 * Area Chart Component
 *
 * Time-series area chart built on Recharts with Shelf's design tokens.
 * Optimized for reports: clean axes, minimal gridlines, monochrome palette.
 *
 * Features:
 * - Responsive container
 * - Custom tooltip
 * - Period-over-period comparison (optional)
 * - Gradient fill
 *
 * @see {@link https://recharts.org/en-US/api/AreaChart}
 */

import { useMemo } from "react";
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

import type { ChartDataPoint, ChartSeries } from "~/modules/reports/types";

/** Shelf's color palette for charts */
const CHART_COLORS = {
  primary: "#101828", // gray-900
  primaryLight: "#344054", // gray-700
  secondary: "#667085", // gray-500
  grid: "#F2F4F7", // gray-100
  axis: "#667085", // gray-500
  fill: "#101828", // gray-900
  fillOpacity: 0.1,
  compare: "#98A2B3", // gray-400
};

export interface AreaChartProps {
  /** Chart data series */
  series: ChartSeries[];
  /** Whether to show comparison line (uses compareValue from data points) */
  showComparison?: boolean;
  /** Y-axis label */
  yAxisLabel?: string;
  /** Whether to show legend */
  showLegend?: boolean;
  /** Custom tooltip formatter */
  tooltipFormatter?: (value: number, name: string) => string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Area chart with gradient fill.
 *
 * Monochrome styling:
 * - Primary series: gray-900 stroke with 10% fill
 * - Comparison series: gray-400 dashed stroke
 * - Grid: horizontal lines only, very subtle
 * - Axes: gray-500 text, minimal ticks
 */
export function AreaChart({
  series,
  showComparison = false,
  yAxisLabel,
  showLegend = false,
  tooltipFormatter,
  className,
}: AreaChartProps) {
  // Flatten series data for Recharts
  const chartData = useMemo(() => {
    if (series.length === 0) return [];

    // Use the first series as the base
    const primarySeries = series[0];
    return primarySeries.data.map((point) => ({
      date: point.date,
      value: point.value,
      compareValue: point.compareValue,
      label: point.label,
    }));
  }, [series]);

  if (chartData.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" className={className}>
      <RechartsAreaChart
        data={chartData}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
      >
        {/* Gradient definition */}
        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={CHART_COLORS.fill}
              stopOpacity={0.15}
            />
            <stop offset="100%" stopColor={CHART_COLORS.fill} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Grid - horizontal only, very subtle */}
        <CartesianGrid
          strokeDasharray="0"
          vertical={false}
          stroke={CHART_COLORS.grid}
        />

        {/* X-axis */}
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickMargin={8}
        />

        {/* Y-axis */}
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: CHART_COLORS.axis }}
          tickMargin={8}
          width={40}
          tickFormatter={(value) => {
            if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
            return value.toString();
          }}
          label={
            yAxisLabel
              ? {
                  value: yAxisLabel,
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 11, fill: CHART_COLORS.axis },
                }
              : undefined
          }
        />

        {/* Tooltip */}
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;

            return (
              <div className="rounded border border-gray-200 bg-white px-3 py-2 shadow-lg">
                <p className="text-xs font-medium text-gray-900">{label}</p>
                {payload.map((entry, index) => (
                  <p
                    key={index}
                    className="mt-1 text-sm text-gray-600"
                    style={{ color: entry.color }}
                  >
                    {entry.name}:{" "}
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
            );
          }}
        />

        {/* Legend */}
        {showLegend && (
          <Legend
            verticalAlign="top"
            align="right"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingBottom: 10 }}
          />
        )}

        {/* Comparison area (if enabled) */}
        {showComparison && (
          <Area
            type="monotone"
            dataKey="compareValue"
            name="Previous period"
            stroke={CHART_COLORS.compare}
            strokeWidth={1.5}
            strokeDasharray="4 4"
            fill="none"
          />
        )}

        {/* Primary area */}
        <Area
          type="monotone"
          dataKey="value"
          name={series[0]?.name || "Value"}
          stroke={CHART_COLORS.primary}
          strokeWidth={2}
          fill="url(#areaGradient)"
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}

export default AreaChart;
