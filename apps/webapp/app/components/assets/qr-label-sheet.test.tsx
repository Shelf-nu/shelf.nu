/**
 * QrLabelSheet — render + print-CSS tests (RTL / happy-dom).
 *
 * Each cell is one `<QrLabelCard>` — a vector `<img>` of `buildLabelSvg` (the
 * SAME artifact the download/zip produce). So we assert one labelled card per
 * asset + the print CSS, rather than inline DOM text.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrLabelSheet } from "./qr-label-sheet";

/** Decode a QrLabelCard's `data:image/svg+xml;utf8,...` src back to the SVG. */
const decodeCardSvg = (img: Element): string =>
  decodeURIComponent(
    (img.getAttribute("src") || "").replace(/^data:[^,]+,/, "")
  );

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
  it("A20 — renders one label card per asset (alt carries the name)", () => {
    renderSheet();
    expect(screen.getByAltText("QR label for MacBook Pro 16")).toBeTruthy();
    expect(screen.getByAltText("QR label for Lock Washer")).toBeTruthy();
    expect(screen.getByAltText("QR label for Sony FX6")).toBeTruthy();
  });

  it("A2 — each card is a VECTOR svg image (rects + the name/id inside)", () => {
    const { container } = renderSheet();
    const cards = container.querySelectorAll('img[src^="data:image/svg+xml"]');
    expect(cards.length).toBe(3);
    const svg = decodeCardSvg(cards[0]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect"); // vector QR modules, not raster
    expect(svg).toContain("MacBook Pro 16");
    expect(svg).toContain("SAM-0001");
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

  it("segmented controls expose the active option via aria-pressed", () => {
    renderSheet();
    // Medium is the default size; its button must be marked pressed for SR users.
    const medium = screen.getByRole("button", { name: /Medium/ });
    const small = screen.getByRole("button", { name: /Small/ });
    expect(medium.getAttribute("aria-pressed")).toBe("true");
    expect(small.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(small);
    expect(small.getAttribute("aria-pressed")).toBe("true");
    expect(medium.getAttribute("aria-pressed")).toBe("false");
  });

  it("branding inside the card follows showBranding", () => {
    const on = renderSheet(true);
    const onCard = on.container.querySelector(
      'img[src^="data:image/svg+xml"]'
    )!;
    expect(decodeCardSvg(onCard)).toContain("Powered by shelf.nu");
    on.unmount();

    const off = renderSheet(false);
    const offCard = off.container.querySelector(
      'img[src^="data:image/svg+xml"]'
    )!;
    expect(decodeCardSvg(offCard)).not.toContain("Powered by shelf.nu");
  });
});
