/**
 * QR Label — pure, client-safe label generation
 *
 * Single source of truth for turning an asset's resolved code data into a
 * print-ready **vector** label. Used by both customer-facing export journeys:
 *  - the PDF label sheet (`<QrLabelSheet>` renders the QR via {@link qrDarkModules})
 *  - the SVG-files zip ({@link buildLabelZipEntries} → standalone `.svg` + `manifest.csv`)
 *
 * Design notes:
 *  - **Vector only.** No raster, no `html-to-image`, no `changedpi`. The QR is
 *    drawn as `<rect>` modules from `qrcode-generator`'s matrix.
 *  - **Minimize module count.** Version is auto-selected (`qrcode(0, ...)` picks
 *    the lowest that fits) and EC defaults to `L` — the largest modules, which is
 *    what scans on a small label at low printer DPI. Higher EC ⇒ more modules ⇒
 *    smaller modules ⇒ worse at small physical sizes; treat EC as an empirical
 *    print-tested choice, not a durability default.
 *  - Pure + client-safe: no `.server` imports, no DB, no side effects. Safe to
 *    call from a loader or a browser component, and to unit-test directly.
 *
 * @see {@link file://./../../components/assets/qr-label-sheet.tsx} (PDF journey)
 * @see {@link file://./../../components/assets/bulk-download-qr-dialog.tsx} (zip journey)
 * @see {@link file://./../../routes/api+/assets.get-assets-for-bulk-qr-download.ts} (loader)
 */
import QRCode, { type ErrorCorrectionLevel } from "qrcode-generator";
import { sanitizeFilename } from "~/utils/sanitize-filename";

/** Default error-correction: `L` = largest modules = best on small/low-DPI labels. */
export const DEFAULT_EC: ErrorCorrectionLevel = "L";

/** Standard QR quiet zone, in modules, required for reliable scanning. */
const QUIET_ZONE = 4;

/** The per-asset data a label needs (already org-scoped + resolved upstream). */
export type LabelAsset = {
  /** The asset id (manifest only). */
  id: string;
  /** Human-readable asset name shown on the label and used for the filename. */
  title: string;
  /** The Shelf QR id — the scannable graphic always encodes this. */
  qrId: string;
  /**
   * The identifier text printed under the QR. Comes from `resolveDisplayCode`
   * upstream (SAM id / QR id / barcode value) so the label matches list views.
   */
  idText: string;
};

/**
 * Builds the full scan URL a Shelf QR encodes.
 * @param qrBaseUrl - env-derived base (`getQrBaseUrl()`), e.g. `https://eam.sh`
 * @param qrId - the asset's QR id
 * @returns the URL string, identical to what the printed QR encodes
 */
export const qrScanUrl = (qrBaseUrl: string, qrId: string): string =>
  `${qrBaseUrl}/${qrId}`;

/**
 * Computes the QR module matrix for a URL — the shared primitive behind every
 * QR we draw (PDF cell and zip svg) so the two render paths can never diverge.
 *
 * @param url - the string to encode
 * @param ec - error-correction level (default {@link DEFAULT_EC})
 * @returns `count` (modules per side) and `dark[r][c]` module states
 */
export function qrDarkModules(
  url: string,
  ec: ErrorCorrectionLevel = DEFAULT_EC
): { count: number; dark: boolean[][] } {
  // type 0 => auto-pick the LOWEST version that fits => fewest, biggest modules.
  const code = QRCode(0, ec);
  code.addData(url);
  code.make();
  const count = code.getModuleCount();
  const dark: boolean[][] = [];
  for (let r = 0; r < count; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < count; c++) {
      row.push(code.isDark(r, c));
    }
    dark.push(row);
  }
  return { count, dark };
}

/** Module count only — used by tests/UI to reason about module density. */
export const qrModuleCount = (
  url: string,
  ec: ErrorCorrectionLevel = DEFAULT_EC
): number => qrDarkModules(url, ec).count;

