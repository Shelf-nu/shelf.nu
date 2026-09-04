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

  // Collect rects in an array and join once: across a bulk export (up to 1500
  // labels) repeated string concatenation in this nested loop is a needless
  // CPU/memory hotspot in the browser.
  const rectParts: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (dark[r][c]) {
        rectParts.push(
          `<rect x="${QUIET_ZONE + c}" y="${
            QUIET_ZONE + r
          }" width="1" height="1"/>`
        );
      }
    }
  }
  const rects = rectParts.join("");

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

/* ---------------------------------------------------------------------------
 * Stock-aware, orientation-correct labels (the "fits my label printer" path).
 *
 * `buildLabelSvg` above produces ONE natural shape — a portrait card whose
 * height grows with the stacked text. Dropped onto a wide thermal label
 * (e.g. a 2"×1" WASP/Brother stock) it either letterboxes to a tiny QR or, if
 * the driver stretches to fill, distorts the modules so the code stops
 * scanning. Both are the "the image gets cut up" complaint.
 *
 * The functions below render a label whose `viewBox` aspect EQUALS the physical
 * stock, so it fills the label edge-to-edge, and pick the layout that fits the
 * shape: QR-left / text-right for wide stock, QR-on-top / text-below for
 * square or tall stock. Same QR primitive ({@link qrDarkModules}), same
 * resolver-driven text, same tier-gated branding — only the geometry differs.
 * ------------------------------------------------------------------------- */

/** A physical label size the export can target. Dimensions are millimetres. */
export type LabelStock = {
  /** Stable id used in URLs/state and as the default selection key. */
  id: string;
  /** Human label for the picker, e.g. `2 × 1 in`. */
  label: string;
  /** Physical width in mm. */
  widthMm: number;
  /** Physical height in mm. */
  heightMm: number;
  /** Optional note shown under the option (e.g. the matching printer/stock). */
  hint?: string;
};

/**
 * Blessed label stocks — a deliberately small, opinionated set, NOT a generic
 * "any dimensions" surface (that would make us a label-printer help desk). The
 * three square/rect sizes intentionally mirror the pre-printed labels sold at
 * store.shelf.nu, so the same picker that prints-your-own also names what you
 * can buy ready-made. `2x1` and `brother-17x54` cover the common third-party
 * thermal stocks our customers already own (WASP WPL308M, Brother QL).
 */
export const LABEL_STOCKS: Record<string, LabelStock> = {
  "2x1": {
    id: "2x1",
    label: "2 × 1 in",
    widthMm: 50.8,
    heightMm: 25.4,
    hint: "WASP, Avery & most thermal label printers",
  },
  "brother-17x54": {
    id: "brother-17x54",
    label: "17 × 54 mm",
    widthMm: 54,
    heightMm: 17,
    hint: "Brother QL die-cut (DK-11204)",
  },
  "rect-15x30": {
    id: "rect-15x30",
    label: "15 × 30 mm",
    widthMm: 30,
    heightMm: 15,
    hint: "Matches Shelf rectangular labels",
  },
  "square-25": {
    id: "square-25",
    label: "25 × 25 mm",
    widthMm: 25,
    heightMm: 25,
    hint: "Matches Shelf large labels",
  },
  "square-15": {
    id: "square-15",
    label: "15 × 15 mm",
    widthMm: 15,
    heightMm: 15,
    hint: "Matches Shelf small labels",
  },
};

/** Default stock — the most common third-party thermal size. */
export const DEFAULT_STOCK_ID = "2x1";

/** Round to 3dp so the SVG stays compact and deterministic across runs. */
const n = (x: number): number => Math.round(x * 1000) / 1000;

/** Approx mean glyph advance for Inter as a fraction of font-size. */
const GLYPH_ADVANCE = 0.58;

/** The free-tier branding mark printed on labels. */
const BRAND_TEXT = "Powered by shelf.nu";

/**
 * Sizes the branding line so it always fits `width`: shrinks the font to fit
 * when needed (never overflows the label edge — the bug where it clipped to
 * "…shelf"), and clamps the text as a final safety on extremely small stock.
 *
 * @returns the font size (mm) and the (possibly ellipsized) text to render
 */
