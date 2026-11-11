/**
 * QR/barcode value parsing for the scanner.
 *
 * @see ./server/contract.ts — `isSameOrigin`, used for the server check
 */
import { isSameOrigin } from "./server/contract";

/**
 * Extracts a Shelf QR ID from a scanned barcode value.
 * Supports three formats:
 * 1. Full URL: https://example.com/qr/<id>
 * 2. URL shortener: https://example.com/<id> (10-25 char lowercase alphanumeric)
 * 3. Raw ID: 10-25 char lowercase alphanumeric starting with a letter
 */
export function extractQrId(data: string): string | null {
  // Match any URL with /qr/<id> path
  const qrPathMatch = data.match(/^https?:\/\/[^/]+\/qr\/([a-zA-Z0-9]+)$/);
  if (qrPathMatch) return qrPathMatch[1];

  // Match URL shortener format: https://<domain>/<id>
  const shortenerMatch = data.match(
    /^https?:\/\/[^/]+\/([a-z][a-z0-9]{9,24})$/
  );
  if (shortenerMatch) return shortenerMatch[1];

  // Raw QR IDs (10 or 25 char lowercase alphanumeric starting with letter)
  if (/^[a-z][a-z0-9]{9,24}$/.test(data)) return data;

  return null;
}

/** Outcome of checking a scanned value against the active server. */
export type ScannedCodeClassification =
  | { kind: "id"; qrId: string }
  | { kind: "foreign" }
  | { kind: "unknown" };

/**
 * Classifies a scanned value against the server the app is connected to.
 *
 * `extractQrId` matches ANY host by design, so without this check a code minted
 * by a different Shelf server would be resolved against the active one and
 * reported as "not found" — a baffling error for a code that is perfectly valid
 * elsewhere.
 *
 * Only the canonical `/qr/<id>` label names the instance that minted it, so it
 * is the only form the origin rule may judge. A short link is minted on a
 * separate shortener domain (`URL_SHORTENER`) that the server never advertises
 * — `/api/mobile/config` carries no shortener field — so its origin says
 * nothing about which instance owns it, and treating a mismatch as foreign
 * would reject every short-link code, including this instance's own.
 *
 * This is an affordance, not an authorization control: resolution stays
 * authenticated and org-scoped on the server, so admitting an ambiguous format
 * costs a "not found" at worst.
 *
 * @param data - The raw scanned value.
 * @param activeBaseUrl - The active server's base URL.
 * @returns `{ kind: "id" }` when usable here, `{ kind: "foreign" }` for a
 *   canonical Shelf QR URL belonging to another server, `{ kind: "unknown" }`
 *   for anything that isn't a Shelf code at all.
 */
export function classifyScannedCode(
  data: string,
  activeBaseUrl: string
): ScannedCodeClassification {
  const qrId = extractQrId(data);
  if (!qrId) return { kind: "unknown" };

  // A bare id carries no host, so it can only be meant for this server.
  if (!/^https?:\/\//i.test(data)) return { kind: "id", qrId };

  // Anything other than the canonical label — i.e. a short link — carries an
  // origin that cannot be attributed to any instance. Admit it.
  if (!/^https?:\/\/[^/]+\/qr\/[a-zA-Z0-9]+$/.test(data)) {
    return { kind: "id", qrId };
  }

  return isSameOrigin(data, activeBaseUrl)
    ? { kind: "id", qrId }
    : { kind: "foreign" };
}

/**
 * Which lookup a scanned value should go to.
 *
 * - `qr`: a Shelf QR id for this server; resolve it on the QR route.
 * - `code`: not a Shelf QR at all; the SAM id and workspace barcode paths
 *   decide what it is.
 * - `foreign-barcode`: a canonical `/qr/<id>` URL on another host. It may be
 *   another Shelf server's label, or a label from a previous system that the
 *   workspace linked to an asset or kit as an alternative barcode (ExternalQR).
 *   Only the barcode lookup can tell, so it is asked first; see
 *   {@link isForeignCodeMiss} for the miss.
 * - `foreign`: the same kind of URL when no barcode lookup is possible, so the
 *   other-server message is the only useful answer.
 */
export type ScanLookupPlan =
  | { kind: "qr"; qrId: string }
  | { kind: "code" }
  | { kind: "foreign-barcode" }
  | { kind: "foreign" };

/**
 * Plans the lookup for a scanned value.
 *
 * The full scanned value is what the barcode lookup must receive for a
 * `foreign-barcode` plan: ExternalQR values are stored as the whole URL with
 * their case kept, and the server tries that exact value before uppercasing.
 *
 * @param data - The raw scanned value.
 * @param activeBaseUrl - The active server's base URL.
 * @param barcodeLookupAvailable - Whether this workspace can resolve barcodes
 *   (a workspace is selected and holds the barcode capability).
 */
export function planScanLookup(
  data: string,
  activeBaseUrl: string,
  barcodeLookupAvailable: boolean
): ScanLookupPlan {
  const classification = classifyScannedCode(data, activeBaseUrl);
  switch (classification.kind) {
    case "id":
      return { kind: "qr", qrId: classification.qrId };
    case "foreign":
      return barcodeLookupAvailable
        ? { kind: "foreign-barcode" }
        : { kind: "foreign" };
    case "unknown":
      return { kind: "code" };
  }
}

/**
 * Whether a failed barcode lookup should be reported as "Different Shelf
 * Server" rather than with the server's own message.
 *
 * Only a plain not-found (404) qualifies: nothing in the caller's workspaces
 * holds the value, so the other-server reading is the likely one. Every other
 * failure (linked to nothing, in several workspaces, offline) says something
 * more precise and keeps its own message.
 *
 * @param plan - The plan the scan was routed by.
 * @param status - The HTTP status of the failed lookup, absent when there was
 *   no answer.
 */
export function isForeignCodeMiss(
  plan: ScanLookupPlan,
  status: number | undefined
): boolean {
  return plan.kind === "foreign-barcode" && status === 404;
}