/** XML-escape text destined for an SVG `<text>` node. */
const escapeXml = (s: string): string =>
  s.replace(/[<>&"']/g, (ch) =>
    ch === "<"
      ? "&lt;"
      : ch === ">"
      ? "&gt;"
      : ch === "&"
      ? "&amp;"
      : ch === '"'
      ? "&quot;"
      : "&apos;"
  );

/**
 * Builds a standalone, self-contained **vector** label SVG: the QR (with quiet
 * zone) + asset name + identifier text + optional "Powered by shelf.nu". Scales
 * to any physical size via its `viewBox`, so label software can place it at the
 * user's exact label dimensions with no quality loss.
 *
 * @returns a complete `<svg>…</svg>` string (one file in the zip journey)
 */
export function buildLabelSvg({
  url,
  title,
  idText,
  showBranding,
  ec = DEFAULT_EC,
}: {
  url: string;
  title: string;
  idText: string;
  showBranding: boolean;
  ec?: ErrorCorrectionLevel;
}): string {
  const { count, dark } = qrDarkModules(url, ec);
  const qrSize = count + QUIET_ZONE * 2; // module units, incl. quiet zone

  // Text block laid out in the same module-unit coordinate space, below the QR.
  const titleSize = Math.max(2, qrSize * 0.085);
  const idSize = titleSize * 0.85;
  const gap = qrSize * 0.06;
  const titleY = qrSize + gap + titleSize;
  const idY = titleY + idSize * 1.3;
  const brandSize = idSize * 0.8;
  const brandY = idY + brandSize * 1.5;
  const totalH = (showBranding ? brandY : idY) + gap;
  const cx = qrSize / 2;

  let rects = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (dark[r][c]) {
        rects += `<rect x="${QUIET_ZONE + c}" y="${
          QUIET_ZONE + r
        }" width="1" height="1"/>`;
      }
    }
  }

  const brand = showBranding
    ? `<text x="${cx}" y="${brandY}" font-size="${brandSize}" text-anchor="middle" fill="#475467">Powered by shelf.nu</text>`
    : "";

  // SVG <text> doesn't wrap; truncate long names so they don't overflow the card.
  const titleText =
    title.length > 21 ? `${title.slice(0, 20).trimEnd()}…` : title;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qrSize} ${totalH}" ` +
    `width="${qrSize}" height="${totalH}" shape-rendering="crispEdges" ` +
    `font-family="Inter, Arial, sans-serif">` +
    `<rect width="${qrSize}" height="${totalH}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects}</g>` +
    `<text x="${cx}" y="${titleY}" font-size="${titleSize}" font-weight="700" text-anchor="middle" fill="#101828">${escapeXml(
      titleText
    )}</text>` +
    `<text x="${cx}" y="${idY}" font-size="${idSize}" text-anchor="middle" fill="#344054">${escapeXml(
      idText
    )}</text>` +
    brand +
    `</svg>`
  );
}

/**
 * Same label as {@link buildLabelSvg}, as a vector `data:` URL — so React
 * surfaces (preview, print, the PDF sheet) can render the EXACT same artifact
 * the download/zip produce, via a single `<img>`. One template, zero drift.
 *
 * @returns `data:image/svg+xml;utf8,<encoded svg>`
 */
