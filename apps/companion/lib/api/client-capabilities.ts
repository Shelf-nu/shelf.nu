/**
 * Capabilities the app announces to the Shelf server.
 *
 * Every API request carries `X-Shelf-Capabilities` with the tokens below, so
 * the server sends the newer response and question shapes this build
 * understands. A build without a token gets the shape it already knows: the
 * header is how old builds stay "old".
 *
 * - `booking-sources`: the app shows a pool slice's planned sources, offers
 *   "As planned" in the check-out source question, and can hand a hand-set
 *   split back to Shelf on adjust quantity.
 *
 * Add a token only once every screen it changes handles the new shape. Pure,
 * so the Node test runner can cover it.
 *
 * @see ../../../webapp/app/modules/api/capabilities.server.ts the server side
 * @see ./client.ts where the header is attached
 */

/** Name of the request header that carries the app's capabilities. */
export const CAPABILITIES_HEADER = "X-Shelf-Capabilities";

/** Tokens this build announces. */
export const CLIENT_CAPABILITIES = ["booking-sources"] as const;

/**
 * The capability header for one request.
 *
 * @returns `{ "X-Shelf-Capabilities": "booking-sources" }`, tokens joined by
 *   commas
 */
export function clientCapabilityHeaders(): Record<string, string> {
  return { [CAPABILITIES_HEADER]: CLIENT_CAPABILITIES.join(",") };
}
