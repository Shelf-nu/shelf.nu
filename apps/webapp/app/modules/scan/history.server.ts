/**
 * Scan history
 *
 * Reads an asset's or kit's recorded scans for the scan history sheet, one
 * page at a time, and shapes each into the row the sheet shows. Rows are
 * built here, on the server, so the client never receives a non-member's
 * email or a raw user agent.
 *
 * @see {@link file://./../../routes/api+/scans.ts}
 * @see {@link file://./../../components/scan/scan-history-sheet.tsx}
 */
import type { IResult } from "ua-parser-js";
import { describeScannedCodeLabel, describeScanSourceLabel } from "./labels";
import type { ScanWithRelations } from "./utils.server";
import { describeScanner, parseScanUserAgent } from "./utils.server";

/** One row of the scan history sheet. Every field is ready to render. */
export type ScanHistoryRow = {
  id: string;
  /** When the scan was made, as an ISO string (its shape on the wire) */
  scannedAt: string;
  /** `Name (email)` for a member of the scan's workspace, else "Unknown" */
  scannedBy: string;
  /** "QR code", "Barcode: <value>" or "SAM ID: <value>" */
  code: string;
  /** The surface that recorded the scan */
  source: string;
  coordinates: { latitude: string; longitude: string } | null;
  /** "<vendor> <model> · <browser>", or "Unknown device" */
  device: string;
};

/**
 * Describes the device a scan came from, from its parsed user agent.
 *
 * @param ua - The parsed user agent
 * @returns The device and browser, or "Unknown device" when neither is known
 */
function describeDevice(ua: IResult): string {
  const hardware =
    ua.device.vendor && ua.device.model
      ? `${ua.device.vendor} ${ua.device.model}`
      : null;
  const parts = [hardware, ua.browser?.name ?? null].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(" · ") : "Unknown device";
}

/**
 * Shapes a recorded scan into a scan history row.
 *
 * @param scan - The scan with its scanning user and their memberships
 * @returns The row the sheet renders
 */
export function toScanHistoryRow(scan: ScanWithRelations): ScanHistoryRow {
  return {
    id: scan.id,
    scannedAt: scan.createdAt.toISOString(),
    scannedBy: describeScanner(scan.user, scan.organizationId),
    code: describeScannedCodeLabel(scan.codeType, scan.code),
    source: describeScanSourceLabel(scan.source),
    coordinates:
      scan.latitude && scan.longitude
        ? { latitude: scan.latitude, longitude: scan.longitude }
        : null,
    device: describeDevice(parseScanUserAgent(scan.userAgent)),
  };
}
