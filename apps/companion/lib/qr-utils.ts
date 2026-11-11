/**
 * QR/barcode value parsing for the scanner, and the one rule for which lookup
 * a scanned value goes to. The scanner screens act on
 * {@link classifyScannedCode} and {@link isForeignCodeMiss} and make no
 * judgement of their own about whether a value is a Shelf code.
 *
 * @see ./server/contract.ts: `isSameOrigin`, used for the server check
 */
import { isSameOrigin } from "./server/contract";

/**
 * Extracts a Shelf QR ID from a scanned barcode value, judging the shape only.
 * It matches `/qr/<id>` on ANY host, so it cannot say whether the value belongs
 * to this server; {@link classifyScannedCode} decides that.
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

/**
 * Which lookup a scanned value goes to.
 *
 * - `qr`: a Shelf QR id for this server; resolve it on the QR route.
 * - `code`: not a Shelf QR at all; the SAM id and workspace barcode paths
 *   decide what it is.
 * - `foreign-barcode`: a canonical `/qr/<id>` URL on another host. It is either
 *   another Shelf server's label, or a label from a previous system that the
 *   workspace linked to an asset or kit as an alternative barcode (ExternalQR).
 *   The value alone cannot tell the two apart, so the workspace barcode lookup
 *   is asked with the full value; {@link isForeignCodeMiss} reads its answer.
 * - `foreign`: the same kind of URL when no barcode lookup is possible, so the
 *   other-server message is the only useful answer.
 */
export type ScannedCodeClassification =
  | { kind: "qr"; qrId: string }
  | { kind: "code" }
  | { kind: "foreign-barcode" }
  | { kind: "foreign" };

/**
 * Classifies a scanned value against the server the app is connected to. This
 * is the app's single rule for "is this a Shelf QR code for this server", the
 * counterpart of the webapp's `isShelfQrCode`.
 *
 * Only the canonical `/qr/<id>` label names the instance that minted it, so it
 * is the only form the origin rule may judge. A short link is minted on a
 * separate shortener domain (`URL_SHORTENER`) that the server never advertises
 * (`/api/mobile/config` carries no shortener field), so its origin says nothing
 * about which instance owns it; it is always treated as this server's.
 *
 * A canonical label on another host never goes to the QR route: its tail is
 * another system's id, not one this server minted. It goes to the barcode
 * lookup instead, because ExternalQR values are stored as the whole URL with
 * their case kept, and the server tries that exact value before uppercasing.
 *
 * This is an affordance, not an authorization control: resolution stays
 * authenticated and org-scoped on the server.
 *
 * @param data - The raw scanned value.
 * @param activeBaseUrl - The active server's base URL.
 * @param barcodeLookupAvailable - Whether this workspace can resolve barcodes
 *   (a workspace is selected and holds the barcode capability).
 */
export function classifyScannedCode(
  data: string,
  activeBaseUrl: string,
  barcodeLookupAvailable: boolean
): ScannedCodeClassification {
  const qrId = extractQrId(data);
  if (!qrId) return { kind: "code" };

  // A bare id carries no host, so it can only be meant for this server.
  // Anything other than the canonical label (a short link) carries an origin
  // that cannot be attributed to any instance, so it is admitted too.
  const isCanonicalUrl = /^https?:\/\/[^/]+\/qr\/[a-zA-Z0-9]+$/.test(data);
  if (!isCanonicalUrl || isSameOrigin(data, activeBaseUrl)) {
    return { kind: "qr", qrId };
  }

  return barcodeLookupAvailable
    ? { kind: "foreign-barcode" }
    : { kind: "foreign" };
}

/**
 * Whether a failed barcode lookup should be reported as "Different Shelf
 * Server" rather than with the server's own message.
 *
 * Only a plain not-found (404) for a `foreign-barcode` value qualifies: none of
 * the caller's workspaces holds it as a barcode, so it is another server's
 * label. Every other failure (linked to nothing, in several workspaces,
 * offline) says something more precise and keeps its own message.
 *
 * @param classification - What {@link classifyScannedCode} returned.
 * @param status - The HTTP status of the failed lookup, absent when there was
 *   no answer.
 */
export function isForeignCodeMiss(
  classification: ScannedCodeClassification,
  status: number | undefined
): boolean {
  return classification.kind === "foreign-barcode" && status === 404;
}
