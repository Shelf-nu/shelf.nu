import type { Context } from "hono";

import {
  getClientIpFromHeaders,
  getTrustedProxyHops,
  getUnverifiedForwardedIp,
  rateLimitKeyForIp,
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
 * With `TRUSTED_PROXY_HOPS` set there is no fallback: a request whose chain
 * cannot be resolved gets `"unknown"`.
 *
 * IPv6 addresses count by their /64 (see `rateLimitKeyForIp`), since one
 * visitor usually holds the whole range.
 *
 * `"unknown"` is the last-resort key; it collapses to a single shared bucket,
 * which fail-closes (misconfigured infra still gets throttled rather than waved
 * through).
 *
 * @see {@link file://./../app/utils/client-ip.server.ts}
 */
export function getClientIp(c: Context): string {
  const ip = resolveBucketIp(c.req.raw.headers);
  return ip ? rateLimitKeyForIp(ip) : "unknown";
}

/**
 * Returns the client IP for a request only when a trusted source vouches for
 * it (the Fly edge, Cloudflare behind Fly, or `TRUSTED_PROXY_HOPS`), for
 * limiters on routes where a caller choosing its own bucket is the abuse.
 *
 * Unlike {@link getClientIp}, it never falls back to the leftmost
 * `X-Forwarded-For`, which a caller can write. A request without a trusted
 * address gets `"unknown"`, so on a self-hosted instance without
 * `TRUSTED_PROXY_HOPS` every visitor shares one bucket: coarse, but a caller
 * cannot rotate the header to escape the limit.
 *
 * @param c - The Hono request context
 * @returns The bucket key for the visitor's address, or `"unknown"`
 */
export function getVerifiedClientIp(c: Context): string {
  const ip = getClientIpFromHeaders(c.req.raw.headers);
  return ip ? rateLimitKeyForIp(ip) : "unknown";
}

/**
 * The address a request's rate-limit bucket is keyed by, before IPv6
 * addresses are grouped by their /64.
 *
 * @param headers - The incoming request's headers
 */
function resolveBucketIp(headers: Headers): string | null {
  const verified = getClientIpFromHeaders(headers);
  if (verified) return verified;
  // On Fly the edge headers are the only trusted source; never fall back.
  if (process.env.FLY_APP_NAME) return null;
  // An operator who set TRUSTED_PROXY_HOPS named the only trusted entry; a
  // chain too short to hold it gets the shared bucket, never a client value.
  if (getTrustedProxyHops() !== null) return null;
  return getUnverifiedForwardedIp(headers);
}
