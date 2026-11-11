/**
 * What every kind of scanned code resolves to, through both ways in.
 *
 * `handleDetection` classifies every scan, and `getShelfQrId` is the one rule
 * for "is this a Shelf QR". The camera (`processFrame`) knows the symbology:
 * it passes a `barcodeType` only for a structured barcode, and a QR arrives
 * untyped. A handheld scanner (`handleScannerInputValue`) types the code into
 * an input, so nothing is typed. The table below pins the answer for each
 * input class on both paths, so a change to one case shows up as a failing
 * row instead of a customer report.
 *
 * Runs under Node, where `getShelfQrId` reads our origin from `SERVER_URL`
 * (`http://localhost:3000` in the test env). `utils.browser.test.ts` covers
 * the browser, where the origin comes from `window.location`.
 *
 * @see {@link file://./utils.tsx}
 * @see {@link file://../../utils/qr-code.ts}
 */
import { BarcodeType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as EnvModule from "~/utils/env";

// why: the decoder is a wasm binary; each camera row supplies the decoded code.
const { readBarcodes } = vi.hoisted(() => ({ readBarcodes: vi.fn() }));
vi.mock("zxing-wasm/reader", () => ({ readBarcodes }));

// why: code-scanner renders a lottie animation on success, and lottie paints
// on a canvas at import time, which the test DOM does not provide.
vi.mock("./success-animation", () => ({ default: () => null }));

// why: the test env sets no shortener, and a Shelf label can carry one.
vi.mock("~/utils/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  URL_SHORTENER: "short.example",
}));

import { handleScannerInputValue } from "./code-scanner";
import { processFrame } from "./utils";

/** The origin `getShelfQrId` treats as ours under test: `SERVER_URL`. */
const APP_ORIGIN = "http://localhost:3000";

/** A value `isQrId` accepts: 10 characters, lowercase, leading letter. */
const QR_ID = "abc1234567";

/** A legacy 25-character QR id, still printed on older labels. */
const LEGACY_QR_ID = "clh8x2k9p0000qwerty123456";

const onCodeDetectionSuccess = vi.fn();

/** Feeds one decoded code through the camera path and returns its result. */
async function scanWithCamera(format: string, text: string) {
  readBarcodes.mockResolvedValueOnce([{ format, text, position: undefined }]);

  const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({})) };
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const video = {
    readyState: 4,
    HAVE_ENOUGH_DATA: 4,
    videoWidth: 640,
    videoHeight: 480,
  } as unknown as HTMLVideoElement;

  await processFrame({
    video,
    canvas,
    animationFrame: { current: 0 },
    paused: false,
    setPaused: vi.fn(),
    onCodeDetectionSuccess,
    allowNonShelfCodes: false,
    setError: vi.fn(),
  });

  expect(onCodeDetectionSuccess).toHaveBeenCalledTimes(1);
  return onCodeDetectionSuccess.mock.calls[0][0];
}

/** Types one value in as a handheld scanner would and returns its result. */
async function scanWithHandheld(rawValue: string) {
  await handleScannerInputValue({
    rawValue,
    paused: false,
    onCodeDetectionSuccess,
    allowNonShelfCodes: false,
  });

  expect(onCodeDetectionSuccess).toHaveBeenCalledTimes(1);
  return onCodeDetectionSuccess.mock.calls[0][0];
}

beforeEach(() => {
  onCodeDetectionSuccess.mockReset();
  // why: processFrame schedules the next frame; nothing here should run it.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
});

const shelfQr = (value: string) => ({ value, type: "qr", error: undefined });
const barcode = (barcodeType: BarcodeType, value: string) => ({
  value,
  type: "barcode",
  barcodeType,
});

type Row = {
  /** What is printed on the label. */
  name: string;
  /** The text the code carries. */
  value: string;
  /** The format zxing reports for it. */
  cameraFormat: string;
  camera: Record<string, unknown>;
  handheld: Record<string, unknown>;
};

/**
 * A handheld scanner cannot tell a Code128 from an outside QR, so every value
 * that is not a Shelf QR or a sequential id resolves as ExternalQR there with
 * its case kept. The lookup goes by value, so the asset is still found.
 */
