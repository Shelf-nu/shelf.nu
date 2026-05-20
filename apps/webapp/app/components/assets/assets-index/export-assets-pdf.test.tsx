/**
 * Suite A — Asset-Index PDF Export (component side).
 *
 * TDD RED STATE (commit 1): every test below calls a stub that throws,
 * so the suite is fully red. Implementation lands one green test at a
 * time via /goal once the §4.2 adequacy gate passes.
 *
 * Test IDs map 1:1 to PRD-asset-index-pdf-export.md §6.1 rows.
 * Each test logs its ID (per PRD §6.1 — the /goal evaluator reads the
 * transcript to count passes).
 *
 * @see PRD-asset-index-pdf-export.md §6.1
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AssetIndexPdf,
  ExportAssetsPdfButton,
  buildPdfFilename,
  selectVisibleColumns,
  summarizeFilters,
  type AssetIndexPdfProps,
  type PdfAssetRow,
  type PdfColumn,
  type RawColumnEntry,
} from "./export-assets-pdf";

/** Minimal valid props builder so each test can override what it cares about. */
function makeProps(overrides: Partial<AssetIndexPdfProps> = {}): AssetIndexPdfProps {
  const cols: PdfColumn[] = [
    { name: "id", position: 0, label: "ID" },
    { name: "status", position: 1, label: "Status" },
  ];
  const rows: PdfAssetRow[] = [
    { id: "asset-1", values: { id: "SAM-0001", status: "AVAILABLE" }, thumbnailUrl: null },
  ];
  return {
    branding: { workspaceName: "Test Workspace", workspaceLogoUrl: null },
    generatedAt: new Date("2026-05-20T10:00:00Z"),
    generatedBy: { displayName: "Test User" },
    filterSummary: "",
    columns: cols,
    rows,
    includeImages: false,
    totalRowCount: rows.length,
    ...overrides,
  };
}

