/**
 * @file Booking Compliance report content.
 *
 * Renders the Booking Compliance report body: a `ComplianceHero` with the
 * on-time return rate plus a `ReportTable` of booking detail rows. Owns the
 * URL-driven sort state for the table (server-side sorting) and a small set
 * of presentation helpers (`formatStatus`, `getStatusVariant`,
 * `formatLateness`) used only by this report.
 *
 * Extracted from the dynamic report runner route so each report's content
 * lives next to the other report UI primitives.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 */

import type { ColumnDef } from "@tanstack/react-table";

import { useSearchParams } from "~/hooks/search-params";
import type { BookingComplianceSortColumn } from "~/modules/reports/helpers.server";
import type { BookingComplianceRow } from "~/modules/reports/types";

import { ComplianceHero } from "./compliance-hero";
import { ReportEmptyState } from "./report-empty-state";
import { ReportTable, StatusCell, DateCell, NumberCell } from "./report-table";

/** Props for {@link BookingComplianceContent}. */
type Props = {
  /** Booking detail rows for the current page (already sorted/paginated by the server). */
  rows: BookingComplianceRow[];
  /**
   * Aggregated compliance metrics for the selected timeframe.
   * Optional because the loader may not always include it (e.g. error states).
   */
  complianceData?: {
    /** Count of bookings returned on time within the grace period. */
    onTime: number;
    /** Count of bookings returned late (past the grace period). */
    late: number;
    /** Overall on-time rate (0–100), or `null` when there is nothing to score. */
    rate: number | null;
    /** Optional comparison to the previous equivalent period. */
    priorPeriod?: { rate: number; delta: number; periodLabel: string };
  };
  /** Total bookings in the filtered dataset (for the table header count badge). */
  totalBookings: number;
  /** Human-readable label for the selected timeframe (e.g. "Last 30 days"). */
  timeframeLabel?: string;
  /** Called when a row is clicked (typically navigates to the booking detail page). */
  onRowClick?: (row: BookingComplianceRow) => void;
};

/**
 * Booking Compliance report content.
 *
 * Renders the hero metric and the booking details table. Manages its own
 * sort state via the URL so the server can do the actual sorting and
 * pagination — there is no client-side sorting fallback here.
 */
export function BookingComplianceContent({
  rows,
  complianceData,
  totalBookings,
  timeframeLabel,
  onRowClick,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Map column accessorKey to server sort column
  const columnToSortColumn: Record<string, BookingComplianceSortColumn> = {
    bookingName: "bookingName",
    status: "status",
    custodian: "custodian",
    assetCount: "assetCount",
    scheduledEnd: "scheduledEnd",
    latenessMs: "returnStatus",
  };

  // Read current sort from URL
  const currentSortBy = searchParams.get("sortBy") || "scheduledEnd";
  const currentSortOrder = searchParams.get("sortOrder") || "desc";

  // Map server sort column back to column ID for TanStack
  const sortColumnToAccessor: Record<string, string> = {
    bookingName: "bookingName",
    status: "status",
    custodian: "custodian",
    assetCount: "assetCount",
    scheduledEnd: "scheduledEnd",
    returnStatus: "latenessMs",
  };
  const initialSortColumn =
    sortColumnToAccessor[currentSortBy] || "scheduledEnd";

  // Handle sort change - update URL to trigger server-side sort
  const handleSortChange = (columnId: string, direction: "asc" | "desc") => {
    const serverColumn = columnToSortColumn[columnId];
    if (!serverColumn) return;

    const params = new URLSearchParams(searchParams);
    params.set("sortBy", serverColumn);
    params.set("sortOrder", direction);
    // Reset to page 1 when sort changes
    params.set("page", "1");
    setSearchParams(params, { replace: true });
  };

  // Column definitions for the booking compliance table
  const columns: ColumnDef<BookingComplianceRow>[] = [
    {
      accessorKey: "bookingName",
      header: "Booking",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.bookingName}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status;
        const variant = getStatusVariant(status);
        return <StatusCell status={formatStatus(status)} variant={variant} />;
      },
    },
    {
      accessorKey: "custodian",
      header: "Booked by",
      cell: ({ row }) =>
        row.original.custodian || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "assetCount",
      header: "Assets",
      cell: ({ row }) => <NumberCell value={row.original.assetCount} />,
    },
    {
      accessorKey: "scheduledEnd",
      header: "Due Date",
      cell: ({ row }) => <DateCell date={row.original.scheduledEnd} />,
    },
    {
      accessorKey: "latenessMs",
      header: "Return Status",
      cell: ({ row }) => {
        const { isOnTime, latenessMs } = row.original;
        if (isOnTime) {
          return <StatusCell status="On time" variant="success" />;
        }
        // Format lateness as human-readable
        const lateness = formatLateness(latenessMs);
        return (
          <span className="text-sm font-medium text-orange-600">
            {lateness}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* The Answer */}
      <ComplianceHero
        rate={complianceData?.rate ?? 0}
        onTime={complianceData?.onTime ?? 0}
        late={complianceData?.late ?? 0}
        priorPeriod={complianceData?.priorPeriod}
        timeframeLabel={timeframeLabel}
      />

      {/* Booking details table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Booking Details
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalBookings}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          onRowClick={onRowClick}
          manualSorting
          initialSorting={[
            { id: initialSortColumn, desc: currentSortOrder === "desc" },
          ]}
          onSortChange={handleSortChange}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No bookings found"
              description="No bookings match the current filters."
            />
          }
        />
      </div>
    </div>
  );
}

/**
 * Map a raw booking status enum to its human-readable label.
 * Falls back to the raw value if no mapping is defined.
 */
function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    RESERVED: "Reserved",
    ONGOING: "Ongoing",
    OVERDUE: "Overdue",
    COMPLETE: "Complete",
    CANCELLED: "Cancelled",
    ARCHIVED: "Archived",
  };
  return labels[status] || status;
}

/**
 * Map a booking status to a {@link StatusCell} variant.
 * `OVERDUE` is the only "error" state; everything else is neutral or success.
 */
function getStatusVariant(
  status: string
): "success" | "warning" | "error" | "neutral" {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "ONGOING":
    case "RESERVED":
      return "neutral";
    case "OVERDUE":
      return "error";
    case "CANCELLED":
    case "DRAFT":
    case "ARCHIVED":
    default:
      return "neutral";
  }
}

/**
 * Format a lateness duration (in milliseconds) as a human-readable string.
 * Positive values mean late (after scheduled end), negative values mean early.
 *
 * @returns A string like `"2d 3h late"`, `"45m early"`, or `"—"` when null.
 */
function formatLateness(ms: number | null): string {
  if (ms === null) return "—";

  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / (1000 * 60));
  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const days = Math.floor(absMs / (1000 * 60 * 60 * 24));

  let value: string;
  if (days > 0) {
    const remainingHours = hours % 24;
    value = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    value =
      remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    value = `${minutes}m`;
  }

  return ms > 0 ? `${value} late` : `${value} early`;
}
