/**
 * @file Idle Assets report content.
 *
 * Renders the body of the "Idle Assets" report: a hero section summarising
 * how many assets have not been used within the selected threshold (and the
 * value tied up in them), plus a table listing those assets so admins can
 * triage them.
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

import type { ColumnDef } from "@tanstack/react-table";

import { ReportEmptyState } from "~/components/reports/report-empty-state";
import {
  AssetCell,
  DateCell,
  ReportTable,
} from "~/components/reports/report-table";
import type { IdleAssetRow, ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

/**
 * Column definitions for the Idle Assets table, defined at module scope so
 * the cell function references stay stable across IdleAssetsContent renders.
 * See the loop bug fix in IdleAssetsContent for context.
 */
const IDLE_ASSETS_COLUMNS: ColumnDef<IdleAssetRow>[] = [
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
    accessorKey: "daysSinceLastUse",
    header: "Unused For",
    cell: ({ row }) => {
      const days = row.original.daysSinceLastUse;
      return (
        <span
          className={tw(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            days > 90
              ? "bg-red-100 text-red-700"
              : days > 60
              ? "bg-orange-100 text-orange-700"
              : "bg-yellow-100 text-yellow-700"
          )}
        >
          {days} days
        </span>
      );
    },
  },
  {
    accessorKey: "lastBookedAt",
    header: "Last Used",
    cell: ({ row }) =>
      row.original.lastBookedAt ? (
        <DateCell date={row.original.lastBookedAt} />
      ) : (
        <span className="text-gray-400">Never</span>
      ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) =>
      row.original.category || <span className="text-gray-400">—</span>,
  },
  {
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) =>
      row.original.location || <span className="text-gray-400">—</span>,
  },
  {
    accessorKey: "valuation",
    header: "Value",
    cell: ({ row }) =>
      // `!= null` so a real $0 valuation renders as "$0", not "—".
      row.original.valuation != null ? (
        `$${row.original.valuation.toLocaleString()}`
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
];

/** Props for {@link IdleAssetsContent}. */
type Props = {
  /** Idle asset rows for the table body. */
  rows: IdleAssetRow[];
  /** KPI values for the hero metrics (`total_idle`, `idle_percentage`, `total_idle_value`). */
  kpis: ReportKpi[];
  /** Total row count shown in the table header pill. */
  totalRows: number;
  /** Human-readable threshold label (e.g. "Last 90 days") shown in the empty state. */
  timeframeLabel?: string;
  /** Click handler for table rows; usually navigates to the asset detail page. */
  onRowClick?: (row: IdleAssetRow) => void;
};

/**
 * Renders the Idle Assets report content: hero metrics + table of assets that
 * have not been used within the selected threshold.
 *
 * @param props - See {@link Props}.
 * @returns The report body (hero section + data table) for the Idle Assets report.
 */
export function IdleAssetsContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  onRowClick,
}: Props) {
  // Column definitions live at module scope (`IDLE_ASSETS_COLUMNS`) so the
  // array reference — and every cell function inside — is stable across
  // every render. That stability is what prevents TanStack `flexRender`
  // from handing React a new component type per render, which would
  // remount AssetCell → AssetImage → re-fetch + abort every image.
  const columns = IDLE_ASSETS_COLUMNS;

  // Extract KPI values
  const totalIdle =
    (kpis.find((k) => k.id === "total_idle")?.rawValue as number) || 0;
  const idlePercentage =
    (kpis.find((k) => k.id === "idle_percentage")?.rawValue as number) || 0;
  const totalIdleValue =
    (kpis.find((k) => k.id === "total_idle_value")?.rawValue as number) || 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span
                className={tw(
                  "text-3xl font-semibold",
                  totalIdle > 10
                    ? "text-orange-600"
                    : totalIdle > 0
                    ? "text-yellow-600"
                    : "text-green-600"
                )}
              >
                {totalIdle}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Unused Assets
              </span>
              <span className="text-xs text-gray-500">
                {idlePercentage}% of inventory
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalIdleValue > 0
                  ? `$${totalIdleValue.toLocaleString()}`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Unused Assets</h3>
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
              title="No idle assets"
              description={`All your assets have been used within the selected threshold${
                timeframeLabel ? ` (${timeframeLabel.toLowerCase()})` : ""
              }.`}
            />
          }
        />
      </div>
    </div>
  );
}