describe("Suite A — Asset-Index PDF Export (component)", () => {
  describe("A1 — selectVisibleColumns (filter + sort)", () => {
    it("A1.a returns only visible:true entries, sorted by position ascending", () => {
      console.log("[A1.a] selectVisibleColumns filter+sort");
      const raw: RawColumnEntry[] = [
        { name: "a", visible: true, position: 2, label: "A" },
        { name: "b", visible: false, position: 1, label: "B" },
        { name: "c", visible: true, position: 0, label: "C" },
      ];
      const result = selectVisibleColumns(raw);
      expect(result.map((c) => c.name)).toEqual(["c", "a"]);
    });

    it("A1.b returns an empty array when all entries are visible:false", () => {
      console.log("[A1.b] selectVisibleColumns all-hidden");
      expect(
        selectVisibleColumns([
          { name: "a", visible: false, position: 0, label: "A" },
        ])
      ).toEqual([]);
    });
  });

  describe("A1b — component renders input column order verbatim (no reordering)", () => {
    it("A1b renders headers in input order without re-sorting", () => {
      console.log("[A1b] component renders input order verbatim");
      const props = makeProps({
        // deliberately non-sequential position; component must NOT re-sort
        columns: [
          { name: "c", position: 99, label: "ColC" },
          { name: "a", position: 0, label: "ColA" },
          { name: "b", position: 50, label: "ColB" },
        ],
      });
      render(<AssetIndexPdf {...props} />);
      const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
      expect(headers).toEqual(["ColC", "ColA", "ColB"]);
    });
  });

  describe("A2 — custom-field columns render + XSS guard", () => {
    it("A2.a renders custom-field headers and values from row.values[name]", () => {
      console.log("[A2.a] custom-field columns render");
      const props = makeProps({
        columns: [{ name: "cf_serial", position: 0, label: "Serial #" }],
        rows: [{ id: "x", values: { cf_serial: "SN-ABC-123" }, thumbnailUrl: null }],
      });
      render(<AssetIndexPdf {...props} />);
      expect(screen.getByText("Serial #")).toBeTruthy();
      expect(screen.getByText("SN-ABC-123")).toBeTruthy();
    });

    it("A2.b renders a malicious string as text, not HTML (XSS regression guard)", () => {
      console.log("[A2.b] XSS regression: value renders as text");
      const props = makeProps({
        columns: [{ name: "cf_note", position: 0, label: "Note" }],
        rows: [
          { id: "x", values: { cf_note: "<img src=x onerror=alert(1)>" }, thumbnailUrl: null },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      // React auto-escapes — the literal angle brackets should appear as text
      expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
      // and no actual <img> element should be injected
      expect(container.querySelectorAll("img").length).toBe(0);
    });
  });

  describe("A3 — thumbnail checkbox initial state mirrors AssetIndexSettings.showAssetImage", () => {
    it("A3.a starts unchecked when initialIncludeImages=false", () => {
      console.log("[A3.a] thumbnail toggle initial=false");
      render(<ExportAssetsPdfButton disabled={false} initialIncludeImages={false} />);
      const cb = screen.getByRole("checkbox", { name: /include.*image/i });
      expect((cb as HTMLInputElement).checked).toBe(false);
    });

    it("A3.b starts checked when initialIncludeImages=true", () => {
      console.log("[A3.b] thumbnail toggle initial=true");
      render(<ExportAssetsPdfButton disabled={false} initialIncludeImages={true} />);
      const cb = screen.getByRole("checkbox", { name: /include.*image/i });
      expect((cb as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("A4 — thumbnails conditional render", () => {
    it("A4.a renders an <img> per row when includeImages=true and thumbnailUrl is set", () => {
      console.log("[A4.a] includeImages=true renders images");
      const props = makeProps({
        includeImages: true,
        rows: [
          { id: "1", values: { id: "1" }, thumbnailUrl: "https://example.test/a.webp" },
          { id: "2", values: { id: "2" }, thumbnailUrl: "https://example.test/b.webp" },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
    });

    it("A4.b renders zero <img> when includeImages=false", () => {
      console.log("[A4.b] includeImages=false renders no images");
      const props = makeProps({
        includeImages: false,
        rows: [
          { id: "1", values: { id: "1" }, thumbnailUrl: "https://example.test/a.webp" },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.querySelectorAll("img").length).toBe(0);
    });
  });

  describe("A5 — filter summary line", () => {
    it("A5.a summarises filters from URL search params", () => {
      console.log("[A5.a] summarizeFilters with filters");
      const sp = new URLSearchParams("location=Warehouse+1&tag=drill");
      const summary = summarizeFilters(sp);
      expect(summary).toMatch(/Warehouse 1/);
      expect(summary).toMatch(/drill/);
    });

    it("A5.b returns empty string when no filters", () => {
      console.log("[A5.b] summarizeFilters empty");
      expect(summarizeFilters(new URLSearchParams())).toBe("");
    });
  });

  describe("A6 — footer metadata", () => {
    it("A6 footer contains generatedAt, generatedBy, and totalRowCount", () => {
      console.log("[A6] footer metadata present");
      const props = makeProps({
        generatedAt: new Date("2026-05-20T14:22:07Z"),
        generatedBy: { displayName: "Maria López" },
        totalRowCount: 42,
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.textContent).toContain("Maria López");
      expect(container.textContent).toMatch(/42/);
      // formatted date should appear (year is a stable proxy)
      expect(container.textContent).toContain("2026");
    });
  });

  describe("A7 — print-CSS + page-break structure", () => {
    it("A7.a uses a native <thead> element so headers repeat per print page", () => {
      console.log("[A7.a] native <thead> present");
      const { container } = render(<AssetIndexPdf {...makeProps()} />);
      expect(container.querySelectorAll("thead").length).toBeGreaterThan(0);
    });

    it("A7.b rows carry a break-inside-avoid class", () => {
      console.log("[A7.b] break-inside-avoid on rows");
      const props = makeProps({
        rows: Array.from({ length: 5 }, (_, i) => ({
          id: `row-${i}`,
          values: { id: `SAM-${i}` },
          thumbnailUrl: null,
        })),
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      const rows = container.querySelectorAll("tbody tr");
      expect(rows.length).toBe(5);
      // Tailwind utility (or equivalent) on each row
      for (const row of Array.from(rows)) {
        expect(row.className).toMatch(/break-inside-avoid/);
      }
    });
  });

  // A8 (large-selection truncation) REMOVED in v0.4 per PRD §14 Q2
  // (CTO answer 2026-05-20). There is no row cap — matching the
  // existing booking-overview-pdf.tsx and audit-receipt-pdf.tsx,
  // which also have zero MAX/limit/truncate.

  describe("A9 — filename sanitization", () => {
    it("A9.a builds a sanitised filename containing the workspace slug and ISO date", () => {
      console.log("[A9.a] valid name");
      const fn = buildPdfFilename("Acme Inc.", new Date("2026-05-20T00:00:00Z"));
      expect(fn).toMatch(/2026-05-20/);
      expect(fn.endsWith(".pdf")).toBe(true);
    });

    it("A9.b strips path-traversal + special characters from workspace name", () => {
      console.log("[A9.b] special chars stripped");
      const fn = buildPdfFilename("../etc/passwd Acme™ 🚀", new Date("2026-01-01T00:00:00Z"));
      expect(fn).not.toContain("/");
      expect(fn).not.toContain("..");
      expect(fn).not.toContain("\\");
    });
  });
});
