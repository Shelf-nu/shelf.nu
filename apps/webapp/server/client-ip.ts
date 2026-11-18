import type { Context } from "hono";

import { getClientIpFromHeaders } from "~/utils/client-ip.server";

/**
 * Returns the client IP for a request, for use as a rate-limit bucket key.
 *
 * Which header is trusted (Fly edge, Cloudflare behind Fly, or a self-hosted
 * proxy's `X-Forwarded-For`) is decided by `getClientIpFromHeaders`; see that
 * file for the rules.
 *
 * `"unknown"` is the last-resort key; it collapses to a single shared bucket,
 * which fail-closes (misconfigured infra still gets throttled rather than waved
 * through).
 *
 * @see {@link file://./../app/utils/client-ip.server.ts}
 */
export function getClientIp(c: Context): string {
  return getClientIpFromHeaders(c.req.raw.headers) ?? "unknown";
}
