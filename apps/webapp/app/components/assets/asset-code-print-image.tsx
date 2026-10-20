/**
 * AssetCodePrintImage
 *
 * A picture of the same code `AssetCodePrintText` prints in a sheet's Code
 * cell. Shared by the booking checklist and the audit receipt, which print it
 * either in the row's Code cell or on a full-width line under the row, as the
 * picture's `placement` says.
 *
 * The server draws the picture (`buildPdfCodeImageMap`) and decides its shape
 * and placement. This component only sizes it on paper:
 *
 * - a linear barcode (Code 128, Code 39, EAN-13), and any picture on the
 *   full-width line, prints at the size its SVG declares, which the server set
 *   from the code's module count so every module prints at a scannable width.
 *   It must NOT be given a size or `object-cover` here: a square box would
 *   squash the bars or crop the quiet zones, and either stops it scanning;
 * - a 2D code in the cell (the Shelf QR, DataMatrix, External QR) prints
 *   square, at the size the caller passes.
 *
 * @see {@link file://./../../modules/barcode/pdf-code-image.server.ts}
 * @see {@link file://./../../modules/barcode/pdf-code-image.ts}
 * @see {@link file://./asset-code-print-text.tsx}
 */

import type { PdfCodeImage } from "~/modules/barcode/pdf-code-image";
import { tw } from "~/utils/tw";

/**
 * Renders one row's code picture, or nothing when the row has none.
 *
 * @param props.image - The row's entry in the sheet's code picture map; absent
 *   when the sheet prints the code as text only
 * @param props.alt - Alternative text for the picture
 * @param props.squareClassName - Size classes for a 2D code printed in the
 *   Code cell
 * @returns The `<img>`, or `null` without a picture
 */
export function AssetCodePrintImage({
  image,
  alt,
  squareClassName,
}: {
  image: PdfCodeImage | undefined;
  alt: string;
  squareClassName: string;
}) {
  if (!image) {
    return null;
  }

  // The SVG declares its own printed size for a linear code and for every
  // picture on the full-width line; only an in-cell square takes the sheet's.
  const declaresOwnSize =
    image.shape === "linear" || image.placement === "line";

  return (
    <img
      src={image.src}
      alt={alt}
      data-code-shape={image.shape}
      data-code-placement={image.placement}
      className={tw(
        declaresOwnSize ? "block" : squareClassName,
        // The Shelf QR carries no quiet zone of its own, and a scanner needs
        // clear space on every side to find it. The cell's padding clears the
        // top, left and right; this keeps the code text or tick box under the
        // picture out of the bottom of that space.
        !declaresOwnSize && "mb-[2.5mm]"
      )}
    />
  );
}
