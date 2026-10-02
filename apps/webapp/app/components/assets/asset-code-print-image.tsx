/**
 * AssetCodePrintImage
 *
 * The picture in a printed sheet's Code cell: a picture of the same code
 * `AssetCodePrintText` prints under it. Shared by the booking checklist and the
 * audit receipt.
 *
 * The server draws the picture (`buildPdfCodeImageMap`) and this component
 * only decides its shape on paper:
 *
 * - a linear barcode (Code 128, Code 39, EAN-13) prints at the size its SVG
 *   declares, which the server set from the code's module count so every bar
 *   is exactly one module wide. It must NOT be given a size or `object-cover`
 *   here: a square box would squash the bars or crop the quiet zones, and
 *   either stops it scanning;
 * - the Shelf QR and the 2D barcodes (DataMatrix, External QR) print square,
 *   at the size the caller passes.
 *
 * @see {@link file://./../../modules/barcode/pdf-code-image.server.ts}
 * @see {@link file://./asset-code-print-text.tsx}
 */

import { isLinearBarcodeType } from "~/modules/barcode/bwip-format";
import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { tw } from "~/utils/tw";

/**
 * Renders one row's code picture, or nothing when the row has none.
 *
 * @param props.src - The row's entry in the sheet's code picture map; absent
 *   when the sheet prints the code as text only
 * @param props.displayCode - The code the picture shows; its type decides the
 *   picture's shape
 * @param props.alt - Alternative text for the picture
 * @param props.squareClassName - Size classes for a QR or 2D code
 * @returns The `<img>`, or `null` without a picture
 */
export function AssetCodePrintImage({
  src,
  displayCode,
  alt,
  squareClassName,
}: {
  src: string | undefined;
  displayCode: ResolvedDisplayCode | undefined;
  alt: string;
  squareClassName: string;
}) {
  if (!src) {
    return null;
  }

  const isLinear = isLinearBarcodeType(displayCode?.type);

  return (
    <img
      src={src}
      alt={alt}
      data-code-shape={isLinear ? "linear" : "square"}
      className={tw(isLinear ? "block" : squareClassName)}
    />
  );
}