export const labelSvgDataUrl = (
  args: Parameters<typeof buildLabelSvg>[0]
): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(buildLabelSvg(args))}`;

/**
 * RFC-4180 escape + spreadsheet-formula-injection neutralization. A cell that
 * starts with `=`, `+`, `-`, `@`, or a control char can execute as a formula
 * when the CSV is opened in Excel/Sheets — and asset names are attacker-
 * controllable — so we prefix those with an apostrophe before quoting.
 */
const csvCell = (value: string): string => {
  // Leading control chars (tab/CR/LF) can also smuggle a formula payload, so
  // neutralize them alongside the `= + - @` formula triggers.
  const safe = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Manifest column headers — stable contract for the merge workflow. */
export const MANIFEST_HEADERS = ["Asset ID", "Name", "QR ID", "Scan URL"];

/**
 * Builds the `manifest.csv` content pairing each asset with its code + scan URL.
 * The URL is the SAME string the label QR encodes (see {@link qrScanUrl}) so the
 * printed code and the merge data can never diverge.
 *
 * @param assets - the resolved label assets
 * @param qrBaseUrl - env-derived QR base url
 * @returns CSV text (CRLF line endings, RFC-4180 quoted)
 */
export function buildManifestCsv(
  assets: LabelAsset[],
  qrBaseUrl: string
): string {
  const rows = assets.map((a) =>
    [a.id, a.title, a.qrId, qrScanUrl(qrBaseUrl, a.qrId)].map(csvCell).join(",")
  );
  return [MANIFEST_HEADERS.map(csvCell).join(","), ...rows].join("\r\n");
}

/** Deterministic, filesystem-safe filename for an asset's label (default `.svg`). */
export const labelFileName = (
  asset: LabelAsset,
  ext: "svg" | "png" = "svg"
): string => `${sanitizeFilename(asset.title)}_${asset.qrId}.${ext}`;

/** One file destined for the export zip. */
export type ZipEntry = { path: string; content: string };

/**
 * Plain-language README dropped into the export zip so the SVG/CSV files stop
 * being a wall for non-technical users — the #1 source of "what do I do with
 * these files?" support tickets. Kept jargon-light on purpose.
 */
export const ZIP_README = `HOW TO USE THESE FILES
======================

This zip has one QR image (.svg) for each of your assets, inside the
"qr-codes" folder, plus a spreadsheet called "manifest.csv".

Each QR code is already linked to the right asset in Shelf.

----------------------------------------------------------------------
JUST WANT TO PRINT ONE?
  Open any .svg file in the "qr-codes" folder and print it.
  (SVG stays perfectly sharp at any size.)

WANT TO PRINT MANY ON A LABEL PRINTER (Brother, Dymo, Avery...)?
  1. Open your label software (e.g. Brother P-touch Editor, Dymo
     Connect, or Avery Design & Print).
  2. Import "manifest.csv" as a data source / mail merge.
  3. Put the "Name" column on the label as text, and the "Scan URL"
     column as a QR code.
  4. Print ONE label first and scan it with your phone to check it
     works, then print the rest.
----------------------------------------------------------------------

The "manifest.csv" columns:
  - Asset ID : the asset's id in Shelf
  - Name     : the asset name (put this on the label)
  - QR ID    : the code's id
  - Scan URL : what the QR points to (use this to make the QR code)

Stuck? Reply to your Shelf support email and we'll help.
`;

/**
 * Assembles the complete set of zip entries for the SVG export journey: one
 * vector `.svg` per asset under `qr-codes/`, plus a root `manifest.csv`. Pure so
 * the file map is unit-testable without JSZip/Blob; the dialog just feeds these
 * to JSZip.
 *
 * @returns array of `{ path, content }` — every svg path ends `.svg`, never `.jpg`
 */
export function buildLabelZipEntries({
  assets,
  qrBaseUrl,
  showBranding,
  ec = DEFAULT_EC,
}: {
  assets: LabelAsset[];
  qrBaseUrl: string;
  showBranding: boolean;
  ec?: ErrorCorrectionLevel;
}): ZipEntry[] {
  const entries: ZipEntry[] = assets.map((a) => ({
    path: `qr-codes/${labelFileName(a)}`,
    content: buildLabelSvg({
      url: qrScanUrl(qrBaseUrl, a.qrId),
      title: a.title,
      idText: a.idText,
      showBranding,
      ec,
    }),
  }));
  entries.push({
    path: "manifest.csv",
    content: buildManifestCsv(assets, qrBaseUrl),
  });
  entries.push({ path: "README.txt", content: ZIP_README });
  return entries;
}
