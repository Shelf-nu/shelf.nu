// @vitest-environment node
/**
 * The barcode pictures printed on the booking checklist and the audit receipt.
 *
 * A printed barcode is only useful if it scans, and whether it scans is a
 * matter of millimetres: every module at a width a scanner reads, with blank
 * quiet zones around the code. These tests run the real bwip-js encoder and
 * read the SVG it produced, because the geometry IS the behaviour.
 *
 * @see {@link file://./pdf-code-image.server.ts}
 * @see {@link file://./pdf-code-image.ts}
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedDisplayCode } from "./display";
import {
  PDF_CODE_IMAGE_MAX_WIDTH_MM,
  PDF_CODE_LINE_MAX_WIDTH_MM,
  PDF_CODE_MIN_MODULE_MM,
  PDF_CODE_MODULE_MM,
  PDF_LINEAR_CODE_HEIGHT_MM,
  PDF_SQUARE_CODE_MAX_MODULES,
} from "./pdf-code-image";
import type { PdfCodeImage } from "./pdf-code-image";
import {
  buildPdfCodeImageMap,
  encodeBarcodeImage,
} from "./pdf-code-image.server";
import { getQrCodeMaps } from "../qr/service.server";

// why: rendering the Shelf QR is image work (qrcode-generator + GIF to PNG)
// with its own tests; this suite only checks how its result is wrapped.
vi.mock("../qr/service.server", () => ({
  getQrCodeMaps: vi.fn(),
}));

const bwipjs = await import("@bwip-js/browser");

/** Decodes a picture back to its SVG source. */
function svgOf(image: PdfCodeImage | null): string {
  expect(image?.src).toMatch(/^data:image\/svg\+xml;base64,/);
  return Buffer.from(image!.src.split(",")[1], "base64").toString("utf8");
}

