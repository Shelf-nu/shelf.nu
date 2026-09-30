/**
 * PDF Code Pictures (server)
 *
 * Draws the picture printed in each row's Code cell on the booking checklist
 * and the audit receipt. The picture is always the SAME code as the text under
 * it, which `resolveDisplayCode` has already chosen:
 *
 * - a barcode (Code 128, Code 39, EAN-13, DataMatrix, External QR) is drawn
 *   here from its value, as an SVG, with bwip-js;
 * - anything else (the QR id, a SAM ID, or a fallback to the QR) prints the
 *   asset's Shelf QR, rendered by `getQrCodeMaps`.
 *
 * A barcode that would not fit its space at a scannable module width (a linear
 * code wider than the Code column, a 2D code too dense for its square), or a
 * value its symbology refuses (an EAN-13 that is not 12 or 13 digits), gets no
 * picture at all. The sheet then prints the code as text only,
 * which is still matchable by eye; a picture that does not scan is worse than
 * none.
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
  PDF_CODE_MODULE_MM,
  PDF_LINEAR_CODE_HEIGHT_MM,
  PDF_SQUARE_CODE_MAX_MODULES,
} from "./pdf-code-image";
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

/**
 * Draws one barcode as an SVG data URL for a printed sheet.
 *
 * Drawn at bwip-js scale 1, where one `viewBox` unit is one module. A linear
 * code's SVG declares its printed size on its root (`width` = modules x
 * {@link PDF_CODE_MODULE_MM}, `height` = {@link PDF_LINEAR_CODE_HEIGHT_MM}) and
 * `preserveAspectRatio="none"`, so the sheet prints it at exactly that size
 * without knowing its module count. A 2D code carries no size: the sheet prints
 * it square, at the size of the Shelf QR, on its natural aspect ratio.
 *
 * @param code - The barcode type and the value to encode
 * @param bwipjs - The loaded bwip-js module
 * @returns The picture, or `null` when the value cannot be drawn, a linear
 *   code would be wider than {@link PDF_CODE_IMAGE_MAX_WIDTH_MM}, or a 2D code
 *   spans more than {@link PDF_SQUARE_CODE_MAX_MODULES} modules
 */
export function encodeBarcodeImage(
  { type, value }: { type: BarcodeType; value: string },
  bwipjs: Pick<BwipJs, "toSVG">
): string | null {
  const isTwoDimensional = IS_TWO_DIMENSIONAL[type];

  let svg: string;
  try {
    svg = bwipjs.toSVG({
      bcid: BWIP_FORMAT[type],
      text: value,
      scale: 1,
      includetext: false,
      backgroundcolor: "ffffff",
      ...(isTwoDimensional
        ? {}
        : {
            height: PDF_LINEAR_CODE_HEIGHT_MM,
            paddingwidth: quietZoneModules(type),
          }),
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
    return modules > PDF_SQUARE_CODE_MAX_MODULES ? null : toSvgDataUrl(svg);
  }

  const widthMm = viewBox.width * PDF_CODE_MODULE_MM;
  if (widthMm > PDF_CODE_IMAGE_MAX_WIDTH_MM) {
    return null;
  }

  return toSvgDataUrl(
    svg.replace(
      "<svg ",
      `<svg width="${mm(widthMm)}" height="${mm(
        PDF_LINEAR_CODE_HEIGHT_MM
      )}" preserveAspectRatio="none" `
    )
  );
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
 * An asset without an entry prints its code as text only. That happens when a
 * barcode cannot be drawn or does not fit (see {@link encodeBarcodeImage}), when
 * a QR could not be rendered, and for every barcode if bwip-js fails to load.
 *
 * @param args.assets - Each asset once (deduped by id), with its `qrCodes`
 * @param args.displayCodes - The resolved display code per asset id
 * @param args.userId - The acting user, forwarded to `getQrCodeMaps`
 * @param args.organizationId - The workspace, forwarded to `getQrCodeMaps`
 * @returns A data URL per asset id
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
}): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
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
      for (const { id, type, value } of barcodeAssets) {
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
    Object.assign(
      images,
      await getQrCodeMaps({
        assets: qrAssets,
        userId,
        organizationId,
        size: "small",
      })
    );
  }

  return images;
}