const ROWS: Row[] = [
  {
    name: "Shelf app link",
    value: `${APP_ORIGIN}/qr/${QR_ID}`,
    cameraFormat: "QRCode",
    camera: shelfQr(QR_ID),
    handheld: shelfQr(QR_ID),
  },
  {
    name: "Shelf app link carrying a malformed id",
    value: `${APP_ORIGIN}/qr/BADID`,
    cameraFormat: "QRCode",
    camera: { value: "BADID", type: "qr", error: "Invalid QR code format" },
    handheld: { value: "BADID", type: "qr", error: "Invalid QR code format" },
  },
  {
    name: "shortener link",
    value: `https://short.example/${QR_ID}`,
    cameraFormat: "QRCode",
    camera: shelfQr(QR_ID),
    handheld: shelfQr(QR_ID),
  },
  {
    name: "raw QR id",
    value: QR_ID,
    cameraFormat: "QRCode",
    camera: shelfQr(QR_ID),
    handheld: shelfQr(QR_ID),
  },
  {
    name: "legacy 25-character QR id",
    value: LEGACY_QR_ID,
    cameraFormat: "QRCode",
    camera: shelfQr(LEGACY_QR_ID),
    handheld: shelfQr(LEGACY_QR_ID),
  },
  {
    name: "outside QR: /qr/<id> url on another host",
    value: "http://other-vendor.example/qr/01383d6c",
    cameraFormat: "QRCode",
    camera: barcode(
      BarcodeType.ExternalQR,
      "http://other-vendor.example/qr/01383d6c"
    ),
    handheld: barcode(
      BarcodeType.ExternalQR,
      "http://other-vendor.example/qr/01383d6c"
    ),
  },
  {
    name: "outside QR: single-segment url whose tail reads like a QR id",
    value: `https://other-vendor.example/${QR_ID}`,
    cameraFormat: "QRCode",
    camera: barcode(
      BarcodeType.ExternalQR,
      `https://other-vendor.example/${QR_ID}`
    ),
    handheld: barcode(
      BarcodeType.ExternalQR,
      `https://other-vendor.example/${QR_ID}`
    ),
  },
  {
    name: "outside QR: other url",
    value: "https://other-vendor.example/assets/77?tag=A1",
    cameraFormat: "QRCode",
    camera: barcode(
      BarcodeType.ExternalQR,
      "https://other-vendor.example/assets/77?tag=A1"
    ),
    handheld: barcode(
      BarcodeType.ExternalQR,
      "https://other-vendor.example/assets/77?tag=A1"
    ),
  },
  {
    name: "Code128",
    value: "box 12/a",
    cameraFormat: "Code128",
    camera: barcode(BarcodeType.Code128, "BOX 12/A"),
    handheld: barcode(BarcodeType.ExternalQR, "box 12/a"),
  },
  {
    name: "Code128 shaped like a sequential id",
    value: "part-4421",
    cameraFormat: "Code128",
    camera: barcode(BarcodeType.Code128, "PART-4421"),
    // Typed in, PREFIX-number reads as a sequential id.
    handheld: { value: "PART-4421", type: "samId" },
  },
  {
    name: "Code128 whose value reads like a QR id",
    value: QR_ID,
    cameraFormat: "Code128",
    // The camera knows the format, so it is never claimed as a QR id.
    camera: barcode(BarcodeType.Code128, QR_ID.toUpperCase()),
    // Typed in, it is indistinguishable from a raw QR id.
    handheld: shelfQr(QR_ID),
  },
  {
    name: "Code39",
    value: "PART4421",
    cameraFormat: "Code39",
    camera: barcode(BarcodeType.Code39, "PART4421"),
    handheld: barcode(BarcodeType.ExternalQR, "PART4421"),
  },
  {
    name: "Code39 reported as a zxing variant",
    value: "PART4421",
    cameraFormat: "Code39Ext",
    camera: barcode(BarcodeType.Code39, "PART4421"),
    handheld: barcode(BarcodeType.ExternalQR, "PART4421"),
  },
  {
    name: "EAN13",
    value: "4006381333931",
    cameraFormat: "EAN13",
    camera: barcode(BarcodeType.EAN13, "4006381333931"),
    handheld: barcode(BarcodeType.ExternalQR, "4006381333931"),
  },
  {
    name: "DataMatrix",
    value: "dm-part-9921",
    cameraFormat: "DataMatrix",
    camera: barcode(BarcodeType.DataMatrix, "DM-PART-9921"),
    handheld: barcode(BarcodeType.ExternalQR, "dm-part-9921"),
  },
  {
    name: "SAM sequential id",
    value: "SAM-0001",
    cameraFormat: "Code128",
    // The camera reads it as the barcode it is printed as.
    camera: barcode(BarcodeType.Code128, "SAM-0001"),
    handheld: { value: "SAM-0001", type: "samId" },
  },
];

describe("scanned code classification", () => {
  it.each(ROWS)("camera: $name", async (row) => {
    expect(await scanWithCamera(row.cameraFormat, row.value)).toEqual(
      row.camera
    );
  });

  it.each(ROWS)("handheld: $name", async (row) => {
    expect(await scanWithHandheld(row.value)).toEqual(row.handheld);
  });
});
