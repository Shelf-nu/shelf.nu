/**
 * QR Label — pure, client-safe label generation
 *
 * Single source of truth for turning an asset's resolved code data into a
 * print-ready **vector** label. Three consumers share it:
 *  - the plain-paper / label-sheet print journey (`<QrLabelSheet>`)
 *  - the label-printer journey (`<QrLabelStockSheet>`) and its SVG zip
 *  - the single-asset code preview / PNG download (`code-preview.tsx`)
 *
 * Design notes:
 *  - **Vector only.** The QR is ONE `<path>` of run-length-encoded dark
 *    modules from `qrcode-generator`'s matrix. A path is ~6x smaller than one
 *    `<rect>` per module, which matters because a bulk export can mount 1,500
 *    labels as `data:` URLs in the DOM.
 *  - **Minimize module count.** Version is auto-selected (`qrcode(0, ...)` picks
 *    the lowest that fits) and EC defaults to `L` — the largest modules, which is
 *    what scans on a small label at low printer DPI. Higher EC ⇒ more modules ⇒
 *    smaller modules ⇒ worse at small physical sizes; treat EC as an empirical
 *    print-tested choice, not a durability default.
 *  - **One geometry.** {@link fittedLabelGeometry} decides where the QR and the
 *    text go for a physical label size; the renderer and the scannability
 *    check both read it, so the warning always describes what prints.
 *  - Pure + client-safe: no `.server` imports, no DB, no side effects. Safe to
 *    call from a loader or a browser component, and to unit-test directly.
 *
 * @see {@link file://./../../components/assets/qr-label-sheet.tsx}
 * @see {@link file://./../../components/assets/qr-label-stock-sheet.tsx}
 * @see {@link file://./../../components/assets/bulk-download-qr-dialog.tsx}
 * @see {@link file://./../../routes/api+/assets.get-assets-for-bulk-qr-download.ts}
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
 * QR we draw, so the render paths can never diverge.
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

/** Round to 3dp so the SVG stays compact and deterministic across runs. */
const n = (x: number): number => Math.round(x * 1000) / 1000;

/** Approx mean glyph advance for Inter as a fraction of font-size. */
const GLYPH_ADVANCE = 0.58;

/** The free-tier branding mark printed on labels. */
const BRAND_TEXT = "Powered by shelf.nu";

/**
 * Serializes the dark modules as ONE SVG path, run-length encoded per row:
 * each horizontal run of dark modules becomes `M x y h w v h h -w z`. Adjacent
 * runs overlap by 2% so rasterizers never show hairline seams between rows.
 *
 * @param dark - module matrix from {@link qrDarkModules}
 * @param count - modules per side
 * @param scale - size of one module in the caller's units
 * @param ox - x of the label's QR area (quiet zone starts here)
 * @param oy - y of the label's QR area
 * @returns the `d` attribute of a `<path>`
 */
export function qrModulesPath(
  dark: boolean[][],
  count: number,
  scale: number,
  ox: number,
  oy: number
): string {
  // 0.01 mm precision is far below any printer's dot pitch and keeps the path
  // short; the 2% bleed hides hairline seams between rows.
  const p = (x: number): number => Math.round(x * 100) / 100;
  const bleed = scale * 0.02;
  const h = p(scale + bleed);
  const parts: string[] = [];
  for (let r = 0; r < count; r++) {
    const row = dark[r];
    let c = 0;
    while (c < count) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < count && row[c]) c++;
      const w = p((c - start) * scale + bleed);
      parts.push(
        `M${p(ox + (QUIET_ZONE + start) * scale)} ${p(
          oy + (QUIET_ZONE + r) * scale
        )}h${w}v${h}h-${w}z`
      );
    }
  }
  return parts.join("");
}

