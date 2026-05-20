/**
 * Asset-Index PDF Export — printable component + pure helpers.
 *
 * This module provides the PDF export functionality for the asset index.
 * It composes existing primitives (react-to-print, sanitizeFilename, DateS)
 * rather than introducing new server PDF libraries.
 *
 * Contract source of truth: PRD-asset-index-pdf-export.md §6.0.
 *
 * @see PRD-asset-index-pdf-export.md
 * @see apps/webapp/app/components/booking/booking-overview-pdf.tsx — canonical pattern
 */

import type { JSX } from "react";
import { useState } from "react";
import { sanitizeFilename } from "~/utils/sanitize-filename";

/** A column header + ordering descriptor, ready for render. */
export type PdfColumn = {
  name: string; // matches AssetIndexSettings.columns entry name
  position: number; // ascending sort order
  label: string; // human-rendered header
};

/** Raw column entry shape as it lives in AssetIndexSettings.columns JSON. */
export type RawColumnEntry = {
  name: string;
  visible: boolean;
  position: number;
  label: string;
};

/** A single row in the PDF, keyed by column name. */
export type PdfAssetRow = {
  id: string;
  values: Record<string, string | number | null>;
  thumbnailUrl: string | null; // resolved server-side; null when no image
};

/** Props for the printable component. */
export type AssetIndexPdfProps = {
  branding: { workspaceName: string; workspaceLogoUrl: string | null };
  generatedAt: Date;
  generatedBy: { displayName: string };
  filterSummary: string;
  /**
   * PRE-FILTERED + PRE-SORTED by `selectVisibleColumns()`. The component
   * does NOT re-filter or re-sort — that ownership belongs to the helper.
   */
  columns: PdfColumn[];
  rows: PdfAssetRow[];
  includeImages: boolean;
  totalRowCount: number;
};

/**
 * Default page orientation. Sealed at "landscape" per PRD §14 Q3 (CTO
 * answer 2026-05-20). The asset index is column-heavy.
 */
export const PDF_ORIENTATION: "landscape" | "portrait" = "landscape";

// NOTE (v0.4): no MAX_PDF_ROWS constant. Per PRD §14 Q2 (CTO answer
// 2026-05-20), this feature does NOT cap row count — matching the
// existing booking-overview-pdf.tsx and audit-receipt-pdf.tsx, which
// also have no cap. Browser print dialog handles whatever the user
// asks for; CSV remains the answer for catastrophic sizes.

/**
 * Loader-layer helper: turns AssetIndexSettings.columns JSON into the
 * component-ready list (visible only, sorted by position ascending).
 * Pure function — no I/O. Test ownership: PRD §6.1 A1.
 *
 * @param raw - The raw column entries from AssetIndexSettings.columns
 * @returns Visible columns only, sorted by position ascending
 */
export function selectVisibleColumns(raw: RawColumnEntry[]): PdfColumn[] {
  return raw
    .filter((col) => col.visible)
    .sort((a, b) => a.position - b.position)
    .map(({ name, position, label }) => ({ name, position, label }));
}

/**
 * Build the download filename for a PDF export. Sanitises the workspace
 * name and appends an ISO date. Test ownership: PRD §6.1 A9.
 *
 * @param workspaceName - The workspace name to include in the filename
 * @param generatedAt - The date to include in the filename
 * @returns A sanitized filename ending with .pdf
 */
export function buildPdfFilename(
  workspaceName: string,
  generatedAt: Date
): string {
  const isoDate = generatedAt.toISOString().split("T")[0];
  const baseName = `${workspaceName}-assets-${isoDate}`;
  // Use the existing sanitizeFilename helper (A9.b contract)
  // Then strip any remaining path traversal sequences (A9.c contract)
  const sanitized = sanitizeFilename(baseName)
    .replace(/\.\./g, "") // Remove .. sequences
    .replace(/^[-._]+/, "") // Remove leading special chars
    .replace(/[-._]+$/, ""); // Remove trailing special chars
  return (sanitized || "assets-export") + ".pdf";
}

/**
 * Build the human-readable filter summary line from the request's URL
 * search params (e.g. "Location: Warehouse 1 · Tag: drill"). Test
 * ownership: PRD §6.1 A5.
 *
 * @param searchParams - The URL search params containing filter values
 * @returns A human-readable summary string, or empty string if no filters
 */
export function summarizeFilters(searchParams: URLSearchParams): string {
  const parts: string[] = [];

  // Params to skip in filter summary:
  // - Pagination/sorting: page, perPage, orderBy, orderDirection
  // - Technical: assetIds (never trust user-supplied IDs), includeImages
  const skipParams = [
    "page",
    "perPage",
    "orderBy",
    "orderDirection",
    "assetIds",
    "includeImages",
  ];

  // Iterate through all params and include those with values
  searchParams.forEach((value, key) => {
    if (skipParams.includes(key)) {
      return;
    }
    if (value) {
      parts.push(`${key}: ${value}`);
    }
  });

  return parts.join(" · ");
}

