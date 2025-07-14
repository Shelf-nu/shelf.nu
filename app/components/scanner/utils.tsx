import { BarcodeType } from "@prisma/client";
import { readBarcodes, type ReadResult } from "zxing-wasm";
import { validateBarcodeValue } from "~/modules/barcode/validation";
import { isQrId } from "~/utils/id";
import type { OnCodeDetectionSuccess } from "./code-scanner";

/**
 * Common patterns for back camera labels across different devices and operating systems
 */
const BACK_CAMERA_PATTERNS = [
  // iOS patterns
  /back/i,
  /rear/i,
  /environment/i,
  /external/i,

  // Android patterns (various manufacturers)
  /camera2/i, // Some Android devices
  /camera 2/i,
  /camera0/i, // Common on older Android
  /main camera/i,
  /primary/i,
  /wide/i,
  /ultra/i,

  // Samsung specific
  /samsung back/i,
  /samsung rear/i,

  // Specific manufacturer patterns
  /oneplus rear/i,
  /pixel rear/i,
  /huawei rear/i,
  /xiaomi back/i,

  // Generic patterns that often indicate back camera
  /\b0\b/, // Single "0" often indicates primary camera
  /camera[\s_-]*2/i, // Matches "Camera 2", "Camera-2", "Camera_2"
];

// Patterns that specifically indicate front cameras (to exclude)
const FRONT_CAMERA_PATTERNS = [
  /front/i,
  /user/i,
  /face/i,
  /selfie/i,
  /forward/i,
];

/**
 * Determines if a camera device is likely a back camera based on its label
 * @param {MediaDeviceInfo} device - The media device to check
 * @returns {boolean} True if the device is likely a back camera
 */
export function isBackCamera(device: MediaDeviceInfo) {
  // Ensure we're dealing with a video input device
  if (device.kind !== "videoinput") {
    return false;
  }

  const label = device.label.toLowerCase();

  // First check if it matches any front camera patterns
  if (FRONT_CAMERA_PATTERNS.some((pattern) => pattern.test(label))) {
    return false;
  }

  // Then check if it matches any back camera patterns
  return BACK_CAMERA_PATTERNS.some((pattern) => pattern.test(label));
}

/**
 * Gets the most likely back camera from a list of media devices
 * @param {MediaDeviceInfo[]} devices - List of media devices
 * @returns {MediaDeviceInfo|null} The most likely back camera device, or null if none found
 */
export function getBestBackCamera(devices: MediaDeviceInfo[]) {
  const backCameras = devices.filter(isBackCamera);

  if (backCameras.length === 0) {
    return null;
  }

  // If we have multiple matches, prefer devices with these keywords in order
  const preferenceOrder = [
    "ultra", // Ultra-wide cameras are often the best quality
    "wide", // Wide-angle cameras are typically main cameras
    "main", // Explicitly labeled main cameras
    "back", // Generic back cameras
    "rear", // Generic rear cameras
    "camera 2", // Common pattern for main cameras
    "camera0", // Fallback for older devices
  ];

  for (const preference of preferenceOrder) {
    const match = backCameras.find((device) =>
      device.label.toLowerCase().includes(preference)
    );
    if (match) {
      return match;
    }
  }

  // If no preferred matches, return the first back camera
  return backCameras[0];
}

/**
 * Draws a detection box around a barcode on a canvas
 * @param ctx  The canvas rendering context
 * @param position  The position of the detected barcode
 * @returns void
 */
/**
 * Attempts to detect what type of barcode a value might be based on its characteristics
 * Returns the barcode type if it matches validation rules, null otherwise
 * 
 * Note: Tests fixed-length types (Code39, DataMatrix) before variable-length Code128
 * to avoid misclassification of shorter values as Code128
 */
function detectBarcodeType(value: string): BarcodeType | null {
  const normalizedValue = value.toUpperCase();

  // Check fixed-length types first to avoid misclassification
  // Order by specificity: most restrictive validation rules first
  const orderedTypes: BarcodeType[] = [
    BarcodeType.Code39,    // Exactly 6 characters, alphanumeric only
    BarcodeType.DataMatrix, // 4-100 characters, but check before Code128
    BarcodeType.Code128,   // 4-40 characters, most permissive (check last)
  ];

  for (const type of orderedTypes) {
    const validationError = validateBarcodeValue(type, normalizedValue);
    if (!validationError) {
      return type;
    }
  }

  return null;
}

/**
 * Checks if a scanned value is a valid barcode format
 */
function isValidBarcode(value: string): {
  isValid: boolean;
  type?: BarcodeType;
} {
  const detectedType = detectBarcodeType(value);
  return {
    isValid: detectedType !== null,
    type: detectedType || undefined,
  };
}

