/**
 * Report Shell Component
 *
 * Layout wrapper for report pages. Provides consistent structure:
 * - Header with title, description, and export action
 * - Filter bar area (timeframe picker, filters)
 * - KPI section
 * - Main content area (table/charts)
 * - Footer with metadata (computation time, row count)
 *
 * @see {@link file://./timeframe-picker.tsx}
 * @see {@link file://./kpi-grid.tsx}
 */

import type { ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Link } from "react-router";

import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

export interface ReportShellProps {
  /** Report title */
  title: string;
  /** Report description */
  description: string;
  /** Back link destination (default: /reports) */
  backTo?: string;
  /** Filter bar content (typically TimeframePicker + FilterBar) */
  filters?: ReactNode;
  /** KPI grid content */
  kpis?: ReactNode;
  /** Main content (table, charts) */
  children: ReactNode;
  /** Footer content (typically computation time) */
  footer?: ReactNode;
  /** Whether export is available (requires data) */
  exportable?: boolean;
  /** Export click handler */
  onExport?: () => void;
  /** Whether export is in progress */
  exporting?: boolean;
  /** Whether data is loading (shows subtle loading state) */
  loading?: boolean;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Report page layout shell.
 *
 * Structure:
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │ ← Reports                           [Export CSV] │
 * ├──────────────────────────────────────────────────┤
 * │ Title                                            │
 * │ Description                                      │
 * ├──────────────────────────────────────────────────┤
 * │ [Timeframe Picker] [Filters...]                  │
 * ├──────────────────────────────────────────────────┤
 * │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                 │
 * │ │ KPI │ │ KPI │ │ KPI │ │ KPI │                 │
 * │ └─────┘ └─────┘ └─────┘ └─────┘                 │
 * ├──────────────────────────────────────────────────┤
 * │                                                  │
 * │              Main Content                        │
 * │              (Table / Charts)                    │
 * │                                                  │
 * ├──────────────────────────────────────────────────┤
 * │ Showing 1-50 of 234 results    Computed in 42ms │
 * └──────────────────────────────────────────────────┘
 * ```
 */
export function ReportShell({
  title,
  description,
  backTo = "/reports",
  filters,
  kpis,
  children,
  footer,
  exportable = false,
  onExport,
  exporting = false,
  loading = false,
  className,
}: ReportShellProps) {
  return (
    <div className={tw("flex flex-col", className)}>
      {/* Header - matches app header pattern */}
      <header className="bg-white">
        {/* Navigation bar with export action */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 md:min-h-[54px]">
          <Link
            to={backTo}
            className={tw(
              "flex items-center gap-1.5 text-sm text-gray-600",
              "hover:text-gray-900",
              "rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            )}
          >
            <ArrowLeft className="size-4" />
            <span>Reports</span>
          </Link>

          {/* Export action - always visible, disabled when no data */}
          <button
            type="button"
            onClick={onExport}
            disabled={!exportable || exporting}
            className={tw(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
              "border border-gray-200 bg-white text-gray-700",
              "hover:bg-gray-50 hover:text-gray-900",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
            )}
            title={!exportable ? "No data to export" : undefined}
          >
            <Download className="size-4" />
            <span>{exporting ? "Exporting..." : "Export CSV"}</span>
          </button>
        </div>

        {/* Title section */}
        <div className="border-b border-gray-200 px-4 py-3">
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          <p className="mt-0.5 text-gray-500">{description}</p>
        </div>
      </header>

      {/* Filter bar */}
      {filters && (
        <div className="border-b border-gray-200 bg-white px-4 py-2">
          {filters}
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-auto bg-gray-50 p-4">
        {/* Loading indicator */}
        {loading && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
            <div className="animate-spin size-3 rounded-full border-2 border-gray-300 border-t-gray-600" />
            <span>Loading...</span>
          </div>
        )}

        {/* KPIs */}
        {kpis && (
          <div
            className={tw("mb-4 transition-opacity", loading && "opacity-60")}
          >
            {kpis}
          </div>
        )}

        {/* Content */}
        <div
          className={tw(
            "rounded border border-gray-200 bg-white transition-opacity",
            loading && "opacity-60"
          )}
        >
          {children}
        </div>
      </div>

      {/* Footer */}
      {footer && (
        <footer className="border-t border-gray-200 bg-white px-4 py-2">
          {footer}
        </footer>
      )}
    </div>
  );
}

/**
 * Report footer showing computation metadata and pagination.
 */
export function ReportFooter({
  computedMs,
  totalRows,
  page,
  pageSize,
  hideRowCount = false,
}: {
  computedMs: number;
  totalRows: number;
  page: number;
  pageSize: number;
  /** Hide row count for visualization-only reports (e.g., distribution) */
  hideRowCount?: boolean;
}) {
  const start = totalRows > 0 ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, totalRows);
  const totalPages = Math.ceil(totalRows / pageSize);
  const showPagination = totalPages > 1 && !hideRowCount;

  return (
    <div className="flex items-center justify-between text-xs text-gray-500">
      {hideRowCount ? (
        <span />
      ) : (
        <span>
          {totalRows === 0
            ? "No results for selected timeframe"
            : `Showing ${start}–${end} of ${totalRows.toLocaleString()} results`}
        </span>
      )}

      <div className="flex items-center gap-4">
        {showPagination && (
          <ReportPaginationInline page={page} totalPages={totalPages} />
        )}
        <span>Computed in {computedMs}ms</span>
      </div>
    </div>
  );
}

/**
 * Inline pagination controls for the footer.
 * Compact design to fit alongside metadata.
 */
function ReportPaginationInline({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => goToPage(page - 1)}
        disabled={!canGoPrev}
        className={tw(
          "flex size-6 items-center justify-center rounded border border-gray-200",
          "text-gray-500 transition-colors",
          "hover:bg-gray-50 hover:text-gray-700",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
        )}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-3.5" />
      </button>

      <span className="min-w-16 text-center text-xs tabular-nums">
        {page} / {totalPages}
      </span>

      <button
        type="button"
        onClick={() => goToPage(page + 1)}
        disabled={!canGoNext}
        className={tw(
          "flex size-6 items-center justify-center rounded border border-gray-200",
          "text-gray-500 transition-colors",
          "hover:bg-gray-50 hover:text-gray-700",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
        )}
        aria-label="Next page"
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

export default ReportShell;
