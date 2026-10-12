/**
 * The mobile API's error envelope, read into a typed shape.
 *
 * Every mobile route answers a refusal with `{ error: { message, … } }`. This
 * module turns a parsed response body into {@link ApiErrorDetails}, keeping
 * only the fields the app branches on and only when they have the right type.
 * Pure (no React Native, Expo or `@/` imports), so its test runs under Node.
 *
 * @see ./client.ts apiFetch, the one caller
 * @see ./error-details.test.ts
 */

/**
 * Structured error payload from the mobile API's `{ error: { … } }` envelope.
 * `message` mirrors the flat `error` string consumers already display.
 * `reason` is an additive machine-readable discriminator some endpoints emit.
 * Branch on `reason`, never on `message` text: messages are human copy and can
 * change, the reason field is the wire contract. Today it is one of:
 *
 * - `"unclaimed"` on the QR RESOLVE routes (the link route claims unclaimed
 *   codes inline and does not emit it), with `qrId` echoing the scanned code.
 * - `"archived"` on the scan-list routes (bulk custody, bulk location, scan to
 *   a booking), with `archivedAssetIds`: the requested assets refused because
 *   they are archived, so the app can mark exactly those rows.
 */
export type ApiErrorDetails = {
  message: string;
  reason?: string;
  qrId?: string;
  archivedAssetIds?: string[];
};

/**
 * Extracts the structured error payload from a parsed non-OK response body.
 *
 * @param json - The parsed response body (unknown: may be an HTML error page
 *   coerced to null, an empty body, or a proxy's own JSON).
 * @returns The typed error payload, or `null` when the body doesn't match the
 *   mobile API's `{ error: { message } }` envelope.
 */
export function extractErrorDetails(json: unknown): ApiErrorDetails | null {
  if (typeof json !== "object" || json === null) return null;
  const err = (json as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return null;
  const { message, reason, qrId, archivedAssetIds } = err as {
    message?: unknown;
    reason?: unknown;
    qrId?: unknown;
    archivedAssetIds?: unknown;
  };
  if (typeof message !== "string") return null;
  return {
    message,
    ...(typeof reason === "string" ? { reason } : {}),
    ...(typeof qrId === "string" ? { qrId } : {}),
    ...(Array.isArray(archivedAssetIds)
      ? {
          archivedAssetIds: archivedAssetIds.filter(
            (id): id is string => typeof id === "string"
          ),
        }
      : {}),
  };
}