function brandLine(
  width: number,
  desiredFs: number
): { fs: number; text: string } {
  // Largest font at which the full mark fits the width (0.97 keeps it off the
  // right edge). We size the font to fit rather than truncate, so the mark is
  // always rendered in full — it's a revenue surface, it must never read as a
  // half-word like "…shelf".
  const fitFs = (width / (BRAND_TEXT.length * GLYPH_ADVANCE)) * 0.97;
  return { fs: n(Math.min(desiredFs, fitFs)), text: BRAND_TEXT };
}

/**
 * Greedy word-wrap that fits `text` into at most `maxLines` lines no wider than
 * `maxWidth`, ellipsizing the final line on overflow. SVG `<text>` does not
 * wrap, so we compute the line breaks ourselves and emit `<tspan>`s.
 *
 * @param text - the string to wrap
 * @param maxWidth - available width in the same units as `fontSize` (mm)
 * @param fontSize - font size in mm
 * @param maxLines - hard cap on the number of lines
 * @returns the lines to render (length ≤ `maxLines`)
 */
export function wrapLabelText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number
): string[] {
  const maxChars = Math.max(
    1,
    Math.floor(maxWidth / (fontSize * GLYPH_ADVANCE))
  );
  // Truncate an over-long line with an ellipsis (covers single words wider than
  // the column, and the final line absorbing all the remaining words).
  const clamp = (s: string): string =>
    s.length > maxChars
      ? `${s.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
      : s;

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const candidate = current ? `${current} ${words[i]}` : words[i];
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (lines.length === maxLines - 1) {
      // On the last allowed line: collect every remaining word; clamp() will
      // ellipsize if it overflows the column.
      current = words.slice(i).join(" ");
      break;
    }
    current = words[i];
  }
  if (current) lines.push(current);

  return lines.slice(0, maxLines).map(clamp);
}

/** Emits the QR `<rect>` modules scaled into a square of `side` at (ox, oy). */
function qrRects(
  dark: boolean[][],
  count: number,
  side: number,
  ox: number,
  oy: number
): string {
  const scale = side / (count + QUIET_ZONE * 2);
  // Tiny bleed (+2%) so adjacent modules don't show hairline anti-alias seams.
  const m = n(scale * 1.02);
  let rects = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (dark[r][c]) {
        rects += `<rect x="${n(ox + (QUIET_ZONE + c) * scale)}" y="${n(
          oy + (QUIET_ZONE + r) * scale
        )}" width="${m}" height="${m}"/>`;
      }
    }
  }
  return rects;
}

/**
 * Builds a print-ready label SVG sized to a physical `stock`, filling it
 * edge-to-edge with the layout that fits the stock's shape:
 *  - **wide** (aspect ≥ 1.2): QR square on the left, name + id + brand stacked
 *    and left-aligned on the right.
 *  - **square / tall**: QR centered on top, name + id + brand centered below.
 *
 * The `viewBox` is the stock's mm dimensions, so the consumer prints it at the
 * exact label size with no letterboxing or stretching.
 *
 * @returns a complete `<svg>…</svg>` string at the stock's aspect ratio
 */
