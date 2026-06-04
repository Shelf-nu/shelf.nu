/**
 * QrLabelSheet — render + print-CSS tests (RTL / happy-dom).
 *
 * A20: N assets → N vector cells. A21: the print stylesheet carries `@page` and
 * cells are `break-inside: avoid` (the Safari/page-split guardrail), and a size
 * preset changes the grid density. A2: the QR is inline `<svg>`/`<rect>`, never raster.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrLabelSheet } from "./qr-label-sheet";

const ASSETS = [
  { id: "a1", title: "MacBook Pro 16", qrId: "qr-1", idText: "SAM-0001" },
  { id: "a2", title: "Lock Washer", qrId: "qr-2", idText: "SAM-0002" },
  { id: "a3", title: "Sony FX6", qrId: "qr-3", idText: "SAM-0003" },
];

function renderSheet(showBranding = true) {
  return render(
    <QrLabelSheet
      assets={ASSETS}
      qrBaseUrl="https://eam.sh"
      showBranding={showBranding}
    />
  );
}

describe("QrLabelSheet", () => {
  it("A20 — renders one cell per asset with its name + id text", () => {
    renderSheet();
    expect(screen.getByText("MacBook Pro 16")).toBeTruthy();
    expect(screen.getByText("Lock Washer")).toBeTruthy();
    expect(screen.getByText("SAM-0003")).toBeTruthy();
  });

  it("A2 — each QR is inline vector <svg> with <rect> modules, never an <img>", () => {
    const { container } = renderSheet();
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
    // The QR svgs contain rect modules; no raster <img> anywhere.
    expect(container.querySelector("svg rect")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("A21 — print stylesheet sets @page and the default paper size", () => {
    const { container } = renderSheet();
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join(" ");
    expect(styleText).toContain("@page");
    expect(styleText).toContain("size: letter");
  });

  it("A21 — cells avoid breaking across pages", () => {
    const { container } = renderSheet();
    const cell = container.querySelector('div[style*="break-inside"]');
    expect(cell?.getAttribute("style")).toContain("break-inside: avoid");
  });

  it("A21 — choosing a size preset changes the grid density", () => {
    const { container } = renderSheet();
    const sheet = () =>
      container.querySelector('div[style*="grid-template-columns"]');
    // default medium = 4 columns
    expect(sheet()?.getAttribute("style")).toContain("repeat(4,");
    fireEvent.click(screen.getByRole("button", { name: /Small/ }));
    expect(sheet()?.getAttribute("style")).toContain("repeat(6,");
  });

  it("hides branding text when showBranding is false", () => {
    renderSheet(false);
    expect(screen.queryByText("Powered by shelf.nu")).toBeNull();
  });
});
