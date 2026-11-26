/**
 * Request headers that never leave the server in a log line or a Sentry
 * event.
 *
 * Dependency-free on purpose: `server/instrument.server.ts` loads before every
 * other module, and the logger also runs in the browser.
 *
 * @see {@link file://./logger.ts}
 * @see {@link file://./../../server/instrument.server.ts}
 * @see {@link file://./client-ip.server.ts} for `PROXY_SECRET_HEADER`
 */

/**
 * Lowercased header names: credentials, and the secret Shelf's Cloudflare zone
 * adds to prove a request came through it (`PROXY_SECRET_HEADER` in
 * `~/utils/client-ip.server`, written out here so this module stays
 * dependency-free).
 */
export const UNLOGGED_HEADERS: readonly string[] = [
  "cookie",
  "authorization",
  "x-shelf-proxy-secret",
];

/**
 * Returns a copy of the headers without any {@link UNLOGGED_HEADERS} entry,
 * matching names regardless of letter case.
 *
 * @param headers - Header name/value pairs, as Sentry or `Headers.entries()`
 *   give them
 * @returns The remaining headers
 */
export function withoutUnloggedHeaders<V>(
  headers: Record<string, V>
): Record<string, V> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !UNLOGGED_HEADERS.includes(name.toLowerCase())
    )
  );
}
