import type { ReadResult } from "zxing-wasm";

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
