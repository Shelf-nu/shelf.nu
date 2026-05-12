/**
 * @file Custody Snapshot Report Content
 *
 * Renders the live "who currently holds what" view for the Custody Snapshot
 * report: a hero section with the four headline KPIs (assets in custody,
 * custodians, total value, average tenure) followed by a table of every
 * active custody assignment, including a relative tenure bar.
 *
 * Unlike sibling report-content components, this one intentionally does NOT
 * hoist its column definitions to a module-level `_COLUMNS` constant. The
 * "Days Held" cell renders a tenure bar whose width is relative to the
 * longest-held asset on screen (`maxDays`), which is computed from `rows`
 * at render time. The columns therefore close over `maxDays` and must stay
 * inside `useMemo` with `maxDays` in the dependency array. Memoization is
 * still required to keep cell function references stable between renders so
 * TanStack `flexRender` does not unmount/remount every `AssetCell` (and the
 * `AssetImage` inside it) on each render — see the inline comment.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { ReportEmptyState } from "~/components/reports/report-empty-state";
import {
  AssetCell,
  CurrencyCell,
  DateCell,
  ReportTable,
} from "~/components/reports/report-table";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { CustodySnapshotRow, ReportKpi } from "~/modules/reports/types";
import { useHints } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";

/** Props for {@link CustodySnapshotContent}. */
type Props = {
  /** Active custody assignments to display in the table. */
  rows: CustodySnapshotRow[];
  /** KPI values driving the hero section (total in custody, custodians, value, avg tenure). */
  kpis: ReportKpi[];
  /** Total row count, shown as a pill next to the table heading. */
  totalRows: number;
  /** Optional row click handler — typically navigates to the asset detail page. */
  onRowClick?: (row: CustodySnapshotRow) => void;
};

/**
 * Custody Snapshot report body.
 *
 * Computes a relative tenure-bar scale from `rows` (the longest-held asset
 * defines 100% width) and renders the hero KPIs followed by the assignment
 * table.
 *
 * @param props - See {@link Props}.
 * @returns The rendered report content.
 */
export function CustodySnapshotContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: Props) {
  const currentOrganization = useCurrentOrganization();
  const { locale } = useHints();

  // Calculate max days for relative bar width
  const maxDays = Math.max(...rows.map((r) => r.daysInCustody), 1);

  // Column definitions for custody snapshot table.
  // Memoized so cell function refs are stable across re-renders. Without
  // this, TanStack flexRender hands React a new component type on every
  // render → every AssetCell unmounts/remounts → every AssetImage
  // remounts → image-fetch storm. Deps include `maxDays` because the
  // tenure-bar cell closes over it.
  const columns: ColumnDef<CustodySnapshotRow>[] = useMemo(
    () => [
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
        accessorKey: "custodianName",
        header: "Assigned to",
        cell: ({ row }) => row.original.custodianName,
      },
      {
        accessorKey: "daysInCustody",
        header: "Days Held",
        cell: ({ row }) => {
          const days = row.original.daysInCustody;
          const percentage = Math.min((days / maxDays) * 100, 100);
          return (
            <div className="flex items-center gap-3">
              {/* Tenure bar - visual indicator of relative duration */}
              <div className="relative h-2 w-16 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary-500 transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              {/* Days value */}
              <span className="min-w-16 text-sm font-medium tabular-nums text-gray-900">
                {days} <span className="font-normal text-gray-500">days</span>
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: "assignedAt",
        header: "Assigned",
        cell: ({ row }) => <DateCell date={row.original.assignedAt} />,
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
        cell: ({ row }) => (
          <CurrencyCell value={row.original.valuation} treatZeroAsEmpty />
        ),
      },
    ],
    [maxDays]
  );

  // Extract KPI values
  const totalInCustody =
    (kpis.find((k) => k.id === "total_in_custody")?.rawValue as number) || 0;
  const totalCustodians =
    (kpis.find((k) => k.id === "total_custodians")?.rawValue as number) || 0;
  const totalCustodyValue =
    (kpis.find((k) => k.id === "total_custody_value")?.rawValue as number) || 0;
  const avgDaysInCustody =
    (kpis.find((k) => k.id === "avg_days_in_custody")?.rawValue as number) || 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalInCustody}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Assets Currently Assigned
              </span>
              <span className="text-xs text-gray-500">
                Across {totalCustodians} team member
                {totalCustodians !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalCustodyValue > 0
                  ? formatCurrency({
                      value: totalCustodyValue,
                      currency: currentOrganization?.currency ?? "USD",
                      locale,
                    })
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Avg. Tenure</span>
              <span className="text-lg font-medium text-gray-900">
                {avgDaysInCustody > 0
                  ? `${Math.round(avgDaysInCustody)} days`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Current Assignments
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
              title="No assets assigned"
              description="No assets are currently assigned to team members."
            />
          }
        />
      </div>
    </div>
  );
}
