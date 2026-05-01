/**
 * @file Top Booked Assets Report Content
 *
 * Renders the body of the "Top Booked Assets" report: a hero card showing
 * total bookings, average bookings per asset, and the single most-booked
 * asset (independent of pagination), followed by a paginated table of
 * assets ranked by booking volume.
 *
 * Extracted from the monolithic report runner route during the
 * `reports.$reportId.tsx` refactor so each report's presentation lives
 * alongside its siblings in `~/components/reports/*`.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";

import { AssetImage } from "~/components/assets/asset-image";
import { ReportEmptyState } from "~/components/reports/report-empty-state";
import { AssetCell, ReportTable } from "~/components/reports/report-table";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import type { ReportKpi, TopBookedAssetRow } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

// why: defined at module scope so the function identity is stable across
// renders. TanStack's flexRender treats a different `header` function ref as a
// different component type and remounts the whole subtree — for a header that
// renders Radix's InfoTooltip, the ref-attach/detach churn triggers
// setTrigger(...) loops during navigation transitions ("Maximum update depth
// exceeded" — see SHELF-WEBAPP-1J4).
function AvgDurationHeader() {
  return (
    <span className="flex items-center gap-1">
      Avg Duration
      <InfoTooltip
        iconClassName="size-3.5"
        content={
          <p>
            <strong>Average booking duration</strong> — How long this asset is
            typically kept per booking. Calculated as total days booked ÷ number
            of bookings.
          </p>
        }
      />
    </span>
  );
}

/**
 * Column definitions for the Top Booked Assets table, defined at module
 * scope so cell function refs are stable across TopBookedAssetsContent
 * renders. See the loop fix explanation in IDLE_ASSETS_COLUMNS / the
 * commit history of this file.
 */
const TOP_BOOKED_ASSETS_COLUMNS: ColumnDef<TopBookedAssetRow>[] = [
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
    accessorKey: "bookingCount",
    header: "Bookings",
    cell: ({ row }) => (
      <Link
        to={`/assets/${row.original.assetId}/bookings`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200"
        title="View all bookings for this asset"
      >
        {row.original.bookingCount}
      </Link>
    ),
  },
  {
    accessorKey: "totalDaysBooked",
    header: "Total Days",
    cell: ({ row }) => (
      <span className="text-sm text-gray-700">
        {row.original.totalDaysBooked}
      </span>
    ),
  },
  {
    id: "avgDuration",
    header: AvgDurationHeader,
    // Compute average duration for sorting
    accessorFn: (row) =>
      row.bookingCount > 0 ? row.totalDaysBooked / row.bookingCount : 0,
    cell: ({ row }) => {
      const avgDays = row.getValue("avgDuration") as number;

      // Visual bar capped at 14 days (2 weeks) as reference max
      const barPercent = Math.min((avgDays / 14) * 100, 100);

      return (
        <div className="flex items-center gap-2">
          <div className="h-2 w-12 overflow-hidden rounded-full bg-gray-100">
            <div
              className={tw(
                "h-full rounded-full",
                avgDays >= 7
                  ? "bg-blue-600"
                  : avgDays >= 3
                  ? "bg-blue-400"
                  : "bg-blue-200"
              )}
              style={{ width: `${barPercent}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-xs text-gray-600">
            {avgDays >= 1
              ? `${avgDays.toFixed(1)}d`
              : `${Math.round(avgDays * 24)}h`}
          </span>
        </div>
      );
    },
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
];

/** Props accepted by {@link TopBookedAssetsContent}. */
type Props = {
  /** Page of asset rows to render in the table (already paginated server-side). */
  rows: TopBookedAssetRow[];
  /** KPI bag from the loader (contains `total_bookings`, `unique_assets_booked`, `avg_bookings_per_asset`). */
  kpis: ReportKpi[];
  /** Total row count across all pages — drives the count badge above the table. */
  totalRows: number;
  /** Human-readable timeframe label (e.g. "Last 30 days") used in context guidance. */
  timeframeLabel?: string;
  /** The #1 most booked asset - independent of pagination */
  topBookedAsset?: TopBookedAssetRow | null;
  /** Row click handler that typically navigates to the asset detail page. */
  onRowClick?: (row: TopBookedAssetRow) => void;
};

/**
 * Renders the Top Booked Assets report body: hero card with total bookings,
 * unique assets booked, average per asset, and the single top asset; plus
 * a paginated, sortable table of assets ranked by booking volume.
 *
 * @param props - See {@link Props}.
 * @returns Report content for the "top-booked-assets" report.
 */
export function TopBookedAssetsContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  topBookedAsset,
  onRowClick,
}: Props) {
  // Column definitions for top booked assets table.
  // Memoized so cell function refs are stable across re-renders — see the
  // detailed loop explanation in CustodySnapshotContent above. Cells here
  // are pure (no closure variables), so deps are empty.
  const columns: ColumnDef<TopBookedAssetRow>[] = useMemo(
    () => TOP_BOOKED_ASSETS_COLUMNS,
    []
  );

  // Extract KPI values
  const totalBookings =
    (kpis.find((k) => k.id === "total_bookings")?.rawValue as number) || 0;
  const uniqueAssetsBooked =
    (kpis.find((k) => k.id === "unique_assets_booked")?.rawValue as number) ||
    0;
  const avgBookingsPerAsset =
    (kpis.find((k) => k.id === "avg_bookings_per_asset")?.rawValue as number) ||
    0;

  // Most booked asset comes from server (independent of pagination)
  const topAsset = topBookedAsset || null;

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
              <span className="text-xs text-gray-500">
                {uniqueAssetsBooked} assets booked
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Avg per Asset</span>
              <span className="text-lg font-medium text-gray-900">
                {avgBookingsPerAsset.toFixed(1)}
              </span>
            </div>

            {/* Most booked asset with image */}
            {topAsset && (
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Most Booked</span>
                <Link
                  to={`/assets/${topAsset.assetId}`}
                  className="group -mx-1.5 mt-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-gray-50"
                >
                  <AssetImage
                    asset={{
                      id: topAsset.assetId,
                      thumbnailImage: topAsset.thumbnailImage,
                    }}
                    alt={`Image of ${topAsset.assetName}`}
                    className="size-8 rounded object-cover ring-1 ring-gray-200"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span
                      className="max-w-[200px] truncate text-sm font-medium text-gray-900 group-hover:text-primary-600"
                      title={topAsset.assetName}
                    >
                      {topAsset.assetName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {topAsset.bookingCount} booking
                      {topAsset.bookingCount !== 1 ? "s" : ""} · #1 most booked
                    </span>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Context guidance */}
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2 md:px-6">
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-600">
              Understanding this report:
            </span>{" "}
            Shows which assets are booked most frequently during{" "}
            <span className="font-medium">
              {(timeframeLabel || "the selected period").toLowerCase()}
            </span>
            . <span className="italic">Total Days</span> = cumulative booking
            days. <span className="italic">Avg Duration</span> = typical booking
            length per checkout. Use longer timeframes (30+ days) for meaningful
            duration trends.
          </p>
        </div>
      </div>

      {/* Data table — fills remaining vertical space inside the route's flex column
          and scrolls internally when row count exceeds the visible area. */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Top Assets</h3>
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
              title="No booking data"
              description="No assets have been booked within the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
