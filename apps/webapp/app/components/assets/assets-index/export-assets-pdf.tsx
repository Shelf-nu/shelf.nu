/**
 * Asset-Index PDF Export — printable component + pure helpers.
 *
 * TDD RED STATE (commit 1): every export is a stub that throws "not
 * implemented" so the committed test suite fails for the *right reason*
 * (per PRD §4.2 adequacy gate). Implementation lands one green test at
 * a time via /goal once the gate passes and §14 open questions are
 * answered. Do not implement here until §4.2 review is complete.
 *
 * Contract source of truth: PRD-asset-index-pdf-export.md §6.0.
 *
 * @see PRD-asset-index-pdf-export.md
 */

import type { JSX } from "react";

/** A column header + ordering descriptor, ready for render. */
export type PdfColumn = {
  name: string;      // matches AssetIndexSettings.columns entry name
  position: number;  // ascending sort order
  label: string;     // human-rendered header
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
  thumbnailUrl: string | null;  // resolved server-side; null when no image
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

/** Hard cap on rows in a single PDF export (PRD §14 Q2 — suggested value). */
export const MAX_PDF_ROWS = 500;

/** Default page orientation (PRD §14 Q3 — suggested value). */
export const PDF_ORIENTATION: "landscape" | "portrait" = "landscape";

/**
 * Loader-layer helper: turns AssetIndexSettings.columns JSON into the
 * component-ready list (visible only, sorted by position ascending).
 * Pure function — no I/O. Test ownership: PRD §6.1 A1.
 */
export function selectVisibleColumns(_raw: RawColumnEntry[]): PdfColumn[] {
  throw new Error(
    "selectVisibleColumns: not implemented (TDD red — see PRD §6.1 A1)"
  );
}

/**
 * Build the download filename for a PDF export. Sanitises the workspace
 * name and appends an ISO date. Test ownership: PRD §6.1 A9.
 */
export function buildPdfFilename(
  _workspaceName: string,
  _generatedAt: Date
): string {
  throw new Error(
    "buildPdfFilename: not implemented (TDD red — see PRD §6.1 A9)"
  );
}

/**
 * Build the human-readable filter summary line from the request's URL
 * search params (e.g. "Location: Warehouse 1 · Tag: drill"). Test
 * ownership: PRD §6.1 A5.
 */
export function summarizeFilters(_searchParams: URLSearchParams): string {
  throw new Error(
    "summarizeFilters: not implemented (TDD red — see PRD §6.1 A5)"
  );
}

/** The printable React component. Test ownership: PRD §6.1 A1b–A8. */
export function AssetIndexPdf(_props: AssetIndexPdfProps): JSX.Element {
  throw new Error(
    "AssetIndexPdf: not implemented (TDD red — see PRD §6.1 A1b–A8)"
  );
}

/** The "Export PDF" action button + dialog. Test ownership: PRD §6.1 A3. */
export function ExportAssetsPdfButton(_props: {
  disabled: boolean;
  initialIncludeImages: boolean;
}): JSX.Element {
  throw new Error(
    "ExportAssetsPdfButton: not implemented (TDD red — see PRD §6.1 A3)"
  );
}
