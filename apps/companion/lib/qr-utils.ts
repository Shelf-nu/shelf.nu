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
 * @param data - The raw scanned value.
 * @param activeBaseUrl - The active server's base URL.
 * @returns `{ kind: "id" }` when usable here, `{ kind: "foreign" }` for a Shelf
 *   URL belonging to another server, `{ kind: "unknown" }` for anything that
 *   isn't a Shelf code at all.
 */
export function classifyScannedCode(
  data: string,
  activeBaseUrl: string
): ScannedCodeClassification {
  const qrId = extractQrId(data);
  if (!qrId) return { kind: "unknown" };

  // A bare id carries no host, so it can only be meant for this server.
  if (!/^https?:\/\//i.test(data)) return { kind: "id", qrId };

  return isSameOrigin(data, activeBaseUrl)
    ? { kind: "id", qrId }
    : { kind: "foreign" };
}
