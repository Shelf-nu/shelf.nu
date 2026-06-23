import type { Context } from "hono";

/**
 * Returns the client IP for a request, for use as a rate-limit bucket key.
 *
 * The trusted header depends on where we run, so we branch on the `FLY_APP_NAME`
 * runtime marker FIRST and trust only that environment's header — never the
 * other, which would be client-spoofable:
 *
 * - **On Fly** (`FLY_APP_NAME` set): trust only `Fly-Client-IP`, which the Fly
 *   edge sets on every request and strips from client input, so it cannot be
 *   forged. `X-Forwarded-For` is ignored entirely.
 * - **Off Fly** (self-hosted behind a trusted reverse proxy — Docker, etc. — or
 *   local dev): there is no Fly edge, so `Fly-Client-IP` would itself be just a
 *   client-supplied header and must NOT be trusted (an attacker could rotate it
 *   to mint a fresh rate-limit bucket per request). Fall back to the leftmost
 *   `X-Forwarded-For`; the operator's proxy is responsible for setting a
 *   trustworthy value.
 *
 * `"unknown"` is the last-resort key; it collapses to a single shared bucket,
 * which fail-closes (misconfigured infra still gets throttled rather than waved
 * through).
 *
 * NOTE: behind Cloudflare, the trusted header is the CF/edge IP rather than the
 * end user's, so IP buckets are coarse. That is acceptable here because the
 * primary rate-limit key is the signed-session `userId` (see `appLoaderRateLimit`
 * in `./rate-limit`); IP is only a fallback. True per-user IP precision would
 * mean trusting `CF-Connecting-IP` gated by a Cloudflare-range check or origin
 * lock — deliberately out of scope.
 */
export function getClientIp(c: Context): string {
  // On Fly the edge sets (and sanitizes) `Fly-Client-IP`; it is the only trusted
  // source there, and a client-supplied `X-Forwarded-For` is ignored.
  const onFly = Boolean(process.env.FLY_APP_NAME);
  if (onFly) {
    return c.req.header("fly-client-ip")?.trim() || "unknown";
  }

  // Off Fly, `Fly-Client-IP` would be client-spoofable, so it is NOT consulted.
  // Trust only the proxy-set leftmost `X-Forwarded-For` (self-host/local dev).
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
