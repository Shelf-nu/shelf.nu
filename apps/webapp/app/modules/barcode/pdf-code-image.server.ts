/**
 * PDF Code Pictures (server)
 *
 * Draws the picture printed for each row's code on the booking checklist and
 * the audit receipt, following the code `resolveDisplayCode` has already
 * chosen for the row's text:
 *
 * - a barcode (Code 128, Code 39, EAN-13, DataMatrix, External QR) is drawn
 *   here from its value, as an SVG, with bwip-js, so the picture is the same
 *   code as the text;
 * - the QR id prints the asset's Shelf QR, rendered by `getQrCodeMaps`, which
 *   is the same code as the text;
 * - a SAM ID row (or a fallback to the QR) also prints the asset's Shelf QR.
 *   It resolves to the same asset, but it encodes the asset's QR link, not the
 *   SAM ID.
 *
 * Every picture is fitted to a scannable module width. It prints in the Code
 * cell at {@link PDF_CODE_MODULE_MM} per module when it fits, shrunk toward
 * {@link PDF_CODE_MIN_MODULE_MM} when that makes it fit, and otherwise on a
 * full-width line under its row, again preferred width first, then shrunk. A
 * row's code prints with no picture only when its symbology refuses the value
 * (an EAN-13 that is not 12 or 13 digits); a picture that does not scan is
 * worse than none.
 *
 * bwip-js is loaded on first use: the package pulls a 2 MB encoder that no
 * other server path needs.
 *
 * @see {@link file://./pdf-code-image.ts} the print geometry shared with the sheets
 * @see {@link file://./bwip-format.ts} the symbology map shared with the screen
 * @see {@link file://./display.ts} `resolveDisplayCode`
 */

import type * as BwipJsModule from "@bwip-js/browser";
import type { BarcodeType, Prisma } from "@prisma/client";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { BWIP_FORMAT, IS_TWO_DIMENSIONAL, isBarcodeType } from "./bwip-format";
import type { ResolvedDisplayCode } from "./display";
import {
  PDF_CODE_IMAGE_MAX_WIDTH_MM,
  PDF_CODE_LINE_MAX_WIDTH_MM,
  PDF_CODE_MIN_MODULE_MM,
  PDF_CODE_MODULE_MM,
  PDF_LINEAR_CODE_HEIGHT_MM,
  PDF_SQUARE_CODE_SIDE_MM,
} from "./pdf-code-image";
import type { PdfCodeImage } from "./pdf-code-image";
import { getQrCodeMaps } from "../qr/service.server";

type BwipJs = typeof BwipJsModule;

/** Cached import, so the encoder is loaded once per server process. */
let bwipjsPromise: Promise<BwipJs> | null = null;

/**
 * Loads bwip-js once. A failed load is not cached, so the next sheet retries.
 *
 * @returns The bwip-js module
 */
function loadBwipjs(): Promise<BwipJs> {
  if (!bwipjsPromise) {
    bwipjsPromise = import("@bwip-js/browser").catch((cause: unknown) => {
      bwipjsPromise = null;
      throw cause;
    });
  }
  return bwipjsPromise;
}

/**
 * Quiet zone on each side of a linear barcode, in modules. Scanners need this
 * blank margin to find where the code starts; EAN-13 asks for one more module
 * than Code 128 and Code 39.
 */
function quietZoneModules(type: BarcodeType): number {
  return type === "EAN13" ? 11 : 10;
}

/**
 * `viewBox` units bwip-js draws per module of a 2D symbol at scale 1. Linear
 * symbols get one unit per module; matrix symbols (QR, DataMatrix) get two.
 */
const MATRIX_UNITS_PER_MODULE = 2;

/**
 * Quiet zone on each side of a 2D code, in modules: the 4 modules the QR
 * specification asks for, and 2 for DataMatrix, whose specification asks for
 * at least 1.
 */
function matrixQuietZoneModules(type: BarcodeType): number {
  return type === "DataMatrix" ? 2 : 4;
}

/**
 * The bwip-js padding options that draw a code's quiet zone. bwip-js measures
 * padding in `viewBox` units, not modules, so a matrix code's quiet zone is
 * doubled to match its two units per module.
 */
function quietZoneOptions(type: BarcodeType): {
  paddingwidth: number;
  paddingheight?: number;
} {
  if (!IS_TWO_DIMENSIONAL[type]) {
    return { paddingwidth: quietZoneModules(type) };
  }
  const units = matrixQuietZoneModules(type) * MATRIX_UNITS_PER_MODULE;
  return { paddingwidth: units, paddingheight: units };
}

