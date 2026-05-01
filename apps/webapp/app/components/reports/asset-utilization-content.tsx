/**
 * @file Asset Utilization report content.
 *
 * Renders the body of the "Asset Utilization" report: a hero section showing
 * the average usage rate across the inventory (with a visual bar and the
 * supporting "total assets" / "total booking days" stats), a short
 * explanation of how the rate is calculated, and a table of per-asset usage
 * rates.
 *
 * Extracted from the monolithic reports route during the
 * `reports.$reportId.tsx` decomposition. The route owns data fetching,
 * loader/action wiring, and row-click navigation; this component only
 * renders the report body it is handed.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://./report-table.tsx}
 * @see {@link file://./report-empty-state.tsx}
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { ReportEmptyState } from "~/components/reports/report-empty-state";
import {
  AssetCell,
  NumberCell,
  ReportTable,
} from "~/components/reports/report-table";
import type { AssetUtilizationRow, ReportKpi } from "~/modules/reports/types";

/**
 * Column definitions for the Asset Utilization table, hoisted to module
 * scope. Same loop fix as IDLE_ASSETS_COLUMNS.
 */
const ASSET_UTILIZATION_COLUMNS: ColumnDef<AssetUtilizationRow>[] = [
  {
    accessorKey: "assetName",
    header: "Asset",
    cell: ({ row }) => (
      <AssetCell
        name={row.original.assetName}
        thumbnailImage={row.original.thumbnailImage}
        assetId={row.original.assetId}
      />
    ),
  },
  {
    accessorKey: "utilizationRate",
    header: "Usage Rate",
    cell: ({ row }) => {
      const rate = row.original.utilizationRate;
      return (
        <div className="flex items-center gap-2">
          <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${Math.min(rate, 100)}%` }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-gray-900">
            {rate}%
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "daysInUse",
    header: "Days Booked",
    cell: ({ row }) => (
      <span>
        {row.original.daysInUse} / {row.original.totalDays}
      </span>
    ),
  },
  {
    accessorKey: "bookingCount",
    header: "Bookings",
    cell: ({ row }) => <NumberCell value={row.original.bookingCount} />,
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) =>
      row.original.category || <span className="text-gray-400">—</span>,
  },
  {
    accessorKey: "valuation",
    header: "Value",
    cell: ({ row }) =>
      row.original.valuation ? (
        `$${row.original.valuation.toLocaleString()}`
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
];

/** Props for {@link AssetUtilizationContent}. */
type Props = {
  /** Per-asset utilization rows for the table body. */
  rows: AssetUtilizationRow[];
  /** KPI values for the hero metrics (`avg_utilization`, `total_booking_days`). */
  kpis: ReportKpi[];
  /** Total row count shown in the table header pill and "Total Assets" stat. */
  totalRows: number;
  /** Click handler for table rows; usually navigates to the asset detail page. */
  onRowClick?: (row: AssetUtilizationRow) => void;
};

/**
 * Renders the Asset Utilization report content: hero metrics (average usage
 * rate, total assets, total booking days), a short explainer of how the rate
 * is calculated, and a table of per-asset usage rates.
 *
 * @param props - See {@link Props}.
 * @returns The report body (hero section + data table) for the Asset Utilization report.
 */
export function AssetUtilizationContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: Props) {
  const columns: ColumnDef<AssetUtilizationRow>[] = useMemo(
    () => ASSET_UTILIZATION_COLUMNS,
    []
  );

  // Extract KPI values
  const avgUtilization =
    (kpis.find((k) => k.id === "avg_utilization")?.rawValue as number) || 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric with visual bar */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums text-gray-900">
                  {avgUtilization}%
                </span>
                <span className="text-sm font-medium text-gray-500">
                  average usage
                </span>
              </div>
              <div className="h-2 w-48 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{ width: `${Math.min(avgUtilization, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Assets</span>
              <span className="text-lg font-medium text-gray-900">
                {totalRows}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Booking Days</span>
              <span className="text-lg font-medium text-gray-900">
                {kpis.find((k) => k.id === "total_booking_days")?.value || "0"}
              </span>
            </div>
          </div>
        </div>

        {/* How utilization is calculated */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 md:px-6">
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              How it's calculated:
            </span>{" "}
            Usage rate = (total days booked ÷ days in period) × 100. Rates above
            100% indicate overlapping bookings where the asset was reserved
            multiple times simultaneously—a sign of high demand.
          </p>
        </div>
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Asset Usage Rates
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No usage data"
              description="No booking activity to calculate usage rates."
            />
          }
        />
      </div>
    </div>
  );
}
