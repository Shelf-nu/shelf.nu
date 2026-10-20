/**
 * @file The `labels.csv` that ships inside the bulk QR download zip.
 *
 * Third-party label software (Brady Workstation, P-touch Editor, Dymo
 * Connect, ...) builds a label from one spreadsheet row: it re-encodes the QR
 * from the `QR URL` column and prints the other columns as text. One row per
 * selected asset, in the order the loader returns them. A missing category or
 * location is an empty cell (not "Uncategorized"), so nothing stray prints on
 * a label.
 *
 * The file starts with a UTF-8 byte order mark so Excel decodes non-Latin
 * names correctly. Every field is quoted, and a value a spreadsheet would run
 * as a formula is neutralised (see `quoteField`).
 *
 * @see {@link file://../../routes/api+/assets.get-assets-for-bulk-qr-download.ts}
 * @see {@link file://../../components/assets/bulk-download-qr-dialog.tsx}
 * @see {@link file://./qr-url.server.ts}
 */
import { neutraliseCsvFormula, quoteCsvCell } from "~/utils/csv-cells";
import { withUtf8Bom } from "~/utils/csv-utf8";
import { getQrUrl } from "./qr-url.server";

/** The asset fields one label row needs. */
export type LabelsCsvAsset = {
  title: string;
  /** The "Asset ID" shown in the app (SAM-0001); null before one is assigned. */
  sequentialId: string | null;
  /** The id of the QR code linked to the asset. */
  qrId: string;
  category: { name: string } | null;
  location: { name: string } | null;
};

/** Column headers of `labels.csv`, in order. */
export const LABELS_CSV_HEADERS = [
  "Asset name",
  "SAM ID",
  "QR ID",
  "QR URL",
  "Category",
  "Location",
] as const;

/**
 * Quotes one CSV field, doubling any quote inside it.
 *
 * Asset, category and location names are typed by workspace members, so a
 * value a spreadsheet would run as a formula is neutralised. The file is read
 * by label software that prints a leading `'` literally, so a plain signed
 * measurement (`-20C Freezer`) is left as typed.
 *
 * @param value - The raw field value
 * @returns The quoted field
 */
function quoteField(value: string) {
  return quoteCsvCell(neutraliseCsvFormula(value, { keepSignedText: true }));
}

/**
 * Builds the `labels.csv` document for a bulk QR download.
 *
 * @param assets - The downloaded assets, in zip order
 * @returns The CSV document: BOM, header row, one row per asset, CRLF line ends
 */
export function buildLabelsCsv(assets: LabelsCsvAsset[]): string {
  const rows = assets.map((asset) => [
    asset.title,
    asset.sequentialId ?? "",
    asset.qrId,
    getQrUrl(asset.qrId),
    asset.category?.name ?? "",
    asset.location?.name ?? "",
  ]);

  const lines = [[...LABELS_CSV_HEADERS], ...rows].map((fields) =>
    fields.map(quoteField).join(",")
  );

  return withUtf8Bom(lines.join("\r\n"));
}