export const drawDetectionBox = (
  ctx: CanvasRenderingContext2D,
  position: ReadResult["position"]
) => {
  if (!position) return;

  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#22c55e";
  ctx.moveTo(position.topLeft.x, position.topLeft.y);
  ctx.lineTo(position.topRight.x, position.topRight.y);
  ctx.lineTo(position.bottomRight.x, position.bottomRight.y);
  ctx.lineTo(position.bottomLeft.x, position.bottomLeft.y);
  ctx.closePath();
  ctx.stroke();
  const corners = [
    position.topLeft,
    position.topRight,
    position.bottomRight,
    position.bottomLeft,
  ];

  corners.forEach((corner) => {
    ctx.fillStyle = "red";
    ctx.fillRect(corner.x - 2, corner.y - 2, 4, 4);
  });
};

export const processFrame = async ({
  video,
  canvas,
  animationFrame,
  paused,
  setPaused,
  onCodeDetectionSuccess,
  allowNonShelfCodes,
  setError,
}: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  animationFrame: React.MutableRefObject<number>;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  onCodeDetectionSuccess: OnCodeDetectionSuccess;
  allowNonShelfCodes: boolean;
  setError: (error: string) => void;
}) => {
  // If already paused, don't process more frames
  if (paused) {
    /** When the state is paused and animation frame exists, we need to cancel it to stop the processing of frames */
    if (animationFrame.current) {
      cancelAnimationFrame(animationFrame.current);
      animationFrame.current = 0;
    }
    return;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  try {
    if (
      (video.readyState !== video.HAVE_ENOUGH_DATA ||
        !video.videoWidth ||
        !video.videoHeight) &&
      !paused
    ) {
      animationFrame.current = requestAnimationFrame(() =>
        processFrame({
          video,
          canvas,
          animationFrame,
          paused,
          setPaused,
          onCodeDetectionSuccess,
          allowNonShelfCodes,
          setError,
        })
      );
      return;
    }

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    canvas.width = videoWidth;
    canvas.height = videoHeight;
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight);
    const results = await readBarcodes(imageData, {
      tryHarder: true,
      formats: ["QRCode", ...Object.values(BarcodeType)],
      maxNumberOfSymbols: 1,
    });

    if (results.length > 0) {
      const result = results[0];
      drawDetectionBox(ctx, result.position);

      // Don't set paused yet - let handleDetection decide
      await handleDetection({
        result: result.text,
        onCodeDetectionSuccess,
        allowNonShelfCodes,
        paused, // Use the current paused state
      });

      // The onCodeDetectionSuccess callback will handle pausing based on the action
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    setError(
      `Frame processing error: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Always request next frame unless paused
  if (!paused) {
    animationFrame.current = requestAnimationFrame(() =>
      processFrame({
        video,
        canvas,
        animationFrame,
        paused,
        setPaused,
        onCodeDetectionSuccess,
        allowNonShelfCodes,
        setError,
      })
    );
  }
};

export const handleDetection = async ({
  result,
  allowNonShelfCodes,
  onCodeDetectionSuccess,
  paused,
}: {
  result: string;
  allowNonShelfCodes: boolean;
  onCodeDetectionSuccess?: OnCodeDetectionSuccess;
  paused: boolean;
}) => {
  if (!result || paused) return;

  // First, check if it's a QR code (URL pattern)
  const qrRegex = /^(https?:\/\/[^/]+\/(?:qr\/)?([a-zA-Z0-9]+))$/;
  const qrMatch = result.match(qrRegex);

  if (qrMatch) {
    // It's a QR code URL
    const qrId = qrMatch[2];
    await onCodeDetectionSuccess?.({
      value: qrId,
      type: "qr",
      error: !isQrId(qrId) ? "Invalid QR code format" : undefined,
    });
    return;
  }

  // Check if it's a raw QR ID (before checking barcodes)
  if (isQrId(result)) {
    await onCodeDetectionSuccess?.({
      value: result,
      type: "qr",
    });
    return;
  }

  // If not a QR code, check if it's a valid barcode
  const barcodeCheck = isValidBarcode(result);

  if (barcodeCheck.isValid) {
    // It's a valid barcode
    await onCodeDetectionSuccess?.({
      value: result.toUpperCase(),
      type: "barcode",
    });
    return;
  }

  // TODO: Research if allowNonShelfCodes is still needed in scanner detection logic
  // If allowNonShelfCodes is true, treat as a raw QR value
  if (allowNonShelfCodes) {
    await onCodeDetectionSuccess?.({
      value: result,
      type: "qr",
    });
    return;
  }

  // Not a valid QR code or barcode
  await onCodeDetectionSuccess?.({
    value: result,
    error: "Scanned code is not a valid Shelf QR code or barcode.",
  });
};

/** Updates the canvas size to match the video size */
export const updateCanvasSize = ({
  video,
  canvas,
}: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
}) => {
  if (!video || !canvas) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
};
