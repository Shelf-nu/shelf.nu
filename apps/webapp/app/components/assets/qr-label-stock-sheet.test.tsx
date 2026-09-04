/**
 * QrLabelStockSheet — render tests (RTL / happy-dom).
 *
 * Covers the behaviour a print cannot: the scannability grade follows the
 * content toggle, the preview is capped, and the print target only exists
 * while a print is in flight.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QrLabelStockSheet, STOCK_PREVIEW_LIMIT } from "./qr-label-stock-sheet";

// why: react-to-print opens a print iframe and calls window.print(), which
// happy-dom cannot do. The hook returns a no-op so the component's own
// mount-then-print flow can be asserted without a printer.
vi.mock("react-to-print", () => ({
  useReactToPrint: () => vi.fn(),
}));

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    title: `Asset ${i}`,
    qrId: `kQ7m2aXb${i}`,
    idText: `SAM-${String(i).padStart(4, "0")}`,
  }));

function renderStock(assets = many(3), showBranding = true) {
  return render(
    <QrLabelStockSheet
      assets={assets}
      qrBaseUrl="https://eam.sh"
      showBranding={showBranding}
    />
  );
}

const previewImgs = (container: HTMLElement) =>
  container.querySelectorAll('img[src^="data:image/svg+xml"]');

describe("QrLabelStockSheet", () => {
  it("renders one preview image per asset on the default 2 × 1 in stock", () => {
    const { container } = renderStock();
    expect(previewImgs(container).length).toBe(3);
    expect(screen.getByAltText("QR label for Asset 0")).toBeTruthy();
    // The stock is named in the picker and again in the context line.
    expect(screen.getAllByText(/2 × 1 in/).length).toBeGreaterThanOrEqual(2);
  });

  it("the scannability grade follows the content toggle on a small square stock", () => {
    renderStock();
    fireEvent.click(screen.getByRole("button", { name: "15 × 15 mm" }));
    const before = screen.getByRole("status").textContent ?? "";
    const mmBefore = Number(/about ([\d.]+) mm/.exec(before)?.[1]);
    fireEvent.click(screen.getByRole("button", { name: "ID only" }));
    const afterEl = screen.queryByRole("status");
    // Either the warning is gone (grade improved to good) or it reports a
    // larger module size than before — never the same number.
    if (afterEl) {
      const mmAfter = Number(
        /about ([\d.]+) mm/.exec(afterEl.textContent ?? "")?.[1]
      );
      expect(mmAfter).toBeGreaterThan(mmBefore);
    }
  });

  it("the warning's 'switch to ID only' shortcut disappears once the name is off", () => {
    renderStock();
    fireEvent.click(screen.getByRole("button", { name: "15 × 15 mm" }));
    expect(screen.getByText("switch to ID only")).toBeTruthy();
    fireEvent.click(screen.getByText("switch to ID only"));
    expect(screen.queryByText("switch to ID only")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "ID only" })
        .getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("caps the on-screen preview and says how many more will print", () => {
    const { container } = renderStock(many(STOCK_PREVIEW_LIMIT + 12));
    expect(previewImgs(container).length).toBe(STOCK_PREVIEW_LIMIT);
    expect(
      screen.getByText(
        new RegExp(
          `first ${STOCK_PREVIEW_LIMIT} of ${STOCK_PREVIEW_LIMIT + 12}`
        )
      )
    ).toBeTruthy();
  });

  it("mounts the print target only while printing, with every label at the stock size", () => {
    const { container } = renderStock(many(5));
    expect(screen.queryByTestId("stock-print-target")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Print labels" }));
    const target = screen.getByTestId("stock-print-target");
    expect(target.querySelectorAll("img").length).toBe(5);
    expect(target.querySelector("style")?.textContent).toContain(
      "size: 50.8mm 25.4mm"
    );
    expect(
      target.querySelector('div[style*="break-after"]')?.getAttribute("style")
    ).toContain("width: 50.8mm");
    // The preview is still there and unchanged.
    expect(previewImgs(container).length).toBe(10);
  });

  it("a test print mounts exactly one label", () => {
    renderStock(many(5));
    fireEvent.click(screen.getByRole("button", { name: "Test print" }));
    expect(
      screen.getByTestId("stock-print-target").querySelectorAll("img").length
    ).toBe(1);
  });

  it("the store link carries the export ref", () => {
    renderStock();
    const link = screen.getByRole("link", {
      name: /Order pre-printed, durable Shelf labels/,
    });
    expect(link.getAttribute("href")).toContain("store.shelf.nu");
    expect(link.getAttribute("href")).toContain("ref=shelf_webapp_qr_export");
  });
});
