// @vitest-environment node
/**
 * The barcode pictures printed on the booking checklist and the audit receipt.
 *
 * A printed barcode is only useful if it scans, and whether it scans is a
 * matter of millimetres: every bar one module wide at a width a scanner reads,
 * with blank quiet zones on both sides. These tests run the real bwip-js
 * encoder and read the SVG it produced, because the geometry IS the behaviour.
 *
 * @see {@link file://./pdf-code-image.server.ts}
 * @see {@link file://./pdf-code-image.ts}
 */
import { describe, expect, it } from "vitest";

import {
  PDF_CODE_IMAGE_MAX_WIDTH_MM,
  PDF_CODE_MODULE_MM,
  PDF_LINEAR_CODE_HEIGHT_MM,
  PDF_SQUARE_CODE_MAX_MODULES,
} from "./pdf-code-image";
import { encodeBarcodeImage } from "./pdf-code-image.server";

const bwipjs = await import("@bwip-js/browser");

/** Decodes a picture's data URL back to its SVG source. */
function svgOf(dataUrl: string | null): string {
  expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  return Buffer.from(dataUrl!.split(",")[1], "base64").toString("utf8");
}

/** The width in modules bwip-js drew, read off the SVG's `viewBox`. */
function modulesWide(svg: string): number {
  return Number(svg.match(/viewBox="0 0 ([\d.]+) /)?.[1]);
}

describe("printed barcode pictures", () => {
  it("prints an 11-character Code 128 one module per 0.25 mm, quiet zones included", () => {
    const svg = svgOf(
      encodeBarcodeImage({ type: "Code128", value: "ABCDEFGHIJK" }, bwipjs)
    );

    // 156 modules of code plus a 10-module quiet zone on each side.
    expect(modulesWide(svg)).toBe(176);
    // why: the sheet prints the picture at the size its SVG declares, so this
    // attribute IS the printed width: 176 modules x 0.25 mm.
    expect(svg).toContain('width="44mm"');
    expect(svg).toContain(`height="${PDF_LINEAR_CODE_HEIGHT_MM}mm"`);
    // why: the sheet stretches only the height; the width must stay exact.
    expect(svg).toContain('preserveAspectRatio="none"');
  });

  it("leaves room in the Code column for an 11-character Code 128", () => {
    // why: the column is sized for this length. If it shrinks below it,
    // ordinary asset tags lose their pictures and print as text only.
    expect(PDF_CODE_IMAGE_MAX_WIDTH_MM).toBeGreaterThanOrEqual(
      176 * PDF_CODE_MODULE_MM
    );
  });

  it("draws no picture for a Code 128 too wide for the Code column", () => {
    // 12 letters: 187 modules, 46.75 mm, wider than the cell. Shrinking it
    // would make the bars too thin to scan; the text prints instead.
    expect(
      encodeBarcodeImage({ type: "Code128", value: "ABCDEFGHIJKL" }, bwipjs)
    ).toBeNull();
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
    expect(modulesWide(svg)).toBeGreaterThanOrEqual(95 + 2 * 11);
  });

  it("draws a 2D code with no printed size, so the sheet prints it square", () => {
    for (const type of ["DataMatrix", "ExternalQR"] as const) {
      const svg = svgOf(
        encodeBarcodeImage({ type, value: "https://example.com/a1" }, bwipjs)
      );
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)![1].split(" ");

      expect(w).toBe(h);
      expect(svg).not.toContain("preserveAspectRatio");
      expect(svg).not.toMatch(/<svg[^>]* width=/);
    }
  });

  it("draws no picture for a 2D code too dense for its square", () => {
    // why: a long External QR squeezed into the 14.8 mm square would print
    // modules far below 0.25 mm, which no scanner reads. It is also the one
    // value that could put a very large picture into the sheet's payload.
    const longUrl = `https://example.com/${"a".repeat(600)}`;

    expect(
      encodeBarcodeImage({ type: "ExternalQR", value: longUrl }, bwipjs)
    ).toBeNull();
  });

  it("keeps a typical External QR URL, which fits the square", () => {
    // 103 characters: a 41-module QR, 0.36 mm per module in the square.
    const svg = svgOf(
      encodeBarcodeImage(
        { type: "ExternalQR", value: `https://example.com/${"a".repeat(83)}` },
        bwipjs
      )
    );

    expect(modulesWide(svg) / 2).toBeLessThanOrEqual(
      PDF_SQUARE_CODE_MAX_MODULES
    );
  });

  it("reads a 2D symbol at two viewBox units per module", () => {
    // why: the density cutoff divides by this. A 35-character URL is a
    // version 3 QR, 29 modules wide; if bwip-js ever changes how it draws
    // matrix symbols, this fails before the cutoff silently shifts.
    const svg = svgOf(
      encodeBarcodeImage(
        { type: "ExternalQR", value: `https://example.com/${"a".repeat(15)}` },
        bwipjs
      )
    );

    expect(modulesWide(svg)).toBe(2 * 29);
  });
});