/**
 * Greedy word-wrap that fits `text` into at most `maxLines` lines no wider than
 * `maxWidth`, ellipsizing the final line on overflow. SVG `<text>` does not
 * wrap, so we compute the line breaks ourselves and emit one `<text>` per line.
 *
 * @param text - the string to wrap
 * @param maxWidth - available width in the same units as `fontSize`
 * @param fontSize - font size
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

/**
 * Builds a standalone, self-contained **vector** label SVG in the QR's own
 * module units: the QR (with quiet zone) + asset name (up to 2 lines) +
 * identifier text + optional "Powered by shelf.nu". Its height follows the
 * text, so it is the natural shape for the single-asset preview and PNG
 * download. Labels that must fill a physical size use
 * {@link buildFittedLabelSvg}.
 *
 * @returns a complete `<svg>…</svg>` string
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
  const titleSize = n(Math.max(2, qrSize * 0.085));
  const idSize = n(titleSize * 0.85);
  const gap = n(qrSize * 0.06);
  const lineH = n(titleSize * 1.12);
  const titleLines = wrapLabelText(title, qrSize - 1, titleSize, 2);
  const titleY = n(qrSize + gap + titleSize);
  const idY = n(titleY + (titleLines.length - 1) * lineH + idSize * 1.3);
  const brandSize = n(idSize * 0.8);
  const brandY = n(idY + brandSize * 1.5);
  const totalH = n((showBranding ? brandY : idY) + gap);
  const cx = n(qrSize / 2);

  const titles = titleLines
    .map(
      (line, i) =>
        `<text x="${cx}" y="${n(
          titleY + i * lineH
        )}" font-size="${titleSize}" font-weight="700" text-anchor="middle" fill="#101828">${escapeXml(
          line
        )}</text>`
    )
    .join("");

  const brand = showBranding
    ? `<text x="${cx}" y="${brandY}" font-size="${brandSize}" text-anchor="middle" fill="#475467">${BRAND_TEXT}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qrSize} ${totalH}" ` +
    `width="${qrSize}" height="${totalH}" shape-rendering="crispEdges" ` +
    `font-family="Inter, Arial, sans-serif">` +
    `<rect width="${qrSize}" height="${totalH}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${qrModulesPath(dark, count, 1, 0, 0)}"/>` +
    titles +
    `<text x="${cx}" y="${idY}" font-size="${idSize}" text-anchor="middle" fill="#344054">${escapeXml(
      idText
    )}</text>` +
    brand +
    `</svg>`
  );
}

/** UTF-8 safe base64, in node (tests, loaders) and in the browser. */
const toBase64 = (s: string): string => {
  const nodeBuffer = (
    globalThis as {
      Buffer?: {
        from(v: string, enc: string): { toString(enc: string): string };
      };
    }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(s, "utf8").toString("base64");
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/**
 * Wraps an SVG string as a base64 `data:` URL. Base64 costs 1.33x the SVG,
 * percent-encoding costs ~1.7x because every `<`, `"`, `=` and `/` expands.
 *
 * @returns `data:image/svg+xml;base64,…`
 */
export const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml;base64,${toBase64(svg)}`;

/**
 * Same label as {@link buildLabelSvg}, as a vector `data:` URL — so React
 * surfaces render the EXACT artifact the download produces, via one `<img>`.
 */
export const labelSvgDataUrl = (
  args: Parameters<typeof buildLabelSvg>[0]
): string => svgDataUrl(buildLabelSvg(args));

/* ---------------------------------------------------------------------------
 * Fitted labels — a label that fills a physical size edge-to-edge.
 *
 * `buildLabelSvg` above produces ONE natural shape — a portrait card whose
 * height grows with the stacked text. Dropped onto a wide thermal label
 * (e.g. a 2"×1" WASP/Brother stock) it either letterboxes to a tiny QR or, if
 * the driver stretches to fill, distorts the modules so the code stops
 * scanning.
 *
 * The functions below render a label whose `viewBox` aspect EQUALS the physical
 * size, and pick the layout that fits the shape: QR-left / text-right for wide
 * labels, QR-on-top / text-below for square or tall ones. The same primitive
 * serves label-printer stock, plain-paper cut labels and pre-cut sheet
 * templates — only the size differs.
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

/**
 * Sizes the branding line so it always fits `width`: shrinks the font to fit
 * when needed (never overflows the label edge) so the mark is always rendered
 * in full — it is a revenue surface and must never read as a half-word.
 *
 * @returns the font size (mm) and the text to render
 */
function brandLine(
  width: number,
  desiredFs: number
): { fs: number; text: string } {
  // Largest font at which the full mark fits the width (0.97 keeps it off the
  // right edge).
  const fitFs = (width / (BRAND_TEXT.length * GLYPH_ADVANCE)) * 0.97;
  return { fs: n(Math.min(desiredFs, fitFs)), text: BRAND_TEXT };
}

/** Everything the fitted renderer needs to place the QR and the text. */
export type FittedLabelGeometry = {
  /** `true` = QR on the left, text on the right; `false` = stacked. */
  wide: boolean;
  /** Inner padding, mm. */
  pad: number;
  /** Printed QR side incl. quiet zone, mm. */
  qrSideMm: number;
  /** Top-left of the QR area, mm. */
  qrX: number;
  qrY: number;
  /** Text column x (wide) or centre x (stacked), mm. */
  textX: number;
  /** Available text width, mm. */
  textWidth: number;
  /** Font sizes, mm. */
  nameFs: number;
  idFs: number;
  /** Baseline pitch between name lines, mm. */
  lineH: number;
  /** Baseline of the first name line (or of the id when there is no name). */
  firstBaseline: number;
  /** Branding line, or `null` when the tier hides it. */
  brand: { fs: number; text: string; y: number } | null;
};

/**
 * Places the QR and the text for a physical label. This is the ONE place that
 * knows the layout rules, so {@link buildFittedLabelSvg} and
 * {@link assessLabelScannability} cannot disagree about how big the QR is.
 *
 * Wide labels (aspect ≥ 1.2) put the QR on the left at the full height; the
 * text column takes the rest. Square or tall labels stack: the QR takes what
 * is left above the text block, so removing the name grows the QR.
 *
 * @param args.stock - physical size
 * @param args.nameLineCount - how many name lines the text block reserves (0–2)
 * @param args.showBranding - whether the branding line takes space
 * @returns the geometry, all in mm
 */
export function fittedLabelGeometry({
  stock,
  nameLineCount,
  showBranding,
}: {
  stock: Pick<LabelStock, "widthMm" | "heightMm">;
  nameLineCount: number;
  showBranding: boolean;
}): FittedLabelGeometry {
  const W = stock.widthMm;
  const H = stock.heightMm;
  const wide = W / H >= 1.2;
  // Stacked labels are the small square stocks; a tighter inset keeps the QR
  // as large as the die-cut allows.
  const pad = n(Math.min(W, H) * (wide ? 0.08 : 0.05));
  const gap = pad;

  if (wide) {
    // The QR takes the full height but never more than half the width, so the
    // text column stays wide enough to read on labels that are only just wide.
    const side = n(Math.min(H - pad * 2, W * 0.5));
    const qrY = n((H - side) / 2);
    const textX = n(pad + side + gap);
    const textWidth = n(W - textX - pad);
    // Name size follows the label height, capped so at least ten characters
    // fit per line; a 4-character column reads as a bug, not a label.
    const nameFs = n(Math.min(H * 0.16, textWidth / (10 * GLYPH_ADVANCE)));
    const idFs = n(nameFs * 0.82);
    const lineH = n(nameFs * 1.12);
    const brandFit = showBranding ? brandLine(textWidth, nameFs * 0.62) : null;
    const brandReserve = brandFit ? n(brandFit.fs * 1.5) : 0;
    // Centre the name+id block in the space ABOVE the bottom-pinned brand line.
    const blockH = n(nameLineCount * lineH + idFs * 1.3);
    const firstBaseline = n((H - brandReserve - blockH) / 2 + nameFs * 0.92);
    return {
      wide,
      pad,
      qrSideMm: side,
      qrX: pad,
      qrY,
      textX,
      textWidth,
      nameFs,
      idFs,
      lineH,
      firstBaseline,
      brand: brandFit ? { ...brandFit, y: n(H - pad) } : null,
    };
  }

  const textWidth = n(W - pad * 2);
  const nameFs = n(W * 0.11);
  const idFs = n(nameFs * 0.82);
  const lineH = n(nameFs * 1.12);
  const brandFit = showBranding ? brandLine(textWidth, nameFs * 0.7) : null;
  const textBlockH = n(
    nameLineCount * lineH + idFs * 1.4 + (brandFit ? brandFit.fs * 1.6 : 0)
  );
  const side = n(Math.min(W - pad * 2, H - pad * 2 - textBlockH - gap));
  return {
    wide,
    pad,
    qrSideMm: side,
    qrX: n((W - side) / 2),
    qrY: pad,
    textX: n(W / 2),
    textWidth,
    nameFs,
    idFs,
    lineH,
    firstBaseline: n(pad + side + gap + nameFs * 0.9),
    brand: brandFit ? { ...brandFit, y: n(H - pad) } : null,
  };
}

/**
 * Builds a print-ready label SVG sized to a physical `stock`, filling it
 * edge-to-edge with the layout from {@link fittedLabelGeometry}. The `viewBox`
 * is the stock's mm dimensions, so the consumer prints it at the exact label
 * size with no letterboxing or stretching.
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
  stock: Pick<LabelStock, "widthMm" | "heightMm">;
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

  // Wrap with a provisional geometry (2 lines reserved), then lay out with the
  // real line count so a one-line name does not leave a hole.
  const probe = fittedLabelGeometry({ stock, nameLineCount: 2, showBranding });
  const nameLines = showName
    ? wrapLabelText(title, probe.textWidth, probe.nameFs, 2)
    : [];
  const g = fittedLabelGeometry({
    stock,
    nameLineCount: nameLines.length,
    showBranding,
  });

  const scale = g.qrSideMm / (count + QUIET_ZONE * 2);
  const path = qrModulesPath(dark, count, scale, g.qrX, g.qrY);
  const anchor = g.wide ? "" : ` text-anchor="middle"`;

  let texts = "";
  let y = g.firstBaseline;
  nameLines.forEach((line) => {
    texts += `<text x="${g.textX}" y="${n(y)}" font-size="${
      g.nameFs
    }" font-weight="700"${anchor} fill="#101828">${escapeXml(line)}</text>`;
    y = n(y + g.lineH);
  });
  const idLine = wrapLabelText(idText, g.textWidth, g.idFs, 1)[0] ?? "";
  texts += `<text x="${g.textX}" y="${n(y + g.idFs * 0.2)}" font-size="${
    g.idFs
  }"${anchor} fill="#344054">${escapeXml(idLine)}</text>`;
  if (g.brand) {
    texts += `<text x="${g.textX}" y="${g.brand.y}" font-size="${
      g.brand.fs
    }"${anchor} fill="#475467">${escapeXml(g.brand.text)}</text>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" ` +
    `width="${n(W)}mm" height="${n(H)}mm" shape-rendering="crispEdges" ` +
    `font-family="Inter, Arial, sans-serif">` +
    `<rect width="${n(W)}" height="${n(H)}" fill="#ffffff"/>` +
    `<path fill="#000000" d="${path}"/>` +
    texts +
    `</svg>`
  );
}

