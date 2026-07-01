/**
 * @file Monthly Booking Trends report content.
 *
 * Renders the body of the "Monthly Booking Trends" report: a hero section
 * summarising total bookings, monthly average, peak month and trend
 * direction; a bar chart visualising booking volume month-over-month; and a
 * data table with the per-month breakdown including month-over-month
 * change percentages.
 *
 * Extracted from the monolithic reports route during the
 * `reports.$reportId.tsx` decomposition. The route owns data fetching,
 * loader/action wiring, and timeframe handling; this component only
 * renders the report body it is handed.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://./report-table.tsx}
 * @see {@link file://./bar-chart.tsx}
 * @see {@link file://./chart-card.tsx}
 * @see {@link file://./report-empty-state.tsx}
 */

import type { ColumnDef } from "@tanstack/react-table";

import { BarChart } from "~/components/reports/bar-chart";
import { ChartCard } from "~/components/reports/chart-card";
import { ReportEmptyState } from "~/components/reports/report-empty-state";
import { NumberCell, ReportTable } from "~/components/reports/report-table";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import type {
  ChartSeries,
  MonthlyBookingTrendRow,
  ReportKpi,
} from "~/modules/reports/types";
import { tw } from "~/utils/tw";

/**
 * Column definitions for the Monthly Booking Trends table, declared at
 * module scope so cell function identities stay stable across renders. See
 * `.claude/rules/react-render-stability.md` for the underlying rule.
 */
const MONTHLY_BOOKING_TRENDS_COLUMNS: ColumnDef<MonthlyBookingTrendRow>[] = [
  {
    accessorKey: "month",
    header: "Month",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.month}</span>
    ),
  },
  {
    accessorKey: "bookingsCreated",
    header: "Bookings Created",
    cell: ({ row }) => <NumberCell value={row.original.bookingsCreated} />,
  },
  {
    accessorKey: "bookingsCompleted",
    header: "Bookings Completed",
    cell: ({ row }) => <NumberCell value={row.original.bookingsCompleted} />,
  },
  {
    accessorKey: "momChange",
    header: "vs Last Month",
    cell: ({ row }) => {
      const change = row.original.momChange;
      if (change === null) return <span className="text-gray-400">—</span>;
      return (
        <span
          className={tw(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            change > 0
              ? "bg-green-100 text-green-700"
              : change < 0
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-700"
          )}
        >
          {change > 0 ? "+" : ""}
          {change}%
        </span>
      );
    },
  },
];

/** Props for {@link MonthlyBookingTrendsContent}. */
type Props = {
  /** Monthly trend rows for the table body (one entry per month). */
  rows: MonthlyBookingTrendRow[];
  /**
   * KPI values for the hero metrics: `total_bookings`, `avg_monthly_bookings`,
   * `peak_month`, and `trend_direction`.
   */
  kpis: ReportKpi[];
  /** Total row count shown in the table header pill. */
  totalRows: number;
  /** Optional pre-built chart series for the bar chart visualisation. */
  chartSeries?: ChartSeries[];
};

/**
 * Renders the Monthly Booking Trends report content: hero metrics, a bar
 * chart of booking volume by month, and a table breaking down counts and
 * month-over-month change per period.
 *
 * @param props - See {@link Props}.
 * @returns The report body (hero + chart + data table) for the Monthly Booking Trends report.
 */
export function MonthlyBookingTrendsContent({
  rows,
  kpis,
  totalRows,
  chartSeries,
}: Props) {
  const columns = MONTHLY_BOOKING_TRENDS_COLUMNS;

  // Extract KPI values
  const totalBookings =
    (kpis.find((k) => k.id === "total_bookings")?.rawValue as number) || 0;
  const avgMonthly =
    (kpis.find((k) => k.id === "avg_monthly_bookings")?.rawValue as number) ||
    0;
  const peakMonth = kpis.find((k) => k.id === "peak_month")?.value || "—";
  const trendKpi = kpis.find((k) => k.id === "trend_direction");
  const trendDirection = trendKpi?.value || "Stable";
  const trendDeltaStr = trendKpi?.delta;
  const trendDelta = trendDeltaStr ? Number(trendDeltaStr) : null;
  const trendDescription = trendKpi?.description;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalBookings}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Bookings
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Average per Month</span>
              <span className="text-lg font-medium text-gray-900">
                {avgMonthly}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Peak Month</span>
              <span className="text-lg font-medium text-gray-900">
                {peakMonth}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">
                Trend (Last 2 Months)
              </span>
              {/* Use the shared InfoTooltip so the explanation is reachable
                  via keyboard focus (the previous custom hover-only div was
                  inaccessible to keyboard and touch users). */}
              <div className="flex items-center gap-1.5">
                <span
                  className={tw(
                    "text-lg font-medium",
                    trendDirection === "Increasing"
                      ? "text-green-600"
                      : trendDirection === "Decreasing"
                      ? "text-red-600"
                      : "text-gray-900"
                  )}
                >
                  {trendDirection}
                </span>
                {trendDelta !== null && (
                  <span
                    className={tw(
                      "text-sm",
                      trendDelta > 0 ? "text-green-600" : "text-red-600"
                    )}
                  >
                    ({trendDelta > 0 ? "+" : ""}
                    {trendDelta})
                  </span>
                )}
                <InfoTooltip
                  iconClassName="size-3.5"
                  content={
                    <p>
                      {trendDescription ||
                        "Compares the most recent month to the previous month"}
                    </p>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bar chart - proper Recharts visualization */}
      {chartSeries && chartSeries[0]?.data.length > 0 && (
        <ChartCard title="Booking Volume by Month">
          <div className="h-64">
            <BarChart
              series={chartSeries}
              radius={4}
              tooltipFormatter={(value) => `${value} bookings`}
            />
          </div>
        </ChartCard>
      )}

      {/* Data table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Monthly Breakdown
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No trend data"
              description="No bookings in the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
