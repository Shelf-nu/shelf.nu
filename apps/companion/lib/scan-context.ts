/**
 * Scan context header for recording resolves.
 *
 * The barcode resolve (`/api/mobile/barcode/:value`) records every lookup as a
 * scan. Without a context it records a `COMPANION` scan and writes a note on
 * the scanned asset's Activity tab. The audit scanner resolves barcodes
 * through the same route, so it marks its calls with `X-Scan-Context: audit`:
 * the server then records an `AUDIT` scan with no note, because the audit
 * keeps its own trail.
 *
 * Kept free of React Native / Expo imports so it runs under Node's test runner.
 *
 * @see ./api/assets.ts (`barcode`)
 * @see apps/webapp/app/routes/api+/mobile+/barcode.$value.ts (the consuming route)
 */

/** Where a recording resolve was made from. Omitted = the normal scanner. */
export type ScanContext = "audit";

/**
 * Headers that tell the server which scanner made a recording resolve.
 *
 * @param context - `"audit"` from the audit scanner; omit for the normal
 *   scanner, which keeps recording `COMPANION` scans with a note.
 * @returns `{ "X-Scan-Context": "audit" }` for audits, otherwise no headers.
 */
export function scanContextHeaders(
  context?: ScanContext
): Record<string, string> {
  return context ? { "X-Scan-Context": context } : {};
}
