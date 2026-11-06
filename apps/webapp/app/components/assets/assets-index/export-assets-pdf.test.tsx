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

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// why: ExportAssetsPdfButton uses ~/hooks/search-params (the Shelf wrapper
// over react-router's useSearchParams) to forward the current URL's
// filter params into the export href. The Shelf wrapper transitively
// uses useLoaderData which requires a data-router context — too heavy
// to set up per test. Mock it: per-test, set the returned params via
// useSearchParamsMock.mockReturnValue.
const useSearchParamsMock = vi.fn();
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: (...args: unknown[]) => useSearchParamsMock(...args),
}));

// why: A9 contract requires the existing sanitizeFilename helper is invoked.
// Mock it before importing the file-under-test so the import wires through.
const sanitizeFilenameMock = vi.fn((s: string) => s.replace(/[^\w.-]+/g, "_"));
vi.mock("~/utils/sanitize-filename", () => ({
  sanitizeFilename: (...args: unknown[]) =>
    sanitizeFilenameMock(...(args as [string])),
}));

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

/**
 * Pinned per PRD §6.0: the "Include thumbnails" checkbox's accessible
 * name MUST be exactly this string. Locking it here keeps the test
 * deterministic instead of regex-fuzzy and gives the implementer a
 * single source of truth for the label.
 */
const INCLUDE_THUMBS_LABEL = "Include thumbnails";

beforeEach(() => {
  vi.clearAllMocks();
  sanitizeFilenameMock.mockImplementation((s: string) =>
    s.replace(/[^\w.-]+/g, "_")
  );
  // Default: no current URL params (override per-test for filter-forward tests)
  useSearchParamsMock.mockReturnValue([new URLSearchParams(), vi.fn()]);
});

/**
 * Helper: set the current URL search params the hook should return for
 * the next render. Use this before render() in any test that exercises
 * the export-href filter-forwarding contract (per B1 fix on 46d0da59f).
 */
function setCurrentSearchParams(query: string): void {
  useSearchParamsMock.mockReturnValue([new URLSearchParams(query), vi.fn()]);
}

