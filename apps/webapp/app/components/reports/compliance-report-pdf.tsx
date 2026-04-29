/**
 * Compliance Report PDF Generator
 *
 * Client-side PDF generation using react-to-print.
 * Renders a styled A4 preview that converts to PDF via browser print.
 *
 * @see {@link file://../../routes/api+/reports.$reportId.generate-pdf.tsx}
 */

import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReactToPrint } from "react-to-print";

import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";
import type { CompliancePdfMeta } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

export interface ComplianceReportPdfProps {
  /** Report ID for API call */
  reportId: string;
  /** Current timeframe preset */
  timeframe: string;
  /** Custom from date (for custom timeframe) */
  customFrom?: string;
  /** Custom to date (for custom timeframe) */
  customTo?: string;
  /** Whether there's data to export */
  hasData: boolean;
}

/**
 * Button + Dialog for generating compliance report PDF.
 */
export function ComplianceReportPdf({
  reportId,
  timeframe,
  customFrom,
  customTo,
  hasData,
}: ComplianceReportPdfProps) {
  const componentRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pdfMeta, setPdfMeta] = useState<CompliancePdfMeta | null>(null);

  // Memoize so a new URLSearchParams reference doesn't refetch every render.
  const searchParams = useMemo(() => {
    const params = new URLSearchParams({ timeframe });
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
    return params;
  }, [timeframe, customFrom, customTo]);

  // Fetch via the shared hook so the underlying useEffect+fetch lives in one
  // dedicated place — mirrors the pattern in `audit-receipt-pdf.tsx`.
  const { error } = useApiQuery<{ pdfMeta?: CompliancePdfMeta }>({
    api: `/api/reports/${reportId}/generate-pdf`,
    searchParams,
    // Avoid refetching on re-renders once the preview data is cached.
    enabled: isDialogOpen && !pdfMeta,
    onSuccess: (responseData) => {
      setPdfMeta(responseData?.pdfMeta ?? null);
    },
    onError: () => {
      setPdfMeta(null);
    },
  });

  // Drop the cached meta on close so the next open refetches fresh data.
  useEffect(() => {
    if (!isDialogOpen) {
      setPdfMeta(null);
    }
  }, [isDialogOpen]);

  // Derive at render time instead of mirroring fetch state into useState.
  const isLoading = isDialogOpen && !pdfMeta && !error;

  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `${reportId}-${timeframe}-${
      new Date().toISOString().split("T")[0]
    }`,
  });

  const disabled = !hasData && {
    reason: "No data to export",
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setIsDialogOpen(true)}
        disabled={disabled}
        title={!hasData ? "No data to export" : "Generate PDF report"}
      >
        Export PDF
      </Button>

      <DialogPortal>
        <Dialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          className="h-[90vh] w-full py-0 md:h-[calc(100vh-4rem)] md:w-[90%]"
          title={
            <div className="mx-auto w-full max-w-[210mm] border-b p-4 text-center">
              <h3 className="text-lg font-semibold">
                Export Compliance Report
              </h3>
              <p className="text-sm text-gray-500">
                Preview and download as PDF
              </p>
              {!isLoading && !error && (
                <div className="mt-4">
                  <Button type="button" onClick={handlePrint}>
                    Download PDF
                  </Button>
                </div>
              )}
            </div>
          }
        >
          <div className="flex h-full flex-col px-6">
            <div className="grow overflow-auto">
              {isLoading ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <Spinner />
                  <p className="text-sm text-gray-500">Generating preview...</p>
                </div>
              ) : error ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              ) : (
                <ComplianceReportPreview
                  pdfMeta={pdfMeta}
                  componentRef={componentRef}
                />
              )}
            </div>
            <div className="flex justify-end gap-3 border-t py-4">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsDialogOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}

/**
 * A4-sized preview that renders to PDF.
 */
