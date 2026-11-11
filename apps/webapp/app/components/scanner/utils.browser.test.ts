/**
 * The camera and handheld paths, classified with the environment a browser
 * actually has.
 *
 * Every other test runs under Node, where `isBrowser` is false and `~/utils/env`
 * reads the full server environment. A real browser reads only `window.env`
 * (the payload of `getBrowserEnv`), and `getEnv` answers `""` for anything
 * declared secret. `getShelfQrId` decides whether a scanned QR is ours from
 * those values, so this file loads the env module the way the browser does and
 * sends codes through `processFrame` and `handleScannerInputValue`, exactly as
 * the camera and a handheld scanner do.
 *
 * @see {@link file://./utils.tsx}
 * @see {@link file://../../utils/qr-code.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: under Vitest `process` exists, so the real check reports "server" and
// env.ts would read process.env. Forcing it on loads the browser branch.
vi.mock("~/utils/is-browser", () => ({ isBrowser: true }));

// why: the decoder is a wasm binary; the test supplies the decoded QR instead.
const { readBarcodes } = vi.hoisted(() => ({ readBarcodes: vi.fn() }));
vi.mock("zxing-wasm/reader", () => ({ readBarcodes }));

/** The public env a server hands the browser: what `getBrowserEnv` ships. */
window.env = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://supabase-project.supabase.co",
  SUPABASE_ANON_PUBLIC: "{ANON_PUBLIC}",
  MAPTILER_TOKEN: "{MAPTILER_TOKEN}",
  ENABLE_PREMIUM_FEATURES: true,
  MAINTENANCE_MODE: false,
  URL_SHORTENER: "eam.sh",
  FREE_TRIAL_DAYS: "7",
  SUPPORT_EMAIL: "support@shelf.nu",
} as unknown as typeof window.env;

// why: code-scanner renders a lottie animation on success, and lottie paints
// on a canvas at import time, which the test DOM does not provide.
vi.mock("./success-animation", () => ({ default: () => null }));

const { processFrame } = await import("./utils");
const { handleScannerInputValue } = await import("./code-scanner");

/** A value `isQrId` accepts: 10 characters, lowercase, leading letter. */
const QR_ID = "abc1234567";

const onCodeDetectionSuccess = vi.fn();

/** Feeds one decoded QR through the camera path and returns what it reported. */
async function scanQr(text: string) {
  readBarcodes.mockResolvedValueOnce([
    { format: "QRCode", text, position: undefined },
  ]);

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

beforeEach(() => {
  onCodeDetectionSuccess.mockReset();
  // why: processFrame schedules the next frame; nothing here should run it.
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
});

describe("processFrame in the browser", () => {
  it("reads a shortener label as a Shelf QR", async () => {
    await expect(scanQr(`https://eam.sh/${QR_ID}`)).resolves.toEqual({
      value: QR_ID,
      type: "qr",
      error: undefined,
    });
  });

  it("reads a label pointing at this app's own /qr route as a Shelf QR", async () => {
    await expect(
      scanQr(`${window.location.origin}/qr/${QR_ID}`)
    ).resolves.toEqual({ value: QR_ID, type: "qr", error: undefined });
  });

  it("treats a /qr/ url on somebody else's host as external", async () => {
    await expect(
      scanQr("http://other-vendor.example/qr/01383d6c")
    ).resolves.toEqual({
      value: "http://other-vendor.example/qr/01383d6c",
      type: "barcode",
      barcodeType: "ExternalQR",
    });
  });

  it("still treats a QR on somebody else's host as external", async () => {
    await expect(scanQr(`https://example.com/${QR_ID}`)).resolves.toEqual({
      value: `https://example.com/${QR_ID}`,
      type: "barcode",
      barcodeType: "ExternalQR",
    });
  });
});

describe("a handheld scanner in the browser", () => {
  // A keyboard-wedge scanner types the code into an input, so it reaches
  // handleDetection without a format, and must get the camera's answer.
  async function typeIn(rawValue: string) {
    await handleScannerInputValue({
      rawValue,
      paused: false,
      onCodeDetectionSuccess,
      allowNonShelfCodes: false,
    });

    expect(onCodeDetectionSuccess).toHaveBeenCalledTimes(1);
    return onCodeDetectionSuccess.mock.calls[0][0];
  }

  it("reads a shortener label as a Shelf QR", async () => {
    await expect(typeIn(`https://eam.sh/${QR_ID}`)).resolves.toEqual({
      value: QR_ID,
      type: "qr",
      error: undefined,
    });
  });

  it("reads a label pointing at this app's own /qr route as a Shelf QR", async () => {
    await expect(
      typeIn(`${window.location.origin}/qr/${QR_ID}`)
    ).resolves.toEqual({ value: QR_ID, type: "qr", error: undefined });
  });

  it("treats a /qr/ url on somebody else's host as external", async () => {
    await expect(
      typeIn("http://other-vendor.example/qr/01383d6c")
    ).resolves.toEqual({
      value: "http://other-vendor.example/qr/01383d6c",
      type: "barcode",
      barcodeType: "ExternalQR",
    });
  });
});