/**
 * Fitted label as a vector `data:` URL — for React `<img>` surfaces (preview /
 * print) that need the exact artifact the download produces.
 */
export const fittedLabelSvgDataUrl = (
  args: Parameters<typeof buildFittedLabelSvg>[0]
): string => svgDataUrl(buildFittedLabelSvg(args));

/**
 * Phone-camera floor: a printed QR module narrower than this (mm) is hard for a
 * phone to scan at a normal distance. ~0.4 mm is a conservative mobile floor.
 */
export const MODULE_MM_PHONE_FLOOR = 0.4;
/**
 * Close-scan floor: between this and the phone floor a phone still reads the
 * code held close, and a dedicated 2D imager reads it easily. Below it the
 * print is unreliable on any device.
 */
export const MODULE_MM_SCANNER_FLOOR = 0.3;

/** How comfortably a printed QR is expected to scan on the common device. */
export type ScannabilityLevel = "good" | "tight" | "risky";

/** The result of {@link assessLabelScannability}. */
export type ScannabilityAssessment = {
  /** Physical width of one QR module, in mm. */
  moduleMm: number;
  /** Modules per side (QR data area) for this URL + EC. */
  moduleCount: number;
  /** Printed QR size incl. quiet zone, in mm. */
  qrSideMm: number;
  /** `good` = phone-friendly, `tight` = close scan / scanner, `risky` = likely too small. */
  level: ScannabilityLevel;
};