export function buildFittedLabelSvg({
  url,
  title,
  idText,
  showBranding,
  stock,
  showName = true,
  ec = DEFAULT_EC,
}: {
  url: string;
  title: string;
  idText: string;
  showBranding: boolean;
  stock: LabelStock;
  /**
   * When `false`, the asset name is omitted (just QR + id + branding). Frees
   * space — the QR grows on square stock and the id can't be crowded — so it's
   * the escape hatch for tiny labels and very long names.
   */
  showName?: boolean;
  ec?: ErrorCorrectionLevel;
}): string {
  const { count, dark } = qrDarkModules(url, ec);
  const W = stock.widthMm;
  const H = stock.heightMm;
  const pad = n(Math.min(W, H) * 0.08);
  const gap = pad;
  const wide = W / H >= 1.2;

  let qr = "";
  let texts = "";

  if (wide) {
    // QR fills the height; text column takes the remaining width.
    const side = n(Math.min(H - pad * 2, W * 0.6));
    const qrY = n((H - side) / 2);
    qr = qrRects(dark, count, side, pad, qrY);

    const tx = n(pad + side + gap);
    const tw = n(W - tx - pad);
    const nameFs = n(H * 0.16);
    const idFs = n(nameFs * 0.82);
    const brand = showBranding ? brandLine(tw, nameFs * 0.62) : null;

    const nameLines = showName ? wrapLabelText(title, tw, nameFs, 2) : [];
    const idLine = wrapLabelText(idText, tw, idFs, 1)[0] ?? "";
    const lineH = n(nameFs * 1.12);
    // Center the name+id block in the space ABOVE the bottom-pinned brand line.
    const brandReserve = brand ? n(brand.fs * 1.5) : 0;
    const blockH = n(nameLines.length * lineH + idFs * 1.3);
    let y = n((H - brandReserve - blockH) / 2 + nameFs * 0.92);
    nameLines.forEach((l) => {
      texts += `<text x="${tx}" y="${n(
        y
      )}" font-size="${nameFs}" font-weight="700" fill="#101828">${escapeXml(
        l
      )}</text>`;
      y = n(y + lineH);
    });
    texts += `<text x="${tx}" y="${n(
      y + idFs * 0.2
    )}" font-size="${idFs}" fill="#344054">${escapeXml(idLine)}</text>`;
    if (brand) {
      texts += `<text x="${tx}" y="${n(H - pad)}" font-size="${
        brand.fs
      }" fill="#475467">${escapeXml(brand.text)}</text>`;
    }
  } else {
    // QR on top (centered), text centered below.
    const nameFs = n(W * 0.11);
    const idFs = n(nameFs * 0.82);
    const brand = showBranding ? brandLine(W - pad * 2, nameFs * 0.7) : null;
    const nameLines = showName
      ? wrapLabelText(title, W - pad * 2, nameFs, 2)
      : [];
    const idLine = wrapLabelText(idText, W - pad * 2, idFs, 1)[0] ?? "";
    const lineH = n(nameFs * 1.12);
    const textBlockH = n(
      nameLines.length * lineH + idFs * 1.4 + (brand ? brand.fs * 1.6 : 0)
    );
    const side = n(Math.min(W - pad * 2, H - pad * 2 - textBlockH - gap));
    const qrX = n((W - side) / 2);
    qr = qrRects(dark, count, side, qrX, pad);

    const cx = n(W / 2);
    let y = n(pad + side + gap + nameFs * 0.9);
    nameLines.forEach((l) => {
      texts += `<text x="${cx}" y="${n(
        y
      )}" font-size="${nameFs}" font-weight="700" text-anchor="middle" fill="#101828">${escapeXml(
        l
      )}</text>`;
      y = n(y + lineH);
    });
    texts += `<text x="${cx}" y="${n(
      y + idFs * 0.2
    )}" font-size="${idFs}" text-anchor="middle" fill="#344054">${escapeXml(
      idLine
    )}</text>`;
    if (brand) {
      texts += `<text x="${cx}" y="${n(H - pad)}" font-size="${
        brand.fs
      }" text-anchor="middle" fill="#475467">${escapeXml(brand.text)}</text>`;
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" ` +
    `width="${n(W)}mm" height="${n(H)}mm" shape-rendering="crispEdges" ` +
    `font-family="Inter, Arial, sans-serif">` +
    `<rect width="${n(W)}" height="${n(H)}" fill="#ffffff"/>` +
    `<g fill="#000000">${qr}</g>` +
    texts +
    `</svg>`
  );
}

/**
 * Fitted label as a vector `data:` URL — for React `<img>` surfaces (stock
 * preview / print) that need the exact artifact the download produces.
 *
 * @returns `data:image/svg+xml;utf8,<encoded svg>`
 */
export const fittedLabelSvgDataUrl = (
  args: Parameters<typeof buildFittedLabelSvg>[0]
): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(buildFittedLabelSvg(args))}`;

/**
 * Phone-camera floor: a printed QR module narrower than this (mm) is hard for a
 * phone to scan at a normal distance. ~0.4 mm is a conservative mobile floor.
 */
export const MODULE_MM_PHONE_FLOOR = 0.4;
/**
 * Dedicated-scanner floor: below this even a close/macro scan is unreliable on
 * any device. ~0.25 mm is about the limit for a 2D imager.
 */
export const MODULE_MM_SCANNER_FLOOR = 0.25;

/**
 * The QR side (mm) the fitted layout will use for a stock — mirrors the geometry
 * in {@link buildFittedLabelSvg} so the warning matches what actually prints.
 * The square/tall estimate is conservative (QR shares the label with text).
 */
export function estimateQrSideMm(stock: LabelStock): number {
  const { widthMm: W, heightMm: H } = stock;
  const pad = Math.min(W, H) * 0.08;
  const wide = W / H >= 1.2;
  return wide
    ? Math.min(H - pad * 2, W * 0.6)
    : (Math.min(W, H) - pad * 2) * 0.6;
}

/** How comfortably a printed QR is expected to scan on the common device. */
export type ScannabilityLevel = "good" | "tight" | "risky";

/** The result of {@link assessLabelScannability}. */
export type ScannabilityAssessment = {
  /** Physical width of one QR module, in mm. */
  moduleMm: number;
  /** Modules per side (QR data area) for this URL + EC. */
  moduleCount: number;
  /** Estimated printed QR size, in mm. */
  qrSideMm: number;
  /** `good` = phone-friendly, `tight` = close scan / scanner, `risky` = likely too small. */
  level: ScannabilityLevel;
};

/**
 * Estimates whether a QR printed for `stock` will scan comfortably.
 *
 * The metric is the PHYSICAL module size (mm), deliberately DPI-independent: the
 * binding constraint is the reading device's optics, not the printer. A high-DPI
 * printer renders a tiny module sharply, but a phone camera still can't resolve
 * it at arm's length — while a dedicated 2D scanner can. So we grade for the
 * common case (phone), and the UI offers escape hatches (bigger stock, id-only,
 * a denser Data Matrix, or pre-printed labels) instead of blocking the print.
 */
export function assessLabelScannability(
  url: string,
  stock: LabelStock,
  ec: ErrorCorrectionLevel = DEFAULT_EC
): ScannabilityAssessment {
  const moduleCount = qrDarkModules(url, ec).count;
  const qrSideMm = estimateQrSideMm(stock);
  // The rendered module width is side / (count + quiet zone) — see qrRects().
  const moduleMm = qrSideMm / (moduleCount + QUIET_ZONE * 2);
  const level: ScannabilityLevel =
    moduleMm >= MODULE_MM_PHONE_FLOOR
      ? "good"
      : moduleMm >= MODULE_MM_SCANNER_FLOOR
      ? "tight"
      : "risky";
  return { moduleMm, moduleCount, qrSideMm, level };
}

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

----------------------------------------------------------------------
ABOUT PRINT QUALITY
  These files are yours to print on whatever printer and label software
  you have. How a label comes out — and whether it scans — depends on
  your printer, its resolution, and your settings, so ALWAYS print one
  and scan it before printing a batch.

  Want labels that arrive ready to scan? Order pre-printed, durable,
  already-linked Shelf labels at https://store.shelf.nu
----------------------------------------------------------------------
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

/**
 * Like {@link buildLabelZipEntries}, but every `.svg` is a {@link buildFittedLabelSvg}
 * sized to a chosen physical `stock` — so the files drop straight onto the
 * user's label stock at the right shape (no resizing in their label software).
 *
 * @returns array of `{ path, content }`; the svgs carry the stock's mm dimensions
 */
export function buildFittedLabelZipEntries({
  assets,
  qrBaseUrl,
  showBranding,
  stock,
  showName = true,
  ec = DEFAULT_EC,
}: {
  assets: LabelAsset[];
  qrBaseUrl: string;
  showBranding: boolean;
  stock: LabelStock;
  showName?: boolean;
  ec?: ErrorCorrectionLevel;
}): ZipEntry[] {
  const entries: ZipEntry[] = assets.map((a) => ({
    path: `qr-codes/${labelFileName(a)}`,
    content: buildFittedLabelSvg({
      url: qrScanUrl(qrBaseUrl, a.qrId),
      title: a.title,
      idText: a.idText,
      showBranding,
      stock,
      showName,
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