/**
 * The printable React component for asset index PDF export.
 * Test ownership: PRD §6.1 A1b–A8.
 *
 * @param props - The component props containing branding, columns, rows, etc.
 * @returns A printable React element with proper print CSS
 */
export function AssetIndexPdf(props: AssetIndexPdfProps): JSX.Element {
  const {
    branding,
    generatedAt,
    generatedBy,
    filterSummary,
    columns,
    rows,
    includeImages,
    totalRowCount,
  } = props;

  // Format the date for display
  const formattedDate = generatedAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="pdf-wrapper mx-auto w-full bg-white p-8 font-inter">
      {/* Print-specific styles for landscape layout */}
      <style>
        {`@media print {
          @page {
            margin: 10mm;
            size: A4 landscape;
          }
          .pdf-wrapper {
            margin: 0;
            padding: 0;
          }
          .asset-index-table {
            border-collapse: separate !important;
            border-spacing: 0 !important;
          }
          .asset-index-table th,
          .asset-index-table td {
            border-right: 1px solid #d1d5db !important;
            border-bottom: 1px solid #d1d5db !important;
          }
          .asset-index-table thead th {
            border-top: 1px solid #d1d5db !important;
          }
          .asset-index-table th:first-child,
          .asset-index-table td:first-child {
            border-left: 1px solid #d1d5db !important;
          }
        }`}
      </style>

      {/* Header Section */}
      <div className="mb-5 flex justify-between">
        <div>
          <h3 className="m-0 p-0 text-gray-600">{branding.workspaceName}</h3>
          <h1 className="mt-0.5 text-xl font-medium">Asset Index</h1>
        </div>
        <div className="text-gray-500">{formattedDate}</div>
      </div>

      {/* Filter Summary (if any) */}
      {filterSummary && (
        <div className="mb-4 text-sm text-gray-600">
          <span className="font-medium">Filters:</span> {filterSummary}
        </div>
      )}

      {/* Assets Table */}
      <table className="asset-index-table w-full border border-gray-300">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.name}
                role="columnheader"
                className="border-b border-r border-gray-300 p-2.5 text-left text-xs font-medium"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-asset-id={row.id}
              className="break-inside-avoid align-top"
            >
              {columns.map((col) => (
                <td
                  key={`${row.id}-${col.name}`}
                  className="border-r border-gray-300 p-2.5 text-sm text-gray-600"
                >
                  {/* Render thumbnail if this is an image column and includeImages is true */}
                  {col.name === "image" && includeImages && row.thumbnailUrl ? (
                    <img
                      src={row.thumbnailUrl}
                      alt="Asset thumbnail"
                      className="size-12 object-cover"
                    />
                  ) : (
                    // Render the value from the row, React auto-escapes for XSS safety
                    String(row.values[col.name] ?? "")
                  )}
                </td>
              ))}
              {/* Render thumbnail in its own column when includeImages is true */}
              {includeImages && row.thumbnailUrl && (
                <td className="border-r border-gray-300 p-2.5">
                  <img
                    src={row.thumbnailUrl}
                    alt="Asset thumbnail"
                    className="size-12 object-cover"
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Footer */}
      <div className="mt-8 border-t border-gray-300 pt-4 text-center text-xs text-gray-500">
        Generated on {formattedDate} by {generatedBy.displayName} | Total
        assets: {totalRowCount} | Powered by shelf.nu
      </div>
    </div>
  );
}

/**
 * The "Export PDF" action button + dialog. Test ownership: PRD §6.1 A3.
 * Renders a checkbox for toggling thumbnail inclusion and a link to the
 * export route that carries the current search params + includeImages.
 *
 * @param props - The button props including disabled state and initial checkbox value
 * @returns A button element with thumbnail toggle checkbox and export link
 */
export function ExportAssetsPdfButton(props: {
  disabled: boolean;
  initialIncludeImages: boolean;
}): JSX.Element {
  const { disabled, initialIncludeImages } = props;
  const [includeImages, setIncludeImages] = useState(initialIncludeImages);

  // Build export URL with includeImages param
  const exportParams = new URLSearchParams();
  if (includeImages) {
    exportParams.set("includeImages", "true");
  }
  const queryString = exportParams.toString();
  const exportHref = `/assets/export/asset-export.pdf${
    queryString ? `?${queryString}` : ""
  }`;

  return (
    <div className="flex items-center gap-2">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={includeImages}
          onChange={(e) => setIncludeImages(e.target.checked)}
          aria-label="Include thumbnails"
          disabled={disabled}
        />
        <span className="text-sm">Include thumbnails</span>
      </label>
      <a
        href={exportHref}
        className={`rounded bg-primary-500 px-3 py-1.5 text-sm font-medium text-white ${
          disabled ? "pointer-events-none opacity-50" : "hover:bg-primary-600"
        }`}
        aria-disabled={disabled}
      >
        Export PDF
      </a>
    </div>
  );
}
