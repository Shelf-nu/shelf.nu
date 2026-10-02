/**
 * PDF Code Picture Geometry
 *
 * The print measurements the booking checklist and the audit receipt share
 * with the server encoder that draws their code pictures. They live together
 * because they are one decision: the Code column's width decides how wide a
 * linear barcode may print, and the server refuses a barcode that would not fit
 * that column. Change the column here and the cutoff moves with it.
 *
 * Pure and client-safe: the sheets import the column width, the server imports
 * the cutoff.
 *
 * @see {@link file://./pdf-code-image.server.ts} the encoder that reads the cutoff
 * @see {@link file://./../../components/booking/booking-overview-pdf.tsx}
 * @see {@link file://./../../components/audit/audit-receipt-pdf.tsx}
 */

/**
 * Width of the printable area of every sheet, in millimetres: an A4 page
 * (210 mm) minus the 10 mm `@page` margin on each side. The sheets print their
 * wrapper at this width so Chrome prints them at 100% scale.
 */
export const PDF_PRINTABLE_WIDTH_MM = 190;

/**
 * Width of one barcode module (the narrowest bar) on paper, in millimetres.
 * 0.25 mm is a common label X-dimension that ordinary handheld and phone
 * scanners read reliably.
 */
export const PDF_CODE_MODULE_MM = 0.25;

/** Printed height of a linear barcode picture, in millimetres. */
export const PDF_LINEAR_CODE_HEIGHT_MM = 10;

/**
 * The Code column's share of the asset table, in percent, on both sheets that
 * print code pictures. Sized so an 11-character Code 128 (176 modules with its
 * quiet zones, 44 mm at {@link PDF_CODE_MODULE_MM}) fits inside the cell.
 */
export const PDF_CODE_COLUMN_PERCENT = 27;

/** One CSS pixel in millimetres, at the 96 px per inch print resolution. */
const CSS_PX_MM = 25.4 / 96;

/**
 * Horizontal space a Code cell spends on anything but its content: `p-2.5`
 * (10 px) on each side plus the 1 px cell border.
 */
const CODE_CELL_CHROME_MM = (2 * 10 + 1) * CSS_PX_MM;

/**
 * Widest a linear barcode picture may print, in millimetres: the Code cell's
 * content width. A barcode wider than this at {@link PDF_CODE_MODULE_MM} per
 * module prints as text only, because shrinking it would make the bars too thin
 * to scan and letting it overflow would run it off the cell.
 */
export const PDF_CODE_IMAGE_MAX_WIDTH_MM =
  (PDF_PRINTABLE_WIDTH_MM * PDF_CODE_COLUMN_PERCENT) / 100 -
  CODE_CELL_CHROME_MM;

/**
 * Side of the square a 2D code (the Shelf QR, DataMatrix, External QR) prints
 * in, in millimetres: `size-14` (56 px) on the booking checklist. The audit
 * receipt prints it at `size-16`; the smaller of the two governs, so one
 * picture suits both sheets.
 */
export const PDF_SQUARE_CODE_SIDE_MM = 56 * CSS_PX_MM;

/**
 * Most modules a 2D barcode may span and still print at
 * {@link PDF_CODE_MODULE_MM} per module in its square. A denser code (a long
 * External QR URL) prints as text only: squeezed into the square its modules
 * would be too small to scan.
 */
export const PDF_SQUARE_CODE_MAX_MODULES = Math.floor(
  PDF_SQUARE_CODE_SIDE_MM / PDF_CODE_MODULE_MM
);
