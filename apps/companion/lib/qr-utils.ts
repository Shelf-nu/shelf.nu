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
