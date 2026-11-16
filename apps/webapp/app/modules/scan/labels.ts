/**
 * Scan labels
 *
 * The words a reader sees for how a scan was made: the surface that recorded
 * it and the code that was scanned. Pure and client-safe, so the server-side
 * row builder and any client component read the same strings.
 *
 * @see {@link file://./history.server.ts}
 */
import type { ScanCodeType, ScanSource } from "@prisma/client";

/** The surface that recorded a scan, as a reader would name it. */
export const SCAN_SOURCE_LABELS: Record<ScanSource, string> = {
  QR_LINK: "QR link",
  WEB_SCANNER: "Web scanner",
  WEB_DRAWER: "Scanner list",
  COMPANION: "Companion app",
  AUDIT: "Audit",
  GPS_UPDATE: "GPS update",
};

/** Shown for a scan recorded before its source was tracked. */
export const UNTRACKED_SOURCE_LABEL = "Not recorded";

/**
 * Names the surface that recorded a scan.
 *
 * @param source - The scan's source, or null on a row written before sources
 *   were tracked
 * @returns The label for the reader
 */
export function describeScanSourceLabel(source: ScanSource | null): string {
  return source ? SCAN_SOURCE_LABELS[source] : UNTRACKED_SOURCE_LABEL;
}

/**
 * Names the scanned code. A barcode or SAM ID carries its value so the reader
 * can tell which label it was; a QR id means nothing to a reader, so a QR is
 * named by its type alone.
 *
 * @param codeType - What kind of code was scanned
 * @param code - The value as scanned, or null on an old row that has none
 * @returns The label for the reader
 */
export function describeScannedCodeLabel(
  codeType: ScanCodeType,
  code: string | null
): string {
  switch (codeType) {
    case "BARCODE":
      return code ? `Barcode: ${code}` : "Barcode";
    case "SAM_ID":
      return code ? `SAM ID: ${code}` : "SAM ID";
    case "QR":
      return "QR code";
  }
}

/** Shown for "Update GPS coordinates": a location entered by hand. */
export const MANUAL_GPS_UPDATE_LABEL = "Manual GPS update";

/**
 * Names what a scan was, for its headline. A manual GPS update is recorded
 * against the asset's QR code but nothing was scanned, so it is named as what
 * it is rather than as a QR scan.
 *
 * @param scan.manuallyGenerated - Whether the location was entered by hand
 * @param scan.codeType - What kind of code was scanned
 * @param scan.code - The value as scanned, or null
 * @returns The headline for the reader
 */
export function describeScanHeadline(scan: {
  manuallyGenerated: boolean;
  codeType: ScanCodeType;
  code: string | null;
}): string {
  return scan.manuallyGenerated
    ? MANUAL_GPS_UPDATE_LABEL
    : describeScannedCodeLabel(scan.codeType, scan.code);
}

/**
 * Names the surface that recorded a scan, by its stored source or, on a
 * manual GPS update written before sources were tracked, by what it was.
 *
 * @param scan.source - The stored source, or null on an older row
 * @param scan.manuallyGenerated - Whether the location was entered by hand
 * @returns The label for the reader
 */
export function describeScanOrigin(scan: {
  source: ScanSource | null;
  manuallyGenerated: boolean;
}): string {
  if (!scan.source && scan.manuallyGenerated) {
    return SCAN_SOURCE_LABELS.GPS_UPDATE;
  }
  return describeScanSourceLabel(scan.source);
}

/**
 * Names the hardware a scan came from, from its parsed user agent.
 *
 * @param device - The parsed device
 * @returns "<vendor> <model>", or null when either is unknown
 */
export function describeDeviceHardware(device: {
  vendor?: string;
  model?: string;
}): string | null {
  return device.vendor && device.model
    ? `${device.vendor} ${device.model}`
    : null;
}
