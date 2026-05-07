/**
 * @file CSV export hook for the reports route.
 *
 * Owns the click → fetch → blob → download → toast flow that powers the
 * "Export CSV" button in the report header. Lives in the reports folder
 * because the export endpoint and filename convention are
 * report-specific, but the surface is just `{ isExporting, handleExport }`
 * so the consuming component doesn't need to know about toasts, blobs,
 * or DOM mechanics.
 *
 * @see {@link file://./../../routes/_layout+/reports.export.$fileName[.csv].tsx}
 * @see {@link file://./report-export-actions.tsx}
 */

import { useCallback, useState } from "react";
import { useSetAtom } from "jotai";

import { showNotificationAtom } from "~/atoms/notifications";
import { useSearchParams } from "~/hooks/search-params";

/**
 * Returns a stable `handleExport` callback plus its loading state for
 * the report's "Export CSV" button.
 *
 * @param reportId - Current report's id (used for the filename and the
 *                   `reportId` query param on the export endpoint).
 * @param timeframePreset - Current timeframe preset (used for the
 *                          filename only).
 */
export function useCsvExport(reportId: string, timeframePreset: string) {
  const [isExporting, setIsExporting] = useState(false);
  const showNotification = useSetAtom(showNotificationAtom);
  const [searchParams] = useSearchParams();

  const handleExport = useCallback(async () => {
    setIsExporting(true);

    // Build export URL with current filters
    const exportParams = new URLSearchParams(searchParams);
    exportParams.set("reportId", reportId);

    // Generate filename based on report and timeframe
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `${reportId}-${timeframePreset}-${dateStr}.csv`;

    const exportUrl = `/reports/export/${fileName}?${exportParams.toString()}`;

    try {
      // Fetch the CSV
      const response = await fetch(exportUrl);

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Create blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Show success notification
      showNotification({
        title: "Export complete",
        message: `Downloaded ${fileName}`,
        icon: { name: "success", variant: "success" },
        senderId: null,
      });
    } catch (_error) {
      showNotification({
        title: "Export failed",
        message: "Unable to download the report. Please try again.",
        icon: { name: "trash", variant: "error" },
        senderId: null,
      });
    } finally {
      setIsExporting(false);
    }
  }, [reportId, timeframePreset, searchParams, showNotification]);

  return { isExporting, handleExport };
}