/** Where a code prints and how wide each of its modules prints. */
type CodeFit = { placement: PdfCodeImage["placement"]; moduleMm: number };

/**
 * Picks the module width for a code in one space: the preferred
 * {@link PDF_CODE_MODULE_MM} when the code fits at it, otherwise the width
 * that makes it fit exactly, as long as that is no thinner than
 * {@link PDF_CODE_MIN_MODULE_MM}.
 *
 * @param modules - The code's extent in modules, quiet zone included
 * @param maxMm - The widest the code may print in this space
 * @returns The module width in millimetres, or `null` when the code does not
 *   fit this space at a scannable width
 */
function fitModuleMm(modules: number, maxMm: number): number | null {
  if (modules * PDF_CODE_MODULE_MM <= maxMm) return PDF_CODE_MODULE_MM;
  const shrunk = maxMm / modules;
  return shrunk >= PDF_CODE_MIN_MODULE_MM ? shrunk : null;
}

/**
 * Fits a code to the sheet: the Code cell first, then the full-width line
 * under the row.
 *
 * @param modules - The code's extent in modules, quiet zone included (its
 *   width for a linear code, its side for a 2D one)
 * @param cellMaxMm - The widest the code may print in the Code cell
 * @returns Where the code prints and at what module width, or `null` when it
 *   does not fit even the line at {@link PDF_CODE_MIN_MODULE_MM}
 */
function fitCode(modules: number, cellMaxMm: number): CodeFit | null {
  const inCell = fitModuleMm(modules, cellMaxMm);
  if (inCell !== null) return { placement: "cell", moduleMm: inCell };
  const onLine = fitModuleMm(modules, PDF_CODE_LINE_MAX_WIDTH_MM);
  if (onLine !== null) return { placement: "line", moduleMm: onLine };
  return null;
}

/** Reads the `viewBox` width and height bwip-js writes on its SVG root. */
function readViewBox(svg: string): { width: number; height: number } | null {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** An SVG document as a data URL. Base64, because the SVG contains `#`. */
function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString(
    "base64"
  )}`;
}

/** Rounds a millimetre length for an SVG attribute. */
function mm(value: number): string {
  return `${Number(value.toFixed(3))}mm`;
}

/** Writes extra attributes onto an SVG document's root element. */
function withRootAttributes(svg: string, attributes: string): string {
  return svg.replace("<svg ", `<svg ${attributes} `);
}

/**
 * Draws one barcode as a picture for a printed sheet.
 *
 * Drawn at bwip-js scale 1 with its quiet zone, then fitted by
 * {@link fitCode}. A linear code's SVG declares its printed size on its root
 * (`width` = modules x the fitted module width, `height` =
 * {@link PDF_LINEAR_CODE_HEIGHT_MM}) and `preserveAspectRatio="none"`, so the
 * sheet prints it at exactly that size without knowing its module count. A 2D
 * code in the cell carries no size: the sheet prints it in its square, the
 * size of the Shelf QR. A 2D code on the line declares its side
 * (modules x the fitted module width) as both `width` and `height`.
 *
 * @param code - The barcode type and the value to encode
 * @param bwipjs - The loaded bwip-js module
 * @returns The picture, or `null` when the symbology refuses the value or the
 *   code does not fit even the full-width line at a scannable module width
 */
export function encodeBarcodeImage(
  { type, value }: { type: BarcodeType; value: string },
  bwipjs: Pick<BwipJs, "toSVG">
): PdfCodeImage | null {
  const isTwoDimensional = IS_TWO_DIMENSIONAL[type];

  let svg: string;
  try {
    svg = bwipjs.toSVG({
      bcid: BWIP_FORMAT[type],
      text: value,
      scale: 1,
      includetext: false,
      backgroundcolor: "ffffff",
      ...quietZoneOptions(type),
      ...(isTwoDimensional ? {} : { height: PDF_LINEAR_CODE_HEIGHT_MM }),
    });
  } catch {
    // The symbology refused the value (wrong length, character outside its
    // set). That is a fact about the data, not a fault: print the text only.
    return null;
  }

  const viewBox = readViewBox(svg);
  if (!viewBox) return null;

  if (isTwoDimensional) {
    const modules =
      Math.max(viewBox.width, viewBox.height) / MATRIX_UNITS_PER_MODULE;
    const fit = fitCode(modules, PDF_SQUARE_CODE_SIDE_MM);
    if (!fit) return null;
    if (fit.placement === "cell") {
      return { src: toSvgDataUrl(svg), shape: "square", placement: "cell" };
    }
    const side = mm(modules * fit.moduleMm);
    return {
      src: toSvgDataUrl(
        withRootAttributes(svg, `width="${side}" height="${side}"`)
      ),
      shape: "square",
      placement: "line",
    };
  }

  // A linear code is drawn one `viewBox` unit per module.
  const fit = fitCode(viewBox.width, PDF_CODE_IMAGE_MAX_WIDTH_MM);
  if (!fit) return null;

  return {
    src: toSvgDataUrl(
      withRootAttributes(
        svg,
        `width="${mm(viewBox.width * fit.moduleMm)}" height="${mm(
          PDF_LINEAR_CODE_HEIGHT_MM
        )}" preserveAspectRatio="none"`
      )
    ),
    shape: "linear",
    placement: fit.placement,
  };
}