/**
 * Estimates whether a QR printed for `stock` will scan comfortably, using the
 * SAME geometry the renderer uses, so the grade matches what prints.
 *
 * The metric is the PHYSICAL module size (mm), deliberately DPI-independent: the
 * binding constraint is the reading device's optics, not the printer. A high-DPI
 * printer renders a tiny module sharply, but a phone camera still can't resolve
 * it at arm's length — while a dedicated 2D scanner can. So we grade for the
 * common case (phone), and the UI offers escape hatches (bigger stock, id-only,
 * or pre-printed labels) instead of blocking the print.
 *
 * With a name shown, the check reserves two name lines — the worst case across
 * a batch — so one short name in the preview cannot hide a risk for the rest.
 */
export function assessLabelScannability(
  url: string,
  stock: Pick<LabelStock, "widthMm" | "heightMm">,
  {
    showName = true,
    showBranding = true,
    ec = DEFAULT_EC,
  }: {
    showName?: boolean;
    showBranding?: boolean;
    ec?: ErrorCorrectionLevel;
  } = {}
): ScannabilityAssessment {
  const moduleCount = qrDarkModules(url, ec).count;
  const { qrSideMm } = fittedLabelGeometry({
    stock,
    nameLineCount: showName ? 2 : 0,
    showBranding,
  });
  // The rendered module width is side / (count + quiet zone) — see qrModulesPath().
  const moduleMm = qrSideMm / (moduleCount + QUIET_ZONE * 2);
  const level: ScannabilityLevel =
    moduleMm >= MODULE_MM_PHONE_FLOOR
      ? "good"
      : moduleMm >= MODULE_MM_SCANNER_FLOOR
      ? "tight"
      : "risky";
  return { moduleMm, moduleCount, qrSideMm, level };
}

