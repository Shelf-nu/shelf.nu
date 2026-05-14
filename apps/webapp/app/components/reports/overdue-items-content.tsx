/**
 * @file Overdue Items Report Content
 *
 * Renders the body of the "Overdue Items" report (R6): a hero metric
 * summarising the number of assets currently outstanding plus aggregate
 * value-at-risk and longest-overdue stats, followed by a table listing each
 * overdue booking with its return progress.
 *
 * Extracted from the route file so the route stays focused on data loading
 * and per-report dispatch. Column definitions live inline because they are
 * consumed only by this component.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 */

import type { ColumnDef } from "@tanstack/react-table";

import type { OverdueItemRow, ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

import { ReportEmptyState } from "./report-empty-state";
import { ReportTable, DateCell } from "./report-table";

/**
 * Column definitions for the Overdue Items table, declared at module scope
 * so cell function identities stay stable across renders. See
 * `.claude/rules/react-render-stability.md` for the underlying rule.
 */
const OVERDUE_ITEMS_COLUMNS: ColumnDef<OverdueItemRow>[] = [
  {
    accessorKey: "bookingName",
    header: "Booking",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.bookingName}</span>
    ),
  },
  {
    accessorKey: "custodian",
    header: "Booked by",
    cell: ({ row }) =>
      row.original.custodian || <span className="text-gray-400">—</span>,
  },
  {
    accessorKey: "uncheckedCount",
    header: "Assets",
    cell: ({ row }) => {
      const { uncheckedCount, assetCount, checkedInCount } = row.original;
      const hasPartialReturns = checkedInCount > 0;
      const progressPercent =
        assetCount > 0 ? (checkedInCount / assetCount) * 100 : 0;

      return (
        <div className="flex items-center gap-2">
          <span className="font-medium tabular-nums">
            {uncheckedCount}
            <span className="font-normal text-gray-400"> / {assetCount}</span>
          </span>
          {hasPartialReturns && (
            <div className="h-2 w-12 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-green-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "scheduledEnd",
    header: "Due Date",
    cell: ({ row }) => <DateCell date={row.original.scheduledEnd} />,
  },
  {
    accessorKey: "daysOverdue",
    header: "Days Overdue",
    cell: ({ row }) => {
      const days = row.original.daysOverdue;
      return (
        <span
          className={tw(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            days > 7
              ? "bg-red-100 text-red-700"
              : days > 3
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
    accessorKey: "valueAtRisk",
    header: "Value",
    cell: ({ row }) =>
      // `!= null` so a real $0 value-at-risk renders as "$0", not "—".
      row.original.valueAtRisk != null ? (
        `$${row.original.valueAtRisk.toLocaleString()}`
      ) : (
        <span className="text-gray-400">—</span>
      ),
  },
];

/** Props for the OverdueItemsContent component. */
type Props = {
  /** Overdue booking rows currently in scope (already filtered by the loader). */
  rows: OverdueItemRow[];
  /** KPI list from the report payload; used to source hero metrics by id. */
  kpis: ReportKpi[];
  /** Total number of rows for the table-header count badge. */
  totalRows: number;
  /** Optional row click handler — the route uses this to navigate to the booking. */
  onRowClick?: (row: OverdueItemRow) => void;
};

/**
 * Renders the Overdue Items report content (hero + table).
 *
 * @param props - See {@link Props}.
 * @returns The hero metrics card and overdue-bookings table.
 */
export function OverdueItemsContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: Props) {
  const columns = OVERDUE_ITEMS_COLUMNS;

  // Extract KPI values for hero display
  const totalOverdue =
    (kpis.find((k) => k.id === "total_overdue")?.rawValue as number) || 0;
  const assetsAtRisk =
    (kpis.find((k) => k.id === "total_assets_at_risk")?.rawValue as number) ||
    0;
  const valueAtRisk =
    (kpis.find((k) => k.id === "total_value_at_risk")?.rawValue as number) || 0;
  const longestOverdue =
    (kpis.find((k) => k.id === "longest_overdue")?.rawValue as number) || 0;

  return (
    <div className="space-y-4">
      {/* Hero section with key metrics */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric - lead with assets (the scope of the problem) */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span
                className={tw(
                  "text-3xl font-semibold",
                  assetsAtRisk > 0 ? "text-red-600" : "text-green-600"
                )}
              >
                {assetsAtRisk}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                {assetsAtRisk === 1 ? "Asset" : "Assets"} Outstanding
              </span>
              {totalOverdue > 0 ? (
                <span className="text-xs text-gray-500">
                  across {totalOverdue} overdue booking
                  {totalOverdue !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-xs text-green-600">
                  All assets returned on time
                </span>
              )}
            </div>
          </div>

          {/* Supporting stats */}
          {totalOverdue > 0 && (
            <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Total Value</span>
                <span className="text-lg font-medium text-gray-900">
                  {valueAtRisk > 0 ? `$${valueAtRisk.toLocaleString()}` : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Longest Overdue</span>
                <span className="text-lg font-medium text-red-600">
                  {longestOverdue > 0 ? `${longestOverdue} days` : "—"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Data table */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Overdue Bookings
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          maxHeight="500px"
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No items waiting"
              description="All items have been returned on schedule."
            />
          }
        />
      </div>
    </div>
  );
}
