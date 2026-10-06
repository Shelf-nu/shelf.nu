/**
 * Classifying a scanned code.
 *
 * `handleDetection` is reached from two places, and only one of them knows
 * anything about the code: the camera path recognises the format and, for a QR,
 * decides against `isShelfQrCode` whether the host is ours, then passes a
 * `barcodeType`. The manual-entry path passes none. So `barcodeType` is the
 * caller's answer to "what is this", and the QR heuristics here are for the case
 * where nobody has answered yet.
 *
 * @see {@link file://./utils.tsx}
 */
import { BarcodeType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the module imports the zxing decoder at load time for the camera path,
// which is a wasm binary these tests never reach.
vi.mock("zxing-wasm/reader", () => ({
  readBarcodes: vi.fn(),
}));

import { handleDetection } from "./utils";

/** A value `isQrId` accepts: 10 characters, lowercase, leading letter. */
const QR_ID = "abc1234567";

const onCodeDetectionSuccess = vi.fn();

/** Runs a detection and answers with the single reported result. */
async function detect(
  result: string,
  barcodeType?: BarcodeType | "ExternalQR"
) {
  await handleDetection({
    result,
    onCodeDetectionSuccess,
    allowNonShelfCodes: false,
    paused: false,
    barcodeType: barcodeType as BarcodeType | undefined,
  });

  expect(onCodeDetectionSuccess).toHaveBeenCalledTimes(1);

  return onCodeDetectionSuccess.mock.calls[0][0];
}

beforeEach(() => {
  onCodeDetectionSuccess.mockReset();
});

describe("handleDetection without a barcode type", () => {
  it("reads the id out of a Shelf QR url", async () => {
    expect(await detect(`https://app.shelf.nu/qr/${QR_ID}`)).toEqual({
      value: QR_ID,
      type: "qr",
      error: undefined,
    });
  });

  it("accepts a raw QR id", async () => {
    expect(await detect(QR_ID)).toEqual({ value: QR_ID, type: "qr" });
  });

  it("reports a Shelf QR url carrying an id we cannot use", async () => {
    // Our host, our /qr/ path, so it is ours to complain about.
    expect(await detect("https://app.shelf.nu/qr/BADID")).toEqual({
      value: "BADID",
      type: "qr",
      error: "Invalid QR code format",
    });
  });

  it("falls back to barcode detection for anything else", async () => {
    expect(await detect("PART-4421")).toEqual({
      value: "PART-4421",
      type: "barcode",
      barcodeType: BarcodeType.ExternalQR,
    });
  });
});

describe("handleDetection with an external QR", () => {
  // The camera path sends ExternalQR only after isShelfQrCode has said the host
  // is not ours, so the url here is settled: it is somebody else's QR code and
  // belongs to the caller's chosen type.
  it("keeps an external url whose tail looks like a QR id", async () => {
    expect(
      await detect(`https://example.com/${QR_ID}`, BarcodeType.ExternalQR)
    ).toEqual({
      value: `https://example.com/${QR_ID}`,
      type: "barcode",
      barcodeType: BarcodeType.ExternalQR,
    });
  });

  it("keeps an external url whose tail does not look like a QR id", async () => {
    expect(
      await detect("https://example.com/Docs123", BarcodeType.ExternalQR)
    ).toEqual({
      value: "https://example.com/Docs123",
      type: "barcode",
      barcodeType: BarcodeType.ExternalQR,
    });
  });

  it("keeps a url with a path the QR pattern cannot match", async () => {
    // More than one path segment, so it was never at risk; pinned so the
    // ordinary external QR stays working.
    expect(
      await detect("https://example.com/a/b/c", BarcodeType.ExternalQR)
    ).toEqual({
      value: "https://example.com/a/b/c",
      type: "barcode",
      barcodeType: BarcodeType.ExternalQR,
    });
  });
});

describe("handleDetection with a structured barcode", () => {
  it("keeps a Code128 whose value looks like a QR id", async () => {
    expect(await detect(QR_ID, BarcodeType.Code128)).toEqual({
      value: QR_ID.toUpperCase(),
      type: "barcode",
      barcodeType: BarcodeType.Code128,
    });
  });

  it("keeps an ordinary Code128", async () => {
    expect(await detect("PART-4421", BarcodeType.Code128)).toEqual({
      value: "PART-4421",
      type: "barcode",
      barcodeType: BarcodeType.Code128,
    });
  });
});