/* ---------------------------------------------------------------------------
 * Sheets — paper pages carrying many labels at exact millimetre positions.
 *
 * A {@link SheetSpec} describes a page: its paper, the label size, the grid
 * (cols × rows), the top/left margin of the first label and the pitch between
 * labels. Pre-cut sticker sheets (Avery and compatibles) are constants; plain
 * paper derives a spec from the paper and the chosen label size. Either way
 * {@link layoutSheetPages} turns a spec + a count into page-by-page positions.
 * ------------------------------------------------------------------------- */

/** Paper sizes the print journeys support. */
export type PaperKey = "a4" | "letter";

/** Paper presets — dimensions in mm + the CSS `@page size` keyword. */
export const PAPER_SIZES: Record<
  PaperKey,
  { wMm: number; hMm: number; page: string; label: string }
> = {
  a4: { wMm: 210, hMm: 297, page: "A4", label: "A4" },
  letter: { wMm: 215.9, hMm: 279.4, page: "letter", label: "Letter" },
};

/** A page layout: where each label sits, in mm from the page's top-left. */
export type SheetSpec = {
  /** Stable id used in state (`plain-a4-medium`, `avery-l7160`). */
  id: string;
  /** Short name for the picker, e.g. `Avery L7160`. */
  label: string;
  /** Second line in the picker: label size and count per sheet. */
  detail?: string;
  paper: PaperKey;
  /** One label's size, mm. */
  labelWidthMm: number;
  labelHeightMm: number;
  cols: number;
  rows: number;
  /** Top-left corner of the first label, mm from the page edge. */
  topMm: number;
  leftMm: number;
  /** Distance from one label's left/top edge to the next one's, mm. */
  pitchXMm: number;
  pitchYMm: number;
  /** Where the numbers come from (pre-cut templates only). */
  source?: string;
};

