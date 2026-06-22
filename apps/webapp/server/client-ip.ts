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
 * limit entirely. It is gated to non-production only, where it exists purely for
 * local dev (no Fly edge to set `Fly-Client-IP`). `"unknown"` is the last-resort
 * key; it collapses to a single shared bucket, which fail-closes (misconfigured
 * infra still gets throttled rather than waved through).
 *
 * NOTE: behind Cloudflare, `Fly-Client-IP` is Cloudflare's edge IP rather than
 * the end user's, so IP buckets are coarse. That is acceptable here because the
 * primary rate-limit key is the signed-session `userId` (see `appLoaderRateLimit`
 * in `./rate-limit`); IP is only a fallback. True per-user IP precision would
 * mean trusting `CF-Connecting-IP` gated by a Cloudflare-range check or origin
 * lock — deliberately out of scope.
 */
export function getClientIp(c: Context): string {
  const flyClientIp = c.req.header("fly-client-ip");
  if (flyClientIp) {
    return flyClientIp;
  }

  // Spoofable, so trusted only outside production (local dev has no Fly edge).
  if (process.env.NODE_ENV !== "production") {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) {
      return forwarded;
    }
  }

  return "unknown";
}
