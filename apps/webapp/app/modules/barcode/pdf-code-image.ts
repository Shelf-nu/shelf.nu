/**
 * PDF Code Picture Geometry
 *
 * The print measurements the booking checklist and the audit receipt share
 * with the server encoder that draws their code pictures. They live together
 * because they are one decision: the Code column's width decides how wide a
 * code may print in the cell, and the server moves a code that would not fit
 * the cell onto a full-width line under its row. Change the column here and
 * the cutoff moves with it.
 *
 * Pure and client-safe: the sheets import the column width and the
 * {@link PdfCodeImage} type, the server imports the cutoffs.
 *
 * @see {@link file://./pdf-code-image.server.ts} the encoder that reads the cutoffs
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
 * Preferred width of one barcode module (the narrowest bar, or one cell of a 2D
 * code) on paper, in millimetres. 0.25 mm is a common label X-dimension that
 * ordinary handheld and phone scanners read reliably.
 */
export const PDF_CODE_MODULE_MM = 0.25;

/**
 * Narrowest module a code may be shrunk to so it fits its space, in
 * millimetres. Below this, phone cameras and entry-level scanners stop reading
 * the code reliably, so a code that would need thinner modules moves to the
 * full-width line under its row instead.
 */
export const PDF_CODE_MIN_MODULE_MM = 0.19;

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
 * Horizontal space a Code cell (or the full-width code line) spends on
 * anything but its content, in millimetres. It must hold on screen as well as
 * on paper, so it counts the wider of the two layouts:
 *
 * - `p-2.5`: 10 px of padding on each side (20 px);
 * - the cell's 1 px border on each side (2 px);
 * - the table's own `border border-gray-300`, 1 px on each side, which only
 *   the on-screen preview draws (2 px), charged in full to this cell;
 * - 1 px for the browser rounding percentage widths to whole pixels.
 *
 * 25 px in all, about 6.6 mm.
 */
const CODE_CELL_CHROME_MM = (20 + 2 + 2 + 1) * CSS_PX_MM;

/**
 * Widest a linear barcode picture may print inside the Code cell, in
 * millimetres: the cell's content width, about 44.7 mm. A wider code is first
 * shrunk toward {@link PDF_CODE_MIN_MODULE_MM}, then moved to the full-width
 * line (see {@link PDF_CODE_LINE_MAX_WIDTH_MM}).
 */
export const PDF_CODE_IMAGE_MAX_WIDTH_MM =
  (PDF_PRINTABLE_WIDTH_MM * PDF_CODE_COLUMN_PERCENT) / 100 -
  CODE_CELL_CHROME_MM;

/**
 * Widest a code picture may print on the full-width line under its row, in
 * millimetres: the printable width less the line cell's padding, borders, the
 * preview's table border and rounding, about 183.4 mm. A code that does not fit
 * here even at {@link PDF_CODE_MIN_MODULE_MM} gets no picture.
 */
export const PDF_CODE_LINE_MAX_WIDTH_MM =
  PDF_PRINTABLE_WIDTH_MM - CODE_CELL_CHROME_MM;

/**
 * Side of the square a 2D code (the Shelf QR, DataMatrix, External QR) prints
 * in inside the Code cell, in millimetres: `size-14` (56 px) on the booking
 * checklist. The audit receipt prints it at `size-16`; the smaller of the two
 * governs, so one picture suits both sheets.
 */
export const PDF_SQUARE_CODE_SIDE_MM = 56 * CSS_PX_MM;

/**
 * Most modules, quiet zone included, a 2D code may span and still print in the
 * Code cell's square at {@link PDF_CODE_MIN_MODULE_MM} or wider. A denser code
 * (a long External QR URL) prints on the full-width line instead.
 */
export const PDF_SQUARE_CODE_MAX_MODULES = Math.floor(
  PDF_SQUARE_CODE_SIDE_MM / PDF_CODE_MIN_MODULE_MM
);

/**
 * The picture printed for one row's code.
 *
 * - `src`: the picture as a data URL.
 * - `shape`: `linear` for a 1D barcode, `square` for a 2D code (the Shelf QR,
 *   DataMatrix, External QR). A linear picture declares its printed size on
 *   its SVG root; an in-cell square one is sized by the sheet.
 * - `placement`: `cell` prints it in the row's Code cell; `line` prints it on a
 *   full-width line under the row, for a code too wide or dense to scan inside
 *   the cell. A `line` picture always declares its printed size.
 */
export type PdfCodeImage = {
  src: string;
  shape: "linear" | "square";
  placement: "cell" | "line";
};