/**
 * Pre-cut sticker sheet templates. Sizes are Avery's; margins and pitch are the
 * values from Avery's own sheet data (Letter, in inches → mm) and Avery's Word
 * templates (A4). Pitch is what keeps a whole column aligned; a 0.3 mm margin
 * difference between sources stays inside the 1 mm inset the sheet renders.
 */
export const SHEET_TEMPLATES: Record<string, SheetSpec> = {
  "avery-l7160": {
    id: "avery-l7160",
    label: "Avery L7160",
    detail: "63.5 × 38.1 mm · 21 per sheet",
    paper: "a4",
    labelWidthMm: 63.5,
    labelHeightMm: 38.1,
    cols: 3,
    rows: 7,
    topMm: 15.15,
    leftMm: 7.2,
    pitchXMm: 66.04,
    pitchYMm: 38.1,
    source: "https://www.avery.co.uk/template-l7160",
  },
  "avery-l7163": {
    id: "avery-l7163",
    label: "Avery L7163",
    detail: "99.1 × 38.1 mm · 14 per sheet",
    paper: "a4",
    labelWidthMm: 99.06,
    labelHeightMm: 38.1,
    cols: 2,
    rows: 7,
    topMm: 15.15,
    leftMm: 4.65,
    pitchXMm: 101.6,
    pitchYMm: 38.1,
    source: "https://www.avery.co.uk/template-l7163",
  },
  "avery-l7651": {
    id: "avery-l7651",
    label: "Avery L7651",
    detail: "38.1 × 21.2 mm · 65 per sheet",
    paper: "a4",
    labelWidthMm: 38.1,
    labelHeightMm: 21.17,
    cols: 5,
    rows: 13,
    topMm: 10.9,
    leftMm: 4.75,
    pitchXMm: 40.64,
    pitchYMm: 21.17,
    source: "https://www.avery.co.uk/template-l7651",
  },
  "avery-5160": {
    id: "avery-5160",
    label: "Avery 5160",
    detail: "2⅝ × 1 in · 30 per sheet",
    paper: "letter",
    labelWidthMm: 66.675,
    labelHeightMm: 25.4,
    cols: 3,
    rows: 10,
    topMm: 12.7,
    leftMm: 4.7752,
    pitchXMm: 69.85,
    pitchYMm: 25.4,
    source: "https://www.avery.com/templates/5160",
  },
  "avery-5163": {
    id: "avery-5163",
    label: "Avery 5163",
    detail: "4 × 2 in · 10 per sheet",
    paper: "letter",
    labelWidthMm: 101.6,
    labelHeightMm: 50.8,
    cols: 2,
    rows: 5,
    topMm: 12.7,
    leftMm: 4.318,
    pitchXMm: 105.664,
    pitchYMm: 50.8,
    source: "https://www.avery.com/templates/5163",
  },
  "avery-5167": {
    id: "avery-5167",
    label: "Avery 5167",
    detail: "1¾ × ½ in · 80 per sheet",
    paper: "letter",
    labelWidthMm: 44.45,
    labelHeightMm: 12.7,
    cols: 4,
    rows: 20,
    topMm: 12.7,
    leftMm: 7.62,
    pitchXMm: 52.07,
    pitchYMm: 12.7,
    source: "https://www.avery.com/templates/5167",
  },
};

