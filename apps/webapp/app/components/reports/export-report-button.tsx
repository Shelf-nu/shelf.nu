/**
 * Export Report Button Component
 *
 * Triggers CSV export for the current report view. Follows the same pattern
 * as ExportAssetsButton but adapted for reports.
 *
 * @see {@link file://../../routes/_layout+/reports.export.$fileName[.csv].tsx}
 */

import { useCallback, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

export interface ExportReportButtonProps {
  /** Report ID to export */
  reportId: string;
  /** Report title for the filename */
  reportTitle: string;
  /** Whether export is available */
  disabled?: boolean;
  /** Button variant */
  variant?: "primary" | "secondary";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Export button that downloads the current report as CSV.
 *
 * The export endpoint receives:
 * - reportId: which report to export
 * - All current search params (timeframe, filters)
 *
 * File is named: `{report-title}-{date}.csv`
 */
export function ExportReportButton({
  reportId,
  reportTitle,
  disabled = false,
  variant = "secondary",
  className,
}: ExportReportButtonProps) {
  const [searchParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (disabled || exporting) return;

    setExporting(true);

    try {
      // Build the export URL with current filters
      const date = new Date().toISOString().split("T")[0];
      const filename = `${reportTitle
        .toLowerCase()
        .replace(/\s+/g, "-")}-${date}.csv`;

      const exportParams = new URLSearchParams(searchParams);
      exportParams.set("reportId", reportId);

      const exportUrl = `/reports/export/${filename}?${exportParams.toString()}`;

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
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (_error) {
      // Error handling: could show a toast notification
    } finally {
      setExporting(false);
    }
  }, [disabled, exporting, reportId, reportTitle, searchParams]);

  return (
    <Button
      type="button"
      variant={variant}
      onClick={handleExport}
      disabled={disabled || exporting}
      className={tw("flex items-center gap-1.5", className)}
    >
      <Download className="size-4" />
      <span className="hidden sm:inline">
        {exporting ? "Exporting..." : "Export CSV"}
      </span>
    </Button>
  );
}

export default ExportReportButton;
