/**
 * Reading a path parameter that may legitimately contain `/` or `%`.
 *
 * React Router percent-decodes each path segment and then re-encodes any
 * decoded `/` back to `%2F`, so a decoded value can never alter the path
 * structure. That round trip is lossy: a value that really contains a slash and
 * a value whose literal text is `%2F` both arrive at the loader as `%2F`, and
 * nothing downstream can tell them apart.
 *
 * The request URL still carries the segment exactly as it was sent, so decoding
 * that once recovers the original in both cases. Scanned codes are the reason
 * this matters — Code128 and DataMatrix permit `/` and `%` alike, so both
 * shapes are ordinary input rather than edge cases.
 *
 * @see {@link file://./../routes/api+/get-scanned-barcode.$value.ts}
 * @see {@link file://./../routes/api+/mobile+/barcode.$value.ts}
 */

/**
 * The last path segment of a request URL, decoded exactly once.
 *
 * @param request - The incoming request; only its URL is read
 * @param fallback - Returned when the segment cannot be decoded, which happens
 *   when a caller sends a bare `%` that is not part of an escape. The caller's
 *   already-decoded route param is the sensible thing to pass: it is what the
 *   router made of the same segment.
 * @returns The segment as the client sent it, or `fallback` if it will not decode
 */
export function readRawLastPathSegment(
  request: Request,
  fallback: string
): string {
  const segments = new URL(request.url).pathname.split("/");
  const raw = segments[segments.length - 1];

  if (!raw) {
    return fallback;
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed escape (`50%` sent unencoded) is not decodable. The router's
    // own `decodePath` swallows the same failure and hands back the segment
    // untouched, so falling back to its result keeps the two consistent.
    return fallback;
  }
}
