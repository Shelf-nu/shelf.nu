/**
 * Report Table Component
 *
 * Data table built on TanStack Table with Shelf's design system.
 * Optimized for reports: sortable columns, sticky header, compact rows.
 *
 * Features:
 * - Sortable columns with visual indicators
 * - Sticky header for long tables
 * - Compact row height (36px)
 * - Responsive column visibility
 * - Keyboard accessible
 *
 * @see {@link https://tanstack.com/table/v8}
 */

import type React from "react";
import { useEffect, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { AssetImage } from "~/components/assets/asset-image";
import { tw } from "~/utils/tw";

export interface ReportTableProps<TData> {
  /** Table data */
  data: TData[];
  /** Column definitions */
  columns: ColumnDef<TData, unknown>[];
  /** Initial sorting state */
  initialSorting?: SortingState;
  /** Whether to show the header row */
  showHeader?: boolean;
  /** Maximum height before scrolling (CSS value). Ignored when `fillParent` is true. */
  maxHeight?: string;
  /**
   * When true, the table fills its parent flex container instead of using a
   * fixed `maxHeight`. The parent must establish a height (e.g. `flex flex-col`
   * with a sized ancestor); the table becomes `flex-1 min-h-0 overflow-auto`
   * so the body scrolls and the sticky header stays in place.
   */
  fillParent?: boolean;
  /** Empty state content */
  emptyContent?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Row click handler */
  onRowClick?: (row: TData) => void;
  /**
   * When true, sorting is handled server-side.
   * Clicking column headers calls onSortingChange instead of sorting locally.
   */
  manualSorting?: boolean;
  /**
   * Callback when sorting changes. Used with manualSorting to sync to URL.
   * Called with the column ID and direction when user clicks a sortable column.
   */
  onSortChange?: (columnId: string, direction: "asc" | "desc") => void;
}

/**
 * Report data table with sorting and sticky header.
 *
 * Styling matches app's standard table component:
 * - Header: font-normal text-gray-600 (matches Th)
 * - Cells: p-4 md:px-6 (matches Td)
 * - Badges: rounded-2xl with dot (matches Badge)
 */
export function ReportTable<TData>({
  data,
  columns,
  initialSorting = [],
  showHeader = true,
  maxHeight = "calc(100vh - 400px)",
  fillParent = false,
  emptyContent,
  className,
  onRowClick,
  manualSorting = false,
  onSortChange,
}: ReportTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  // Sync sorting state when initialSorting prop changes (e.g., browser back/forward navigation)
  // This ensures the sort indicator matches the URL state
  // We serialize to compare because initialSorting is a new array on each render
  const initialSortingKey =
    manualSorting && initialSorting.length > 0
      ? `${initialSorting[0].id}-${initialSorting[0].desc}`
      : "";

  useEffect(() => {
    if (manualSorting && initialSorting.length > 0) {
      setSorting(initialSorting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using serialized key
  }, [initialSortingKey]);

  // Handle sorting change - either local or trigger server-side via callback
  const handleSortingChange = (
    updater: SortingState | ((old: SortingState) => SortingState)
  ) => {
    const newSorting =
      typeof updater === "function" ? updater(sorting) : updater;
    setSorting(newSorting);

    // If manual sorting enabled, notify parent to trigger server-side sort
    if (manualSorting && onSortChange && newSorting.length > 0) {
      const { id, desc } = newSorting[0];
      onSortChange(id, desc ? "desc" : "asc");
    }
  };

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    // Only use client-side sorting when not in manual mode
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
    // When manual sorting, tell TanStack not to sort internally
    manualSorting,
    // Prevent "no sort" state - always keep a sort active
    enableSortingRemoval: false,
  });

  const hasData = data.length > 0;

  return (
    <div
      className={tw("overflow-auto", fillParent && "min-h-0 flex-1", className)}
      style={fillParent ? undefined : { maxHeight }}
    >
      <table className="w-full border-collapse">
        {showHeader && (
          <thead className="sticky top-0 z-10 bg-white">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-gray-200">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      className={tw(
                        "p-4 text-left text-sm font-normal text-gray-600 md:px-6",
                        canSort &&
                          "cursor-pointer select-none hover:text-gray-900"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                      style={{ width: header.getSize() }}
                    >
                      <div className="flex items-center gap-1.5">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                        {canSort && <SortIcon direction={sorted} />}
                      </div>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
        )}

        <tbody>
          {hasData ? (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={tw(
                  "transition-colors",
                  onRowClick && "cursor-pointer hover:bg-gray-50"
                )}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="whitespace-nowrap border-b p-4 text-sm text-gray-900 md:px-6"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-sm text-gray-500"
              >
                {emptyContent || "No data available"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  const baseClass = "h-3.5 w-3.5";

  if (direction === "asc") {
    return <ArrowUp className={tw(baseClass, "text-gray-900")} />;
  }

  if (direction === "desc") {
    return <ArrowDown className={tw(baseClass, "text-gray-900")} />;
  }

  return <ArrowUpDown className={tw(baseClass, "text-gray-400")} />;
}

// -----------------------------------------------------------------------------
// Cell Renderers
// -----------------------------------------------------------------------------

/**
 * Status badge cell renderer.
 * Styled to match the app's Badge component pattern.
 *
 * Variants align with asset-status-badge.tsx colors:
 * - success (green) → AVAILABLE
 * - blue → IN_CUSTODY
 * - violet → CHECKED_OUT
 * - warning/error/neutral → booking/other statuses
 */
export function StatusCell({
  status,
  variant,
  withDot = true,
}: {
  status: string;
  variant: "success" | "warning" | "error" | "neutral" | "blue" | "violet";
  withDot?: boolean;
}) {
  const variantClasses = {
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    error: "bg-error-50 text-error-700",
    neutral: "bg-gray-100 text-gray-600",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
  };

  const dotClasses = {
    success: "bg-success-500",
    warning: "bg-warning-500",
    error: "bg-error-500",
    neutral: "bg-gray-400",
    blue: "bg-blue-500",
    violet: "bg-violet-500",
  };

  return (
    <span
      className={tw(
        "inline-flex items-center rounded-2xl py-[2px] text-xs font-medium",
        withDot ? "gap-1 pl-[6px] pr-2" : "px-2",
        variantClasses[variant]
      )}
    >
      {withDot && (
        <span className={tw("size-1.5 rounded-full", dotClasses[variant])} />
      )}
      {status}
    </span>
  );
}

/**
 * Date cell renderer with consistent formatting.
 */
export function DateCell({ date }: { date: Date | null }) {
  if (!date) {
    return <span className="text-gray-400">—</span>;
  }

  return (
    <span className="tabular-nums">
      {date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </span>
  );
}

/**
 * Number cell renderer with proper alignment.
 */
export function NumberCell({
  value,
  format = "number",
}: {
  value: number | null;
  format?: "number" | "currency" | "percent";
}) {
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>;
  }

  let formatted: string;

  switch (format) {
    case "currency":
      formatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);
      break;
    case "percent":
      formatted = new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }).format(value / 100);
      break;
    default:
      formatted = value.toLocaleString();
  }

  return <span className="tabular-nums">{formatted}</span>;
}

/**
 * Boolean indicator cell.
 */
export function BooleanCell({
  value,
  trueLabel = "Yes",
  falseLabel = "No",
}: {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return (
    <StatusCell
      status={value ? trueLabel : falseLabel}
      variant={value ? "success" : "neutral"}
    />
  );
}

/**
 * Asset name cell with thumbnail image.
 * Provides consistent asset display across all reports.
 *
 * When `assetId` is provided, uses the full `AssetImage` component which
 * automatically refreshes expired Supabase tokens.
 */
export function AssetCell({
  name,
  thumbnailImage,
  assetId,
}: {
  name: string;
  thumbnailImage: string | null;
  /** When provided, enables automatic image token refresh via AssetImage */
  assetId?: string;
}) {
  // If we have an assetId, use AssetImage for automatic token refresh
  if (assetId) {
    return (
      <div className="flex items-center gap-3">
        <AssetImage
          asset={{
            id: assetId,
            thumbnailImage,
          }}
          alt={`Image of ${name}`}
          className="size-8 shrink-0 rounded object-cover"
        />
        <span className="font-medium">{name}</span>
      </div>
    );
  }

  // Fallback: simple img without refresh capability
  return (
    <div className="flex items-center gap-3">
      <img
        src={thumbnailImage || "/static/images/asset-placeholder.jpg"}
        alt=""
        className="size-8 shrink-0 rounded object-cover"
      />
      <span className="font-medium">{name}</span>
    </div>
  );
}

export default ReportTable;
