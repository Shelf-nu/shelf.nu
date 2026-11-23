/**
 * Client capability header.
 *
 * Clients that understand a newer response or question shape announce it in
 * the `X-Shelf-Capabilities` header as comma-separated tokens. The server
 * reads it to decide whether to send that shape; a client without the header
 * (an older companion build, a script) gets the behaviour it already knows.
 *
 * Tokens are matched case-insensitively after trimming whitespace, so
 * `X-Shelf-Capabilities: Booking-Sources , other` announces `booking-sources`.
 *
 * @see {@link file://./mobile-auth.server.ts} the other `x-shelf-*` request header
 */

/** Name of the request header that carries the client's capabilities. */
export const CAPABILITIES_HEADER = "X-Shelf-Capabilities";

/**
 * Capabilities a client can announce.
 * - `booking-sources`: understands per-source booking slices and can answer
 *   the source question at check-out.
 */
export type ClientCapability = "booking-sources";

/**
 * Tells whether the request's client announced a capability.
 *
 * @param request - The incoming request
 * @param capability - The capability token to look for
 * @returns True when the header lists the token; false when the header is
 *   absent, empty, or lists other tokens only
 */
export function clientHasCapability(
  request: Request,
  capability: ClientCapability
): boolean {
  const header = request.headers.get(CAPABILITIES_HEADER);
  if (!header) return false;
  const wanted = capability.toLowerCase();
  return header
    .split(",")
    .some((token) => token.trim().toLowerCase() === wanted);
}
