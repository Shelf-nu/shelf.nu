/**
 * QrLabelSheet — render + print-CSS tests (RTL / happy-dom).
 *
 * Every slot holds one `<img>` of `buildFittedLabelSvg` (the SAME artifact the
 * label-printer journey prints), placed at millimetre coordinates. So we assert
 * one labelled image per asset, the page geometry and the print CSS, rather
 * than inline DOM text.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrLabelSheet } from "./qr-label-sheet";

/** Decode a label `<img>`'s base64 `data:image/svg+xml` src back to the SVG. */
const decodeCardSvg = (img: Element): string =>
  Buffer.from(
    (img.getAttribute("src") || "").replace(/^data:[^,]+,/, ""),
    "base64"
  ).toString("utf8");

const ASSETS = [
  { id: "a1", title: "MacBook Pro 16", qrId: "qr-1", idText: "SAM-0001" },
  { id: "a2", title: "Lock Washer", qrId: "qr-2", idText: "SAM-0002" },
  { id: "a3", title: "Sony FX6", qrId: "qr-3", idText: "SAM-0003" },
];

/** N generated assets, for page-count tests. */
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    title: `Asset ${i}`,
    qrId: `qr-m${i}`,
    idText: `SAM-${String(i).padStart(4, "0")}`,
  }));

function renderSheet(showBranding = true, assets = ASSETS) {
  return render(
    <QrLabelSheet
      assets={assets}
      qrBaseUrl="https://eam.sh"
      showBranding={showBranding}
    />
  );
}

const pages = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid="sheet-page"]');
const slots = (container: HTMLElement) =>
  container.querySelectorAll('[data-testid="sheet-slot"]');

describe("QrLabelSheet", () => {
  it("A20 — renders one label image per asset (alt carries the name)", () => {
    renderSheet();
    expect(screen.getByAltText("QR label for MacBook Pro 16")).toBeTruthy();
    expect(screen.getByAltText("QR label for Lock Washer")).toBeTruthy();
    expect(screen.getByAltText("QR label for Sony FX6")).toBeTruthy();
  });

  it("A2 — each label is a VECTOR svg image (one path + the name/id inside)", () => {
    const { container } = renderSheet();
    const cards = container.querySelectorAll('img[src^="data:image/svg+xml"]');
    expect(cards.length).toBe(3);
    const svg = decodeCardSvg(cards[0]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path"); // vector QR modules, not raster
    // The name wraps onto up to two <text> lines; read the text back.
    const text = svg.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("MacBook");
    expect(text).toContain("Pro 16");
    expect(text).toContain("SAM-0001");
  });

  it("A21 — print stylesheet sets @page and the default paper size", () => {
    const { container } = renderSheet();
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join(" ");
    expect(styleText).toContain("@page");
    expect(styleText).toContain("size: letter");
  });

  it("A21 — each page is a real-size box that breaks after itself", () => {
    const { container } = renderSheet();
    const page = pages(container)[0];
    expect(page.getAttribute("style")).toContain("width: 215.9mm");
    expect(page.getAttribute("style")).toContain("height: 279.4mm");
    expect(page.getAttribute("style")).toContain("break-after: page");
  });

  it("A21 — labels sit at millimetre coordinates and are the plain label size", () => {
    const { container } = renderSheet();
    const style = slots(container)[0].getAttribute("style") ?? "";
    expect(style).toContain("position: absolute");
    expect(style).toMatch(/left: [\d.]+mm/);
    expect(style).toMatch(/top: [\d.]+mm/);
    expect(style).toContain("width: 45mm"); // Medium = 45 × 30 mm
    expect(style).toContain("height: 30mm");
    expect(style).toContain("dashed"); // cut guide = the label edge
  });

  it("A21 — choosing a smaller label size packs more per page", () => {
    const { container } = renderSheet(true, many(40));
    // Medium on Letter = 4 × 7 = 28 per page → 40 labels = 2 pages.
    expect(pages(container).length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: /Small/ }));
    // Small (30 × 20) on Letter = 5 × 10 = 50 per page → 1 page.
    expect(pages(container).length).toBe(1);
    expect(slots(container).length).toBe(40);
  });

  it("switching to A4 changes the @page size and the page box", () => {
    const { container } = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "A4" }));
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join(" ");
    expect(styleText).toContain("size: A4");
    expect(pages(container)[0].getAttribute("style")).toContain("width: 210mm");
  });

  it("Label sheet mode places labels on the default Avery template with an inset", () => {
    const { container } = renderSheet(true, many(31));
    fireEvent.click(screen.getByRole("button", { name: "Label sheet" }));
    // Default Letter template = Avery 5160: 30 per page → 31 labels = 2 pages.
    expect(pages(container).length).toBe(2);
    const first = slots(container)[0].getAttribute("style") ?? "";
    expect(first).toContain("left: 4.775mm");
    expect(first).toContain("top: 12.7mm");
    expect(first).toContain("width: 66.675mm");
    expect(first).toContain("height: 25.4mm");
    expect(first).toContain("padding: 1mm"); // ink stays off the die-cut edge
    expect(first).not.toContain("dashed"); // pre-cut: no cut guides
    // The plain-paper controls are gone; the template picker is there.
    expect(screen.queryByRole("button", { name: /Small/ })).toBeNull();
    expect(screen.getByLabelText("Label sheet template")).toBeTruthy();
  });

  it("segmented controls expose the active option via aria-pressed", () => {
    renderSheet();
    const medium = screen.getByRole("button", { name: /Medium/ });
    const small = screen.getByRole("button", { name: /Small/ });
    expect(medium.getAttribute("aria-pressed")).toBe("true");
    expect(small.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(small);
    expect(small.getAttribute("aria-pressed")).toBe("true");
    expect(medium.getAttribute("aria-pressed")).toBe("false");
  });

  it("cut guides can be switched off", () => {
    const { container } = renderSheet();
    expect(slots(container)[0].getAttribute("style")).toContain("dashed");
    fireEvent.click(screen.getByRole("switch", { name: "Cut guides" }));
    expect(slots(container)[0].getAttribute("style")).not.toContain("dashed");
  });

  it("branding inside the label follows showBranding", () => {
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
