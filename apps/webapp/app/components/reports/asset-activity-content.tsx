/**
 * @file Asset Activity report content.
 *
 * Renders the body of the "Asset Activity" report: a hero section summarising
 * total activity counts (assignments, check-ins/outs, most active asset) plus
 * a chronological table of recent asset events with semantic activity-type
 * badges.
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
import type { AssetActivityRow, ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

/**
 * Column definitions for the Asset Activity table, hoisted to module
 * scope. Same loop fix as IDLE_ASSETS_COLUMNS.
 */
const ASSET_ACTIVITY_COLUMNS: ColumnDef<AssetActivityRow>[] = [
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
    accessorKey: "activityType",
    header: "Activity",
    cell: ({ row }) => {
      const type = row.original.activityType;
      // Plain English labels — no jargon or internal codes
      const labels: Record<string, string> = {
        CREATED: "Asset created",
        UPDATED: "Asset updated",
        CUSTODY_ASSIGNED: "Assigned to team member",
        CUSTODY_RELEASED: "Returned from team member",
        BOOKING_CHECKED_OUT: "Checked out",
        BOOKING_CHECKED_IN: "Checked in",
        LOCATION_CHANGED: "Location changed",
        CATEGORY_CHANGED: "Category changed",
      };
      // Semantic colors for activity types
      const colors: Record<string, string> = {
        CREATED: "bg-green-100 text-green-700",
        UPDATED: "bg-blue-100 text-blue-700",
        CUSTODY_ASSIGNED: "bg-violet-100 text-violet-700",
        CUSTODY_RELEASED: "bg-violet-100 text-violet-700",
        BOOKING_CHECKED_OUT: "bg-orange-100 text-orange-700",
        BOOKING_CHECKED_IN: "bg-green-100 text-green-700",
        LOCATION_CHANGED: "bg-blue-100 text-blue-700",
        CATEGORY_CHANGED: "bg-blue-100 text-blue-700",
      };
      return (
        <span
          className={tw(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            colors[type] || "bg-gray-100 text-gray-700"
          )}
        >
          {labels[type] || type}
        </span>
      );
    },
  },
  {
    accessorKey: "performedBy",
    header: "Changed by",
    cell: ({ row }) =>
      row.original.performedBy || <span className="text-gray-400">System</span>,
  },
  {
    accessorKey: "occurredAt",
    header: "Date & Time",
    cell: ({ row }) => <DateCell date={row.original.occurredAt} />,
  },
];

/** Props for {@link AssetActivityContent}. */
type Props = {
  /** Asset activity rows for the table body. */
  rows: AssetActivityRow[];
  /** KPI values for the hero metrics (`total_activities`, `custody_changes`, `booking_activities`, `most_active_asset`). */
  kpis: ReportKpi[];
  /** Total row count shown in the table header pill. */
  totalRows: number;
  /** Click handler for table rows; usually navigates to the related asset/booking. */
  onRowClick?: (row: AssetActivityRow) => void;
};

/**
 * Renders the Asset Activity report body — hero KPIs, activity-type legend,
 * and the recent activity table.
 */
export function AssetActivityContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: Props) {
  // Stable reference is guaranteed by `ASSET_ACTIVITY_COLUMNS` living at
  // module scope (see its JSDoc for why that matters).
  const columns = ASSET_ACTIVITY_COLUMNS;

  // Extract KPI values
  const totalActivities =
    (kpis.find((k) => k.id === "total_activities")?.rawValue as number) || 0;
  const custodyChanges =
    (kpis.find((k) => k.id === "custody_changes")?.rawValue as number) || 0;
  const bookingActivities =
    (kpis.find((k) => k.id === "booking_activities")?.rawValue as number) || 0;
  const mostActiveAsset =
    kpis.find((k) => k.id === "most_active_asset")?.value || "—";

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalActivities}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Activities
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Assignments</span>
              <span className="text-lg font-medium text-gray-900">
                {custodyChanges}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Check-ins/outs</span>
              <span className="text-lg font-medium text-gray-900">
                {bookingActivities}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Most Active Asset</span>
              <span
                className="max-w-[120px] truncate text-lg font-medium text-gray-900"
                title={mostActiveAsset}
              >
                {mostActiveAsset}
              </span>
            </div>
          </div>
        </div>

        {/* Activity types legend */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-medium text-gray-700">
              Activity types:
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Asset created
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Updated / Moved
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              Custody changed
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              Checked out
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Checked in
            </span>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Recent Activity
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
              title="No activity"
              description="No asset activity recorded in this timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
