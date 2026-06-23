/**
 * @file Top Booked Kits Report Content
 *
 * Renders the body of the "Top Booked Kits" report: a hero card showing the
 * total kit bookings, average bookings per kit, and the single most-booked
 * kit (independent of pagination), followed by a paginated table of kits
 * ranked by booking volume.
 *
 * The kit counterpart to {@link file://./top-booked-assets-content.tsx}.
 * Kits are atomic in bookings (you cannot book a single item out of a kit), so
 * each kit is counted once per booking it appears in.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://../../modules/reports/helpers.server.ts}
 */

import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router";

import KitImage from "~/components/kits/kit-image";
import { ReportEmptyState } from "~/components/reports/report-empty-state";
import { KitCell, ReportTable } from "~/components/reports/report-table";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import type { ReportKpi, TopBookedKitRow } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

// why: defined at module scope so the function identity is stable across
// renders. TanStack's flexRender treats a different `header` function ref as a
// different component type and remounts the whole subtree — for a header that
// renders Radix's InfoTooltip, the ref-attach/detach churn triggers
// setTrigger(...) loops during navigation transitions ("Maximum update depth
// exceeded"). See top-booked-assets-content.tsx for the original failure mode.
function AvgDurationHeader() {
  return (
    <span className="flex items-center gap-1">
      Avg Duration
      <InfoTooltip
        iconClassName="size-3.5"
        content={
          <p>
            <strong>Average booking duration</strong> — How long this kit is
            typically kept per booking. Calculated as total days booked ÷ number
            of bookings.
          </p>
        }
      />
    </span>
  );
}

/**
 * Column definitions for the Top Booked Kits table, defined at module scope so
 * cell function refs are stable across TopBookedKitsContent renders (see the
 * render-stability note on AvgDurationHeader above).
 */
const TOP_BOOKED_KITS_COLUMNS: ColumnDef<TopBookedKitRow>[] = [
  {
    accessorKey: "kitName",
    header: "Kit",
    cell: ({ row }) => (
      <KitCell
        name={row.original.kitName}
        image={row.original.image}
        imageExpiration={row.original.imageExpiration}
        kitId={row.original.kitId}
      />
    ),
  },
  {
    accessorKey: "bookingCount",
    header: "Bookings",
    cell: ({ row }) => (
      <Link
        to={`/kits/${row.original.kitId}/bookings`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200"
        title="View all bookings for this kit"
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

/** Props accepted by {@link TopBookedKitsContent}. */
type Props = {
  /** Page of kit rows to render in the table (already paginated server-side). */
  rows: TopBookedKitRow[];
  /** KPI bag from the loader (contains `total_kit_bookings`, `unique_kits_booked`, `avg_bookings_per_kit`). */
  kpis: ReportKpi[];
  /** Total row count across all pages — drives the count badge above the table. */
  totalRows: number;
  /** Human-readable timeframe label (e.g. "Last 30 days") used in context guidance. */
  timeframeLabel?: string;
  /** The #1 most booked kit - independent of pagination */
  topBookedKit?: TopBookedKitRow | null;
  /** Row click handler that typically navigates to the kit detail page. */
  onRowClick?: (row: TopBookedKitRow) => void;
};

/**
 * Renders the Top Booked Kits report body: hero card with total kit bookings,
 * unique kits booked, average per kit, and the single top kit; plus a
 * paginated, sortable table of kits ranked by booking volume.
 *
 * @param props - See {@link Props}.
 * @returns Report content for the "top-booked-kits" report.
 */
export function TopBookedKitsContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  topBookedKit,
  onRowClick,
}: Props) {
  // Stable reference is guaranteed by `TOP_BOOKED_KITS_COLUMNS` living at
  // module scope (see its JSDoc for why that matters).
  const columns = TOP_BOOKED_KITS_COLUMNS;

  // Extract KPI values
  const totalKitBookings =
    (kpis.find((k) => k.id === "total_kit_bookings")?.rawValue as number) || 0;
  const uniqueKitsBooked =
    (kpis.find((k) => k.id === "unique_kits_booked")?.rawValue as number) || 0;
  const avgBookingsPerKit =
    (kpis.find((k) => k.id === "avg_bookings_per_kit")?.rawValue as number) ||
    0;

  // Most booked kit comes from server (independent of pagination)
  const topKit = topBookedKit || null;

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalKitBookings}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Bookings
              </span>
              <span className="text-xs text-gray-500">
                {uniqueKitsBooked} kits booked
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Avg per Kit</span>
              <span className="text-lg font-medium text-gray-900">
                {avgBookingsPerKit.toFixed(1)}
              </span>
            </div>

            {/* Most booked kit with image */}
            {topKit && (
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Most Booked</span>
                <Link
                  to={`/kits/${topKit.kitId}`}
                  className="group -mx-1.5 mt-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-gray-50"
                >
                  <KitImage
                    kit={{
                      kitId: topKit.kitId,
                      image: topKit.image,
                      imageExpiration: topKit.imageExpiration,
                      alt: `Image of ${topKit.kitName}`,
                    }}
                    className="size-8 rounded object-cover ring-1 ring-gray-200"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span
                      className="max-w-[200px] truncate text-sm font-medium text-gray-900 group-hover:text-primary-600"
                      title={topKit.kitName}
                    >
                      {topKit.kitName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {topKit.bookingCount} booking
                      {topKit.bookingCount !== 1 ? "s" : ""} · #1 most booked
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
            Shows which kits are booked most frequently during{" "}
            <span className="font-medium">
              {(timeframeLabel || "the selected period").toLowerCase()}
            </span>
            . A kit counts once per booking it appears in (kits are booked as a
            whole unit). <span className="italic">Total Days</span> = cumulative
            booking days. <span className="italic">Avg Duration</span> = typical
            booking length per checkout. Category and location reflect each
            kit&apos;s current settings. Counts confirmed bookings in the period
            (reserved through completed, plus archived) and excludes drafts and
            cancellations, so this can differ from a kit&apos;s all-time
            bookings list.
          </p>
        </div>
      </div>

      {/* Data table — fills remaining vertical space inside the route's flex column
          and scrolls internally when row count exceeds the visible area. */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Top Kits</h3>
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
              description="No kits have been booked within the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