/** Default template — the most common address label on each paper. */
export const DEFAULT_SHEET_TEMPLATE_ID: Record<PaperKey, string> = {
  a4: "avery-l7160",
  letter: "avery-5160",
};

/** Plain-paper label sizes, named by the LABEL (what you cut out), not the QR. */
export type PlainLabelSizeKey = "small" | "medium" | "large";

/** Plain-paper label sizes, mm. All are wide, so the QR sits left of the text. */
export const PLAIN_LABEL_SIZES: Record<
  PlainLabelSizeKey,
  { label: string; widthMm: number; heightMm: number }
> = {
  small: { label: "Small", widthMm: 30, heightMm: 20 },
  medium: { label: "Medium", widthMm: 45, heightMm: 30 },
  large: { label: "Large", widthMm: 60, heightMm: 40 },
};

/** Printable margin kept on plain paper (most home printers cannot print closer). */
const PLAIN_SHEET_MARGIN_MM = 10;
/** Gap between cut labels, so scissors have somewhere to go. */
const PLAIN_SHEET_GAP_MM = 4;

/**
 * Derives a sheet layout for plain paper: as many labels of the chosen size as
 * fit inside the printable margin, centred on the page.
 *
 * @param paper - paper size
 * @param size - plain label size key
 * @returns a {@link SheetSpec} for {@link layoutSheetPages}
 */
export function plainSheetSpec(
  paper: PaperKey,
  size: PlainLabelSizeKey
): SheetSpec {
  const p = PAPER_SIZES[paper];
  const s = PLAIN_LABEL_SIZES[size];
  const usableW = p.wMm - PLAIN_SHEET_MARGIN_MM * 2;
  const usableH = p.hMm - PLAIN_SHEET_MARGIN_MM * 2;
  const pitchX = s.widthMm + PLAIN_SHEET_GAP_MM;
  const pitchY = s.heightMm + PLAIN_SHEET_GAP_MM;
  const cols = Math.max(1, Math.floor((usableW + PLAIN_SHEET_GAP_MM) / pitchX));
  const rows = Math.max(1, Math.floor((usableH + PLAIN_SHEET_GAP_MM) / pitchY));
  const gridW = cols * pitchX - PLAIN_SHEET_GAP_MM;
  const gridH = rows * pitchY - PLAIN_SHEET_GAP_MM;
  return {
    id: `plain-${paper}-${size}`,
    label: `${s.label} (${s.widthMm} × ${s.heightMm} mm)`,
    paper,
    labelWidthMm: s.widthMm,
    labelHeightMm: s.heightMm,
    cols,
    rows,
    topMm: n((p.hMm - gridH) / 2),
    leftMm: n((p.wMm - gridW) / 2),
    pitchXMm: pitchX,
    pitchYMm: pitchY,
  };
}

/** One label's slot on a page. */
export type SheetSlot = {
  /** Index into the assets array. */
  index: number;
  /** Top-left of the label, mm from the page's top-left. */
  xMm: number;
  yMm: number;
};

/**
 * Splits `count` labels across pages of `spec`, row-major, and returns each
 * label's position. The last page is partial.
 *
 * @returns pages; each page is the list of slots it carries (never empty)
 */
export function layoutSheetPages(
  spec: SheetSpec,
  count: number
): SheetSlot[][] {
  const perPage = spec.cols * spec.rows;
  const pages: SheetSlot[][] = [];
  for (let index = 0; index < count; index++) {
    const onPage = index % perPage;
    if (onPage === 0) pages.push([]);
    const col = onPage % spec.cols;
    const row = Math.floor(onPage / spec.cols);
    pages[pages.length - 1].push({
      index,
      xMm: n(spec.leftMm + col * spec.pitchXMm),
      yMm: n(spec.topMm + row * spec.pitchYMm),
    });
  }
  return pages;
}

/* ---------------------------------------------------------------------------
 * Zip journey — files for the user's own label software.
 * ------------------------------------------------------------------------- */

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
