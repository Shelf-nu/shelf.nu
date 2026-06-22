import type { Context } from "hono";

/**
 * Returns the client IP for a request, for use as a rate-limit bucket key.
 *
 * Prefers `Fly-Client-IP`, which the Fly edge sets on every request and which a
 * client cannot forge. In production every request arrives through the Fly
 * edge, so this header is always present and is the only trusted source.
 *
 * `X-Forwarded-For` is **client-supplied and therefore spoofable** — an attacker
 * could rotate it to mint a fresh rate-limit bucket per request and bypass the
 * limit entirely. On Fly we never trust it: `Fly-Client-IP` (returned above) is
 * always set by the edge, and the `FLY_APP_NAME` runtime variable lets us refuse
 * XFF outright even in the impossible case that header were absent. Off Fly —
 * self-hosted deployments behind a trusted reverse proxy (Docker, etc.) and
 * local dev — there is no `Fly-Client-IP`, so we fall back to the leftmost
 * `X-Forwarded-For`; the operator's proxy is responsible for setting a
 * trustworthy value. `"unknown"` is the last-resort key; it collapses to a
 * single shared bucket, which fail-closes (misconfigured infra still gets
 * throttled rather than waved through).
 *
 * NOTE: behind Cloudflare, `Fly-Client-IP` (or a proxy's XFF) is the CF/edge IP
 * rather than the end user's, so IP buckets are coarse. That is acceptable here
 * because the primary rate-limit key is the signed-session `userId` (see
 * `appLoaderRateLimit` in `./rate-limit`); IP is only a fallback. True per-user
 * IP precision would mean trusting `CF-Connecting-IP` gated by a Cloudflare-range
 * check or origin lock — deliberately out of scope.
 */
export function getClientIp(c: Context): string {
  const flyClientIp = c.req.header("fly-client-ip");
  if (flyClientIp) {
    return flyClientIp;
  }

  // X-Forwarded-For is client-spoofable. Trust it only when NOT on Fly's edge
  // (self-hosted-behind-proxy or local dev); on Fly, `Fly-Client-IP` above is
  // authoritative and a spoofed XFF must never be allowed to mint a bucket.
  const onFly = Boolean(process.env.FLY_APP_NAME);
  if (!onFly) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return "unknown";
}
