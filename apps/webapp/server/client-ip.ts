import type { Context } from "hono";

/**
 * Returns the real client IP for a request.
 *
 * Prefers `Fly-Client-IP` because it is set by the Fly edge and cannot be
 * spoofed by clients. Falls back to the leftmost `X-Forwarded-For` entry for
 * non-Fly environments (e.g. local dev). Returns `"unknown"` as a last resort
 * so callers always have a usable bucket key — `unknown` becomes a single
 * shared bucket, which is fail-closed enough that misconfigured infra still
 * gets throttled.
 */
export function getClientIp(c: Context): string {
  return (
    c.req.header("fly-client-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
