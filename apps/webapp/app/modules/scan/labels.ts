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
