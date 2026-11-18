import type { Context } from "hono";

import {
  getClientIpFromHeaders,
  getUnverifiedForwardedIp,
} from "~/utils/client-ip.server";

/**
 * Returns the client IP for a request, for use as a rate-limit bucket key.
 *
 * Which header is trusted (Fly edge, Cloudflare behind Fly, or a self-hosted
 * proxy's `X-Forwarded-For`) is decided by `getClientIpFromHeaders`; see that
 * file for the rules.
 *
 * Off Fly without `TRUSTED_PROXY_HOPS`, it falls back to the leftmost
 * `X-Forwarded-For` (see `getUnverifiedForwardedIp`): good enough to keep
 * ordinary visitors in separate in-memory buckets, never forwarded anywhere.
 *
 * `"unknown"` is the last-resort key; it collapses to a single shared bucket,
 * which fail-closes (misconfigured infra still gets throttled rather than waved
 * through).
 *
 * @see {@link file://./../app/utils/client-ip.server.ts}
 */
export function getClientIp(c: Context): string {
  const headers = c.req.raw.headers;
  const verified = getClientIpFromHeaders(headers);
  if (verified) return verified;
  // On Fly the edge headers are the only trusted source; never fall back.
  if (process.env.FLY_APP_NAME) return "unknown";
  return getUnverifiedForwardedIp(headers) ?? "unknown";
}