function ComplianceReportPreview({
  pdfMeta,
  componentRef,
}: {
  pdfMeta: CompliancePdfMeta | null;
  componentRef: RefObject<HTMLDivElement | null>;
}) {
  if (!pdfMeta) return null;

  return (
    <div className="border bg-gray-100 py-4">
      <style>
        {`@media print {
          @page {
            margin: 10mm;
            size: A4;
          }
          .pdf-wrapper {
            margin: 0;
            padding: 0;
          }
          .report-table {
            border-collapse: separate !important;
            border-spacing: 0 !important;
          }
          .report-table th,
          .report-table td {
            border-right: 1px solid #e5e7eb !important;
            border-bottom: 1px solid #e5e7eb !important;
          }
          .report-table thead th {
            border-top: 1px solid #e5e7eb !important;
          }
          .report-table th:first-child,
          .report-table td:first-child {
            border-left: 1px solid #e5e7eb !important;
          }
        }`}
      </style>

      <div
        className="pdf-wrapper mx-auto w-[200mm] bg-white p-[10mm] font-inter"
        ref={componentRef}
      >
        {/* Header */}
        <div className="mb-6 flex items-start justify-between border-b border-gray-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Image
                imageId={pdfMeta.organizationImageId}
                alt="Organization"
                className="size-6 rounded object-cover"
                updatedAt={pdfMeta.organizationUpdatedAt}
              />
              <span className="text-sm text-gray-600">
                {pdfMeta.organizationName}
              </span>
            </div>
            <h1 className="mt-1 text-xl font-semibold text-gray-900">
              {pdfMeta.reportTitle}
            </h1>
            <p className="text-sm text-gray-500">{pdfMeta.timeframeLabel}</p>
          </div>
          <div className="text-right text-xs text-gray-400">
            <p>Generated {pdfMeta.generatedAt}</p>
            <p>
              {pdfMeta.timeframeFrom} – {pdfMeta.timeframeTo}
            </p>
          </div>
        </div>

        {/* Summary Metrics */}
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Summary</h2>
          <div className="flex gap-6">
            <MetricBox
              label="Compliance Rate"
              value={`${pdfMeta.complianceRate}%`}
              highlight
            />
            <MetricBox label="On-time" value={pdfMeta.onTimeCount} />
            <MetricBox label="Late" value={pdfMeta.lateCount} />
            <MetricBox label="Total" value={pdfMeta.totalCount} />
            {pdfMeta.overdueCount > 0 && (
              <MetricBox
                label="Currently Overdue"
                value={pdfMeta.overdueCount}
                warning
              />
            )}
          </div>

          {/* Period comparison */}
          {pdfMeta.priorPeriod && pdfMeta.priorPeriod.delta !== 0 && (
            <p className="mt-2 text-xs text-gray-500">
              {pdfMeta.priorPeriod.delta > 0 ? "+" : ""}
              {pdfMeta.priorPeriod.delta}% vs {pdfMeta.priorPeriod.periodLabel}
            </p>
          )}
        </section>

        {/* Team Performance */}
        {pdfMeta.custodianPerformance.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">
              Team Member Performance
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="pb-2">Name</th>
                  <th className="pb-2 text-right">Rate</th>
                  <th className="pb-2 text-right">On-time</th>
                  <th className="pb-2 text-right">Late</th>
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pdfMeta.custodianPerformance.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5">{c.custodianName}</td>
                    <td className="py-1.5 text-right">{c.rate}%</td>
                    <td className="py-1.5 text-right">{c.onTime}</td>
                    <td className="py-1.5 text-right">{c.late}</td>
                    <td className="py-1.5 text-right">{c.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Bookings Table */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">
            Booking Details
            {pdfMeta.rows.length < pdfMeta.totalCount && (
              <span className="ml-2 font-normal text-gray-400">
                (showing {pdfMeta.rows.length.toLocaleString()} of{" "}
                {pdfMeta.totalCount.toLocaleString()})
              </span>
            )}
          </h2>
          {pdfMeta.rows.length < pdfMeta.totalCount && (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This PDF includes the first {pdfMeta.rows.length.toLocaleString()}{" "}
              bookings. For complete data, use the CSV export option which has
              no row limit.
            </p>
          )}
          <table className="report-table w-full border border-gray-200 text-xs">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border-b border-gray-200 p-2">Booking</th>
                <th className="border-b border-gray-200 p-2">Status</th>
                <th className="border-b border-gray-200 p-2">Custodian</th>
                <th className="border-b border-gray-200 p-2 text-right">
                  Assets
                </th>
                <th className="border-b border-gray-200 p-2">Start</th>
                <th className="border-b border-gray-200 p-2">End</th>
                <th className="border-b border-gray-200 p-2">Return Status</th>
              </tr>
            </thead>
            <tbody>
              {pdfMeta.rows.map((row) => (
                <tr key={row.bookingId}>
                  <td className="border-b border-gray-100 p-2">
                    {row.bookingName}
                  </td>
                  <td className="border-b border-gray-100 p-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="border-b border-gray-100 p-2">
                    {row.custodian || "—"}
                  </td>
                  <td className="border-b border-gray-100 p-2 text-right">
                    {row.assetCount}
                  </td>
                  <td className="border-b border-gray-100 p-2">
                    {row.scheduledStart}
                  </td>
                  <td className="border-b border-gray-100 p-2">
                    {row.scheduledEnd}
                  </td>
                  <td className="border-b border-gray-100 p-2">
                    <ReturnStatusBadge
                      returnStatus={row.returnStatus}
                      isOnTime={row.isOnTime}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Footer */}
        <div className="mt-8 border-t border-gray-200 pt-4 text-center text-xs text-gray-400">
          <p>
            Generated by Shelf · {pdfMeta.organizationName} ·{" "}
            {pdfMeta.generatedAt}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Metric display box for summary section.
 */
function MetricBox({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      className={tw(
        "flex-1 rounded border px-4 py-2 text-center",
        highlight && "border-gray-300 bg-gray-50",
        warning && "border-red-200 bg-red-50",
        !highlight && !warning && "border-gray-200"
      )}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={tw(
          "text-lg font-semibold",
          warning ? "text-red-700" : "text-gray-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Return status badge showing on-time or lateness.
 */
function ReturnStatusBadge({
  returnStatus,
  isOnTime,
}: {
  returnStatus: string;
  isOnTime: boolean;
}) {
  return (
    <span
      className={tw(
        "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
        isOnTime ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      )}
    >
      {returnStatus}
    </span>
  );
}

/**
 * Status badge for booking status.
 */
function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    RESERVED: "Reserved",
    ONGOING: "Ongoing",
    OVERDUE: "Overdue",
    COMPLETE: "Complete",
    CANCELLED: "Cancelled",
    ARCHIVED: "Archived",
  };

  // Use darker text colors for better WCAG AA contrast (4.5:1 minimum)
  const colors: Record<string, string> = {
    COMPLETE: "bg-green-100 text-green-800",
    OVERDUE: "bg-red-100 text-red-800",
    ONGOING: "bg-blue-100 text-blue-800",
    RESERVED: "bg-yellow-100 text-yellow-900",
  };

  return (
    <span
      className={tw(
        "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
        colors[status] || "bg-gray-100 text-gray-600"
      )}
    >
      {labels[status] || status}
    </span>
  );
}

export default ComplianceReportPdf;
