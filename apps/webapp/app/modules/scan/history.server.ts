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
import type { ScanCodeType } from "@prisma/client";
import type { IResult } from "ua-parser-js";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { describeScannedCodeLabel, describeScanSourceLabel } from "./labels";
import type { ScanTarget } from "./service.server";
import type { ScanWithRelations } from "./utils.server";
import { identifyScanner, parseScanUserAgent } from "./utils.server";

/** One row of the scan history sheet. Every field is ready to render. */
export type ScanHistoryRow = {
  id: string;
  /** When the scan was made, as an ISO string (its shape on the wire) */
  scannedAt: string;
  /** The scanner's name for a member of the scan's workspace, else "Unknown" */
  scannedBy: string;
  /** The scanner's email, only for a member of the scan's workspace */
  scannedByEmail: string | null;
  /** What kind of code was scanned, for the row's icon */
  codeType: ScanCodeType;
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

/** The row's scanner fields, by the member-only rule the card also uses. */
function scannerFields(
  scan: ScanWithRelations
): Pick<ScanHistoryRow, "scannedBy" | "scannedByEmail"> {
  const { name, email } = identifyScanner(scan.user, scan.organizationId);
  return { scannedBy: name, scannedByEmail: email };
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
    ...scannerFields(scan),
    codeType: scan.codeType,
    code: describeScannedCodeLabel(scan.codeType, scan.code),
    source: describeScanSourceLabel(scan.source),
    coordinates:
      scan.latitude && scan.longitude
        ? { latitude: scan.latitude, longitude: scan.longitude }
        : null,
    device: describeDevice(parseScanUserAgent(scan.userAgent)),
  };
}

/** How many scans one page of the sheet shows. */
export const SCAN_HISTORY_PAGE_SIZE = 25;

/** One page of scan history, and where the next one starts. */
export type ScanHistoryPage = {
  scans: ScanHistoryRow[];
  /** The id to continue after, or null on the last page */
  nextCursor: string | null;
};

/**
 * Reads one page of an asset's or kit's scans, newest first.
 *
 * Scoped to `organizationId`, the caller's workspace. Every scan carries the
 * workspace its code resolved in, so this is the whole tenancy guard: an id
 * from another workspace reads nothing. One row past the page is read to tell
 * whether another page exists.
 *
 * @param args.target - The asset or kit
 * @param args.organizationId - The caller's workspace
 * @param args.cursor - The id of the last scan already shown, for the next page
 * @returns The page of rows and the cursor to the next one
 * @throws {ShelfError} If the read fails
 */
export async function getScanHistory({
  target,
  organizationId,
  cursor,
}: {
  target: ScanTarget;
  organizationId: string;
  cursor?: string | null;
}): Promise<ScanHistoryPage> {
  try {
    const scans = await db.scan.findMany({
      where:
        "assetId" in target
          ? { assetId: target.assetId, organizationId }
          : { kitId: target.kitId, organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SCAN_HISTORY_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: { include: { userOrganizations: true } } },
    });

    const hasMore = scans.length > SCAN_HISTORY_PAGE_SIZE;
    const page = scans.slice(0, SCAN_HISTORY_PAGE_SIZE);
    const last = page[page.length - 1];

    return {
      scans: page.map(toScanHistoryRow),
      nextCursor: hasMore && last ? last.id : null,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while loading the scan history.",
      additionalData: { target, cursor },
      label: "Scan",
    });
  }
}