/** The width bwip-js drew, in `viewBox` units, read off the SVG. */
function viewBoxWidth(svg: string): number {
  return Number(svg.match(/viewBox="0 0 ([\d.]+) /)?.[1]);
}

/** The printed width the SVG root declares, in millimetres. */
function declaredWidthMm(svg: string): number {
  return Number(svg.match(/<svg[^>]* width="([\d.]+)mm"/)?.[1]);
}

/** A Code 128 value of `length` characters mixing letters and digits. */
function alphanumeric(length: number): string {
  return Array.from({ length }, (_, i) =>
    i % 2 ? String(i % 10) : String.fromCharCode(65 + (i % 26))
  ).join("");
}

describe("printed barcode pictures", () => {
  it("prints an 11-character Code 128 in the cell, one module per 0.25 mm, quiet zones included", () => {
    const image = encodeBarcodeImage(
      { type: "Code128", value: "ABCDEFGHIJK" },
      bwipjs
    );
    const svg = svgOf(image);

    expect(image).toMatchObject({ shape: "linear", placement: "cell" });
    // 156 modules of code plus a 10-module quiet zone on each side.
    expect(viewBoxWidth(svg)).toBe(176);
    // why: the sheet prints the picture at the size its SVG declares, so this
    // attribute IS the printed width: 176 modules x 0.25 mm.
    expect(declaredWidthMm(svg)).toBe(176 * PDF_CODE_MODULE_MM);
    expect(svg).toContain(`height="${PDF_LINEAR_CODE_HEIGHT_MM}mm"`);
    // why: the sheet stretches only the height; the width must stay exact.
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it("leaves room in the Code column for an 11-character Code 128", () => {
    // why: the column is sized for this length. If it shrinks below it,
    // ordinary asset tags print shrunk or move to the line under the row.
    expect(PDF_CODE_IMAGE_MAX_WIDTH_MM).toBeGreaterThanOrEqual(
      176 * PDF_CODE_MODULE_MM
    );
  });

  it("shrinks a Code 128 a little too wide for the cell, keeping it scannable", () => {
    // 12 letters: 187 modules, 46.75 mm at 0.25 mm, wider than the cell.
    const image = encodeBarcodeImage(
      { type: "Code128", value: "ABCDEFGHIJKL" },
      bwipjs
    );
    const svg = svgOf(image);
    const widthMm = declaredWidthMm(svg);

    expect(image?.placement).toBe("cell");
    expect(widthMm).toBeLessThanOrEqual(PDF_CODE_IMAGE_MAX_WIDTH_MM);
    expect(widthMm / viewBoxWidth(svg)).toBeLessThan(PDF_CODE_MODULE_MM);
    expect(widthMm / viewBoxWidth(svg)).toBeGreaterThanOrEqual(
      PDF_CODE_MIN_MODULE_MM
    );
  });

  it("moves a long linear code to the line under its row", () => {
    const cases = [
      { type: "Code128", value: alphanumeric(40) },
      { type: "Code39", value: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. $/+%" },
    ] as const;

    for (const code of cases) {
      const image = encodeBarcodeImage(code, bwipjs);
      const svg = svgOf(image);
      const widthMm = declaredWidthMm(svg);

      expect(image).toMatchObject({ shape: "linear", placement: "line" });
      expect(widthMm).toBeLessThanOrEqual(PDF_CODE_LINE_MAX_WIDTH_MM);
      expect(widthMm / viewBoxWidth(svg)).toBeGreaterThanOrEqual(
        PDF_CODE_MIN_MODULE_MM
      );
    }
  });

  it("draws no picture for a value the symbology refuses", () => {
    // why: an EAN-13 must be 12 or 13 digits and bwip-js throws otherwise. A
    // bad value on one asset must cost that row its picture, not the sheet.
    expect(
      encodeBarcodeImage({ type: "EAN13", value: "12345" }, bwipjs)
    ).toBeNull();
  });

  it("gives an EAN-13 its wider quiet zone", () => {
    const svg = svgOf(
      encodeBarcodeImage({ type: "EAN13", value: "5901234123457" }, bwipjs)
    );

    // 95 modules of code plus an 11-module quiet zone on each side (bwip-js
    // adds one more for the guard bars' extent).
    expect(viewBoxWidth(svg)).toBeGreaterThanOrEqual(95 + 2 * 11);
  });

  it("draws an in-cell 2D code square with no printed size, so the sheet sizes it", () => {
    for (const type of ["DataMatrix", "ExternalQR"] as const) {
      const image = encodeBarcodeImage(
        { type, value: "https://example.com/a1" },
        bwipjs
      );
      const svg = svgOf(image);
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)![1].split(" ");

      expect(image).toMatchObject({ shape: "square", placement: "cell" });
      expect(w).toBe(h);
      expect(svg).not.toContain("preserveAspectRatio");
      expect(svg).not.toMatch(/<svg[^>]* width=/);
    }
  });

  it("draws a QR's 4-module quiet zone, at two viewBox units per module", () => {
    // why: the fit check divides by two units per module and counts the quiet
    // zone. A 35-character URL is a version 3 QR, 29 modules wide; if bwip-js
    // ever changes how it draws matrix symbols, this fails before the fit
    // silently shifts.
    const svg = svgOf(
      encodeBarcodeImage(
        { type: "ExternalQR", value: `https://example.com/${"a".repeat(15)}` },
        bwipjs
      )
    );

    expect(viewBoxWidth(svg)).toBe(2 * (29 + 2 * 4));
  });

  it("draws a DataMatrix's 2-module quiet zone", () => {
    // "https://example.com/a1" is a 20-module DataMatrix.
    const svg = svgOf(
      encodeBarcodeImage(
        { type: "DataMatrix", value: "https://example.com/a1" },
        bwipjs
      )
    );

    expect(viewBoxWidth(svg)).toBe(2 * (20 + 2 * 2));
  });

  it("keeps a typical External QR URL in the cell", () => {
    // 103 characters: a 41-module QR plus its quiet zone, 0.30 mm per module
    // in the square.
    const image = encodeBarcodeImage(
      { type: "ExternalQR", value: `https://example.com/${"a".repeat(83)}` },
      bwipjs
    );

    expect(image?.placement).toBe("cell");
    expect(viewBoxWidth(svgOf(image)) / 2).toBeLessThanOrEqual(
      PDF_SQUARE_CODE_MAX_MODULES
    );
  });

  it("moves a 2D code too dense for its square to the line, at a declared size", () => {
    // why: squeezed into the 14.8 mm square, a 400-character QR's modules
    // would print below the scannable floor. On the line it prints larger, so
    // its SVG must say how large.
    const image = encodeBarcodeImage(
      { type: "ExternalQR", value: `https://example.com/${"a".repeat(380)}` },
      bwipjs
    );
    const svg = svgOf(image);
    const modules = viewBoxWidth(svg) / 2;
    const sideMm = declaredWidthMm(svg);

    expect(image).toMatchObject({ shape: "square", placement: "line" });
    expect(modules).toBeGreaterThan(PDF_SQUARE_CODE_MAX_MODULES);
    expect(sideMm).toBe(modules * PDF_CODE_MODULE_MM);
    expect(svg).toContain(`height="${sideMm}mm"`);
    expect(sideMm).toBeLessThanOrEqual(PDF_CODE_LINE_MAX_WIDTH_MM);
  });
});

describe("the picture map for a printed sheet", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getQrCodeMaps).mockReset();
  });

  /** A minimal asset row: the map only reads `id` and, for a QR, `qrCodes`. */
  function asset(id: string) {
    return { id, qrCodes: [] } as unknown as Parameters<
      typeof buildPdfCodeImageMap
    >[0]["assets"][number];
  }

  /** A resolved display code of the given type. */
  function displayCode(
    type: ResolvedDisplayCode["type"],
    value: string
  ): ResolvedDisplayCode {
    return {
      type,
      value,
      isFallback: false,
      entityKind: "asset",
      workspacePreference: type,
    };
  }

  it("yields to the event loop while drawing a long sheet of barcodes", async () => {
    // why: setImmediate is how the encoder hands the event loop back between
    // batches; spying on it (the real one still runs) is the only observable
    // sign of the yield.
    const yieldSpy = vi.spyOn(globalThis, "setImmediate");
    const ids = Array.from({ length: 60 }, (_, i) => `asset-${i}`);

    const images = await buildPdfCodeImageMap({
      assets: ids.map(asset),
      displayCodes: Object.fromEntries(
        ids.map((id, i) => [id, displayCode("Code128", `TAG${i}`)])
      ),
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(Object.keys(images)).toHaveLength(60);
    expect(yieldSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getQrCodeMaps).not.toHaveBeenCalled();
  });

  it("prints the Shelf QR as a square picture in the cell", async () => {
    vi.mocked(getQrCodeMaps).mockResolvedValueOnce({
      "qr-asset": "data:image/png;base64,AAAA",
    });

    const images = await buildPdfCodeImageMap({
      assets: [asset("qr-asset"), asset("barcode-asset")],
      displayCodes: {
        "qr-asset": displayCode("QR_ID", "abc123"),
        "barcode-asset": displayCode("Code128", "TAG1"),
      },
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(images["qr-asset"]).toEqual({
      src: "data:image/png;base64,AAAA",
      shape: "square",
      placement: "cell",
    });
    expect(images["barcode-asset"]).toMatchObject({
      shape: "linear",
      placement: "cell",
    });
  });
});