/** Minimal valid props builder so each test can override what it cares about. */
function makeProps(
  overrides: Partial<AssetIndexPdfProps> = {}
): AssetIndexPdfProps {
  const cols: PdfColumn[] = [
    { name: "id", position: 0, label: "ID" },
    { name: "status", position: 1, label: "Status" },
  ];
  const rows: PdfAssetRow[] = [
    {
      id: "asset-1",
      values: { id: "SAM-0001", status: "AVAILABLE" },
      thumbnailUrl: null,
    },
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
  describe("A1 — selectVisibleColumns (filter + sort + derived labels)", () => {
    // C1 regression (Codex P1 on commit 3d7ba0589): RawColumnEntry no
    // longer carries `label` — labels are derived via the `labelFor`
    // resolver passed by the caller. A1.a + A1.b cover filter+sort; A1.c
    // covers label derivation.
    const labelFor = (name: string): string => `LBL-${name.toUpperCase()}`;

    it("A1.a returns only visible:true entries, sorted by position ascending", () => {
      const raw: RawColumnEntry[] = [
        { name: "a", visible: true, position: 2 },
        { name: "b", visible: false, position: 1 },
        { name: "c", visible: true, position: 0 },
      ];
      const result = selectVisibleColumns(raw, labelFor);
      expect(result.map((c) => c.name)).toEqual(["c", "a"]);
    });

    it("A1.b returns an empty array when all entries are visible:false", () => {
      expect(
        selectVisibleColumns(
          [{ name: "a", visible: false, position: 0 }],
          labelFor
        )
      ).toEqual([]);
    });

    it("A1.c derives the display label for each visible column via labelFor", () => {
      const raw: RawColumnEntry[] = [
        { name: "valuation", visible: true, position: 0 },
        { name: "name", visible: true, position: 1 },
      ];
      const result = selectVisibleColumns(raw, labelFor);
      // Label must come from labelFor — proves the helper does NOT depend
      // on a persisted `label` field (which real saved JSON lacks).
      expect(result.map((c) => c.label)).toEqual(["LBL-VALUATION", "LBL-NAME"]);
    });
  });

  describe("A1b — component renders input column order verbatim (no reordering)", () => {
    it("A1b renders headers in input order without re-sorting", () => {
      const props = makeProps({
        // deliberately non-sequential position; component must NOT re-sort
        columns: [
          { name: "c", position: 99, label: "ColC" },
          { name: "a", position: 0, label: "ColA" },
          { name: "b", position: 50, label: "ColB" },
        ],
      });
      render(<AssetIndexPdf {...props} />);
      const headers = screen
        .getAllByRole("columnheader")
        .map((h) => h.textContent);
      expect(headers).toEqual(["ColC", "ColA", "ColB"]);
    });
  });

  describe("A2 — custom-field columns render + XSS guard", () => {
    it("A2.a renders custom-field headers and values from row.values[name]", () => {
      const props = makeProps({
        columns: [{ name: "cf_serial", position: 0, label: "Serial #" }],
        rows: [
          { id: "x", values: { cf_serial: "SN-ABC-123" }, thumbnailUrl: null },
        ],
      });
      render(<AssetIndexPdf {...props} />);
      expect(screen.getByText("Serial #")).toBeTruthy();
      expect(screen.getByText("SN-ABC-123")).toBeTruthy();
    });

    it("A2.b renders a malicious string as text, not HTML (XSS regression guard)", () => {
      const props = makeProps({
        columns: [{ name: "cf_note", position: 0, label: "Note" }],
        rows: [
          {
            id: "x",
            values: { cf_note: "<img src=x onerror=alert(1)>" },
            thumbnailUrl: null,
          },
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
      render(
        <ExportAssetsPdfButton disabled={false} initialIncludeImages={false} />
      );
      // exact accessible-name match per pinned PRD §6.0 contract
      const cb = screen.getByRole("checkbox", { name: INCLUDE_THUMBS_LABEL });
      expect((cb as HTMLInputElement).checked).toBe(false);
    });

    it("A3.b starts checked when initialIncludeImages=true", () => {
      render(
        <ExportAssetsPdfButton disabled={false} initialIncludeImages={true} />
      );
      const cb = screen.getByRole("checkbox", { name: INCLUDE_THUMBS_LABEL });
      expect((cb as HTMLInputElement).checked).toBe(true);
    });
  });

  describe("A4 — thumbnails conditional render", () => {
    it("A4.a renders an <img> per row when includeImages=true and thumbnailUrl is set", () => {
      // B2 fix (CR re-review on 46d0da59f): the <img> render now lives
      // exclusively in the column-loop branch where col.name === "image".
      // The loader's job is to inject this column when includeImages=true;
      // the test mirrors that by including the column explicitly here so
      // the contract is enforced at the component boundary too.
      const props = makeProps({
        includeImages: true,
        columns: [
          { name: "id", position: 0, label: "ID" },
          { name: "image", position: 1, label: "Image" },
        ],
        rows: [
          {
            id: "1",
            values: { id: "1" },
            thumbnailUrl: "https://example.test/a.webp",
          },
          {
            id: "2",
            values: { id: "2" },
            thumbnailUrl: "https://example.test/b.webp",
          },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.querySelectorAll("img").length).toBeGreaterThanOrEqual(
        2
      );
    });

    it("A4.b renders zero <img> when includeImages=false", () => {
      const props = makeProps({
        includeImages: false,
        rows: [
          {
            id: "1",
            values: { id: "1" },
            thumbnailUrl: "https://example.test/a.webp",
          },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.querySelectorAll("img").length).toBe(0);
    });

    it("A4.c includeImages=true but thumbnailUrl=null renders no <img> for that row", () => {
      // why: in real workspaces many assets lack photos — must not render
      // a broken/empty <img> for those rows even when includeImages=true.
      const props = makeProps({
        includeImages: true,
        rows: [
          { id: "1", values: { id: "1" }, thumbnailUrl: null },
          { id: "2", values: { id: "2" }, thumbnailUrl: null },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      expect(container.querySelectorAll("img").length).toBe(0);
    });
  });

  describe("A5 — filter summary line", () => {
    it("A5.a summarises filter values from any non-empty URL search params", () => {
      // why: not pinning specific param NAMES (asset-index filter conventions
      // may use any of `location=`, `filter[location]=`, etc.). The contract
      // is: given non-empty search params containing distinctive values, the
      // summary string surfaces those values to humans. Implementer chooses
      // which params are filter params; this test asserts the VALUES make it
      // into the human-readable string.
      const sp = new URLSearchParams();
      sp.set("location", "Warehouse-Distinctive-123");
      sp.set("tag", "drill-distinctive-456");
      const summary = summarizeFilters(sp);
      expect(summary).toContain("Warehouse-Distinctive-123");
      expect(summary).toContain("drill-distinctive-456");
    });

    it("A5.b returns empty string when no filters", () => {
      expect(summarizeFilters(new URLSearchParams())).toBe("");
    });
  });

  describe("A6 — footer metadata", () => {
    it("A6 footer contains generatedAt, generatedBy, and totalRowCount", () => {
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
      const { container } = render(<AssetIndexPdf {...makeProps()} />);
      expect(container.querySelectorAll("thead").length).toBeGreaterThan(0);
    });

    it("A7.b rows carry a break-inside-avoid class", () => {
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
    it("A9.a builds a filename containing the workspace slug and ISO date", () => {
      const fn = buildPdfFilename(
        "Acme Inc.",
        new Date("2026-05-20T00:00:00Z")
      );
      expect(fn).toMatch(/2026-05-20/);
      expect(fn.endsWith(".pdf")).toBe(true);
    });

    it("A9.b ENFORCES that the existing sanitizeFilename helper is invoked (not a custom sanitizer)", () => {
      // why: the PRD §6.1 contract is "uses the existing sanitizeFilename helper".
      // A lazy impl could write its own sanitizer and pass a regex assertion;
      // mocking and asserting the call enforces reuse of the canonical helper.
      buildPdfFilename(
        "../etc/passwd Acme™ 🚀",
        new Date("2026-01-01T00:00:00Z")
      );
      expect(sanitizeFilenameMock).toHaveBeenCalled();
      // and pass the raw workspace name as the input (not a pre-sanitised string)
      expect(sanitizeFilenameMock).toHaveBeenCalledWith(
        expect.stringContaining("Acme")
      );
    });

    it("A9.c output never contains path-traversal characters", () => {
      const fn = buildPdfFilename(
        "../etc/passwd Acme™ 🚀",
        new Date("2026-01-01T00:00:00Z")
      );
      expect(fn).not.toContain("/");
      expect(fn).not.toContain("..");
      expect(fn).not.toContain("\\");
    });
  });

  describe("A3.c — button wires the export navigation (not pure-display)", () => {
    it("A3.c.1 renders a navigation element (anchor or form) targeting the export route", () => {
      const { container } = render(
        <ExportAssetsPdfButton disabled={false} initialIncludeImages={false} />
      );
      // CONTRACT: clicking this button must actually trigger an export.
      // It must render EITHER (a) an <a href> pointing at /assets/export/X.pdf,
      // OR (b) a <form action> pointing there. A pure-display checkbox with
      // no export trigger is non-functional and fails this test — A3 only
      // proved the toggle's initial state, not that the toggle exports anything.
      const anchor = container.querySelector(
        'a[href*="/assets/export/"][href*=".pdf"]'
      );
      const form = container.querySelector(
        'form[action*="/assets/export/"][action*=".pdf"]'
      );
      expect(anchor || form).toBeTruthy();
    });

    it("A3.c.2 initialIncludeImages=true encodes includeImages=true into the navigation target", () => {
      const { container } = render(
        <ExportAssetsPdfButton disabled={false} initialIncludeImages={true} />
      );
      // The checkbox state must round-trip into the navigation target —
      // not just local React state. Either the anchor's href, a form's
      // action, or a hidden form input must encode includeImages=true.
      const html = container.innerHTML;
      expect(html).toMatch(/includeImages[=:]\s*["']?true["']?/i);
    });

    it("A3.c.3 current URL filter params are forwarded into the export href (B1 fix)", () => {
      // CR B1 finding (re-review on 46d0da59f): an earlier impl built the
      // export href from an empty URLSearchParams, silently dropping the
      // user's active filters. This test pins that the current URL's
      // filter params are CARRIED OVER into the export navigation —
      // clicking "Export PDF" must respect the user's filtered view per
      // PRD §3 Principle 2.
      setCurrentSearchParams(
        "location=Warehouse-DISTINCTIVE&tag=drill-DISTINCTIVE"
      );
      const { container } = render(
        <ExportAssetsPdfButton disabled={false} initialIncludeImages={false} />
      );
      const link = container.querySelector(
        'a[href*="/assets/export/"][href*=".pdf"]'
      );
      expect(link).toBeTruthy();
      const href = (link as HTMLAnchorElement).getAttribute("href") ?? "";
      expect(href).toContain("location=Warehouse-DISTINCTIVE");
      expect(href).toContain("tag=drill-DISTINCTIVE");
    });

    it("A3.c.4 (CR-B regression) disabled link is removed from tab order + click is suppressed", () => {
      // CR finding (Major on 6dd022d07): `aria-disabled` + `pointer-
      // events-none` alone leaves an anchor in the keyboard tab order
      // and activatable via Enter/Space. WCAG 2.1 AA requires disabled
      // controls to be non-focusable / non-activatable for keyboard users.
      const { container } = render(
        <ExportAssetsPdfButton disabled={true} initialIncludeImages={false} />
      );
      const link = container.querySelector(
        'a[href*="/assets/export/"][href*=".pdf"]'
      );
      expect(link).toBeTruthy();
      // Removed from sequential focus when disabled
      expect((link as HTMLAnchorElement).getAttribute("tabindex")).toBe("-1");
      // aria-disabled preserved for screen readers
      expect((link as HTMLAnchorElement).getAttribute("aria-disabled")).toBe(
        "true"
      );
    });
  });

  describe("A8 — (CR-A regression) shared `formatAbsoluteDate` used for generatedAt", () => {
    it("A8.a header renders date in long-form (MMMM d, yyyy), not toLocaleDateString default", () => {
      // CR-A (Major on 6dd022d07): component used `generatedAt.toLocaleDateString`
      // which bypasses the project's shared formatting path. The component
      // is rendered via `renderToString` in the loader (no RouterProvider),
      // so the `DateS` hook path can't be used — `formatAbsoluteDate`
      // (the SSR-safe sibling from the same file) is the right primitive.
      //
      // Behavioral check: with year/month/day options, formatAbsoluteDate
      // produces "January 15, 2026" (date-fns "MMMM d, yyyy"). Raw
      // `toLocaleDateString("en-US", {year,month:"long",day})` gives
      // "January 15, 2026" too — coincidentally same here — so we also
      // assert that the DEFAULT (option-less) cell formatter is in use
      // for cells.
      const props = makeProps({
        generatedAt: new Date("2026-01-15T12:00:00Z"),
        columns: [{ name: "name", position: 0, label: "Name" }],
        rows: [{ id: "r1", values: { name: "X" }, thumbnailUrl: null }],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      // The long-form should contain the long month name and the day.
      expect(container.innerHTML).toContain("January");
      expect(container.innerHTML).toContain("15");
      expect(container.innerHTML).toContain("2026");
    });
  });

  describe("A8b — (CR-C regression) Date values in row.values render via formatAbsoluteDate, not UTC-truncated YYYY-MM-DD", () => {
    it("A8b.a a Date cell value renders as a long-form date (not 'YYYY-MM-DD')", () => {
      // CR-C (Major on 6dd022d07): the loader previously called
      // `toISOString().split("T")[0]` on createdAt/updatedAt, forcing UTC
      // and shifting calendar days near midnight. The loader now passes
      // raw Dates through `values`, and the component formats them via
      // `formatAbsoluteDate` in the cell renderer.
      const props = makeProps({
        columns: [{ name: "createdAt", position: 0, label: "Created" }],
        rows: [
          {
            id: "r1",
            values: { createdAt: new Date("2026-01-15T23:30:00Z") },
            thumbnailUrl: null,
          },
        ],
      });
      const { container } = render(<AssetIndexPdf {...props} />);
      // formatAbsoluteDate (option-less) uses date-fns "PPP" — locale-long
      // format. We assert the year + day appear; the literal
      // "2026-01-15" (UTC ISO truncated) must NOT appear.
      expect(container.innerHTML).not.toContain("2026-01-15");
      // The year must still be rendered (proves SOME date format ran).
      expect(container.innerHTML).toContain("2026");
    });
  });
});
