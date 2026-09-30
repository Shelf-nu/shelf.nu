/**
 * bwip-js Symbology Map
 *
 * Which bwip-js encoder draws each `BarcodeType`, and which of them are 2D.
 * The one copy of this map in the webapp: the on-screen renderer
 * (`BarcodeDisplay`) and the PDF encoder (`pdf-code-image.server.ts`) both read
 * it, so a value printed on a sheet produces the same bars as the value shown
 * on screen.
 *
 * Pure and client-safe: no bwip-js import here, so the component can use the
 * map without pulling the encoder into its chunk.
 *
 * The companion app keeps a hand-copied mirror in
 * `apps/companion/components/shared/code-section.tsx`; change both together.
 * See `.claude/rules/cross-app-mirrors-need-provenance.md`.
 *
 * @see {@link file://./../../components/barcode/barcode-display.tsx}
 * @see {@link file://./pdf-code-image.server.ts}
 */

import type { BarcodeType, QrIdDisplayPreference } from "@prisma/client";

/** bwip-js `bcid` for each barcode type. */
export const BWIP_FORMAT: Record<BarcodeType, string> = {
  Code128: "code128",
  Code39: "code39",
  DataMatrix: "datamatrix",
  ExternalQR: "qrcode",
  EAN13: "ean13",
};

/** Codes that are 2D, and so take no bar height and print square. */
export const IS_TWO_DIMENSIONAL: Record<BarcodeType, boolean> = {
  Code128: false,
  Code39: false,
  DataMatrix: true,
  ExternalQR: true,
  EAN13: false,
};

/**
 * Whether a display-code type is a barcode bwip-js can draw, as opposed to the
 * Shelf QR id or a SAM ID.
 *
 * @param type - The `type` of a resolved display code
 * @returns `true` for the five `BarcodeType` values
 */
export function isBarcodeType(
  type: QrIdDisplayPreference | undefined
): type is BarcodeType {
  return type !== undefined && Object.hasOwn(BWIP_FORMAT, type);
}

/**
 * Whether a display-code type is a linear (1D) barcode: Code 128, Code 39 or
 * EAN-13. These print at a width set by their module count, not square.
 *
 * @param type - The `type` of a resolved display code
 * @returns `true` only for the linear barcode types
 */
export function isLinearBarcodeType(
  type: QrIdDisplayPreference | undefined
): type is BarcodeType {
  return isBarcodeType(type) && !IS_TWO_DIMENSIONAL[type];
}
