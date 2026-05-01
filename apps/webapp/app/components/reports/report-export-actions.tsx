/**
 * @file Report header export actions.
 *
 * Renders the right-aligned cluster of export buttons inside the report
 * page's `<Header>`: a PDF button (only for the three reports we ship a
 * PDF for) and a CSV button. Pure presentational — the consuming route
 * supplies an `onCsvExport` callback (see {@link file://./use-csv-export.ts}).
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 */

import { Button } from "~/components/shared/button";
import type { ResolvedTimeframe } from "~/modules/reports/types";

import { ReportPdf } from "./report-pdf";

/** Reports with a PDF export available. */
const REPORTS_WITH_PDF = [
  "booking-compliance",
  "asset-inventory",
  "custody-snapshot",
];

/** Props for {@link ReportExportActions}. */
type Props = {
  /** Current report id (drives whether the PDF button shows). */
  reportId: string;
  /** Resolved timeframe — passed through to the PDF route as query
   *  params for custom ranges. */
  timeframe: ResolvedTimeframe;
  /** Whether the report returned any data; both buttons disable when
   *  there is nothing to export. */
  hasData: boolean;
  /** Whether the CSV download is in flight (controlled by the
   *  consuming route via `useCsvExport`). */
  isExporting: boolean;
  /** Click handler for the CSV button. */
  onCsvExport: () => void;
};

/**
 * Header action cluster: PDF (conditional) + CSV.
 */
export function ReportExportActions({
  reportId,
  timeframe,
  hasData,
  isExporting,
  onCsvExport,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      {/* PDF Export — primary for B2B (booking-compliance, asset-inventory,
          custody-snapshot). Other reports rely on CSV only. */}
      {REPORTS_WITH_PDF.includes(reportId) && (
        <ReportPdf
          reportId={reportId}
          timeframe={timeframe.preset}
          customFrom={
            timeframe.preset === "custom"
              ? timeframe.from.toISOString()
              : undefined
          }
          customTo={
            timeframe.preset === "custom"
              ? timeframe.to.toISOString()
              : undefined
          }
          hasData={hasData}
        />
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={onCsvExport}
        disabled={!hasData || isExporting}
        title={!hasData ? "No data to export" : "Export report as CSV"}
      >
        {isExporting ? "Exporting..." : "Export CSV"}
      </Button>
    </div>
  );
}