/**
 * Barcodes drawn between yields to the event loop. A sheet of a few hundred
 * barcodes encodes synchronously; yielding every batch lets other requests on
 * the same server process run in between.
 */
const ENCODES_PER_YIELD = 25;

/** Lets queued I/O and other requests run before the next batch of encodes. */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/** An asset as `getQrCodeMaps` reads it: full columns plus its QR rows. */
type CodeImageAsset = Prisma.AssetGetPayload<{ include: { qrCodes: true } }>;

/**
 * Builds the picture for every asset on a printed sheet, keyed by `Asset.id`.
 *
 * Each asset's picture follows its already-resolved display code: a barcode
 * type is drawn from the barcode's value, everything else prints the Shelf QR.
 * `getQrCodeMaps` is called only for the assets whose picture is a QR, and not
 * at all when there are none.
 *
 * An asset without an entry prints its code as text only. That happens when
 * its symbology refuses the value (see {@link encodeBarcodeImage}), when a QR
 * could not be rendered, and for every barcode if bwip-js fails to load. The
 * Shelf QR always prints in the cell.
 *
 * @param args.assets - Each asset once (deduped by id), with its `qrCodes`
 * @param args.displayCodes - The resolved display code per asset id
 * @param args.userId - The acting user, forwarded to `getQrCodeMaps`
 * @param args.organizationId - The workspace, forwarded to `getQrCodeMaps`
 * @returns The picture per asset id
 */
export async function buildPdfCodeImageMap({
  assets,
  displayCodes,
  userId,
  organizationId,
}: {
  assets: CodeImageAsset[];
  displayCodes: Record<string, ResolvedDisplayCode>;
  userId: string;
  organizationId: string;
}): Promise<Record<string, PdfCodeImage>> {
  const images: Record<string, PdfCodeImage> = {};
  const qrAssets: CodeImageAsset[] = [];
  const barcodeAssets: { id: string; type: BarcodeType; value: string }[] = [];

  for (const asset of assets) {
    const code = displayCodes[asset.id];
    if (code && isBarcodeType(code.type)) {
      barcodeAssets.push({ id: asset.id, type: code.type, value: code.value });
    } else {
      qrAssets.push(asset);
    }
  }

  if (barcodeAssets.length > 0) {
    try {
      const bwipjs = await loadBwipjs();
      for (const [index, { id, type, value }] of barcodeAssets.entries()) {
        if (index > 0 && index % ENCODES_PER_YIELD === 0) {
          await yieldToEventLoop();
        }
        const image = encodeBarcodeImage({ type, value }, bwipjs);
        if (image) images[id] = image;
      }
    } catch (cause) {
      // The sheet still prints every code as text, so a missing encoder
      // degrades the pictures rather than failing the whole sheet.
      Logger.error(
        new ShelfError({
          cause,
          message: "Could not load the barcode encoder for a printed sheet",
          additionalData: { organizationId },
          label: "Barcode",
        })
      );
    }
  }

  if (qrAssets.length > 0) {
    const qrImages = await getQrCodeMaps({
      assets: qrAssets,
      userId,
      organizationId,
      size: "small",
    });
    for (const [id, src] of Object.entries(qrImages)) {
      images[id] = { src, shape: "square", placement: "cell" };
    }
  }

  return images;
}
