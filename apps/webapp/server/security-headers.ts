/**
 * Security response headers
 *
 * Defines the baseline set of HTTP security headers applied to *every* response
 * the webapp emits — HTML documents, single-fetch `.data` requests, static
 * assets, redirects and error responses alike.
 *
 * The middleware is registered through react-router-hono-server's `beforeAll`
 * hook (see {@link file://./index.ts}). `beforeAll` runs *before* the
 * framework's `serveStatic` handlers and before the app's `configure`
 * middleware (incl. `protect`), so its `await next()` wraps the entire request
 * pipeline. That makes it the single choke point that can decorate
 * static-asset responses — which short-circuit at `serveStatic` and never reach
 * `configure` — as well as dynamic ones. (A per-route `headers` export or
 * `entry.server.tsx` only sees document/loader responses, not static or error
 * responses, which is why neither is used here.)
 *
 * Header choices:
 * - `Strict-Transport-Security` is sent ONLY for the canonical app host
 *   (the host of `SERVER_URL`) and ONLY over HTTPS (detected via the
 *   `x-forwarded-proto` header set by the Cloudflare/Fly proxy layer). This is
 *   deliberately narrow: the same Hono server also answers for the
 *   URL-shortener host (`process.env.URL_SHORTENER`, handled in
 *   {@link file://./index.ts}), and for raw platform hosts (e.g. `*.fly.dev`)
 *   and http health checks. Emitting `includeSubDomains` on any of those would
 *   pin a domain we don't intend to. `preload` is intentionally deferred — it's
 *   a hard-to-reverse commitment.
 * - `Content-Security-Policy` ships in **Report-Only** mode with just
 *   `frame-ancestors 'none'`. A full enforcing policy needs per-request script
 *   nonces, which are not yet wired into `entry.server.tsx`, so enforcing mode
 *   would break React Router's inline hydration scripts. `X-Frame-Options:
 *   DENY` provides the actual (enforced) clickjacking protection meanwhile.
 * - `Permissions-Policy` denies sensitive features the app doesn't use but
 *   explicitly allows `camera=(self)` (the QR/barcode scanner —
 *   `~/components/scanner/code-scanner`) and `geolocation=(self)` (GPS
 *   coordinates form + the public QR scan-location flow). `autoplay=(self)` is
 *   kept allowed because the subscription-success modal autoplays a
 *   same-origin video (`~/components/subscription/successful-subscription-modal`).
 *
 * @see {@link file://./index.ts} — registration via `beforeAll`
 * @see {@link file://./middleware.ts} — the `cache()` middleware whose
 *   set-headers-after-`next()` idiom this follows
 */
import { createMiddleware } from "hono/factory";

/**
 * Restrictive Permissions-Policy (alphabetised for readability).
 *
 * `=()` fully denies a feature; `=(self)` allows it for same-origin only.
 * Only `autoplay`, `camera` and `geolocation` are allowed (each is in active
 * use in the webapp); everything else listed is denied. Features not listed
 * keep the browser default — that's acceptable for low-risk ones, and we
 * explicitly deny the sensitive sensors/payment/usb surfaces.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "browsing-topics=()",
  "camera=(self)",
  "geolocation=(self)",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/**
 * Content-Security-Policy value, shipped via the **Report-Only** header.
 *
 * Starts minimal (`frame-ancestors 'none'`) to begin gathering data without
 * risking breakage. Path to enforcing mode: add script nonces in
 * `entry.server.tsx`, build out `default-src`/`script-src`/`style-src`/…,
 * wire a `report-to`/`report-uri` collection endpoint, then move the value to
 * the enforcing `Content-Security-Policy` header.
 */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = "frame-ancestors 'none'";

/** HSTS: 2 years, include subdomains. `preload` intentionally deferred. */
export const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains";

/**
 * Builds the security-header name→value map for a single response.
 *
 * @param opts.isHttps - whether the original client connection used HTTPS
 *   (derived from `x-forwarded-proto`).
 * @param opts.isCanonicalHost - whether the request targeted the canonical app
 *   host (the host of `SERVER_URL`).
 * @returns header name → value pairs to set on the response. HSTS is included
 *   only when the request is BOTH HTTPS and for the canonical app host.
 */
export function buildSecurityHeaders({
  isHttps,
  isCanonicalHost,
}: {
  isHttps: boolean;
  isCanonicalHost: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
  };

  // Assert HSTS only for the canonical app host over HTTPS. The same server
  // also answers for the URL-shortener host (and raw platform hosts / http
  // health checks); emitting `includeSubDomains` there would pin domains we
  // don't intend to. Browsers ignore HSTS over http anyway.
  if (isHttps && isCanonicalHost) {
    headers["Strict-Transport-Security"] = STRICT_TRANSPORT_SECURITY;
  }

  return headers;
}

/**
 * Whether the original client request used HTTPS, based on the
 * `x-forwarded-proto` header set by the Cloudflare/Fly proxy layer. Handles the
 * comma-separated multi-proxy form (e.g. `"https,http"`) by reading the first
 * value.
 *
 * @param forwardedProto - raw `x-forwarded-proto` header value, if any
 * @returns `true` when the client-facing connection was HTTPS
 */
function isHttpsRequest(forwardedProto: string | undefined): boolean {
  return (forwardedProto ?? "").split(",")[0].trim().toLowerCase() === "https";
}

/**
 * Extracts the lowercased host (`host:port`) from a URL string.
 *
 * @param url - a URL string (e.g. `SERVER_URL`)
 * @returns the lowercased host, or `null` when absent/unparseable
 */
export function hostFromUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Hono middleware that sets the baseline security headers on every response.
 *
 * Headers are set *after* `await next()` (matching the existing `cache()` idiom
 * in {@link file://./middleware.ts}) so they apply to whatever response
 * downstream produced — including `serveStatic` short-circuits, redirects from
 * the `protect`/`urlShortener` middleware, and rendered error pages. `.set()`
 * (rather than append/default) ensures our baseline always wins.
 *
 * The canonical app host is resolved once from `SERVER_URL` (fixed at boot) and
 * used to scope HSTS — see {@link buildSecurityHeaders}.
 *
 * @returns a Hono middleware handler
 */
export function securityHeaders() {
  const canonicalHost = hostFromUrl(process.env.SERVER_URL);

  return createMiddleware(async (c, next) => {
    await next();

    // Prefer the Host header — authoritative behind the Cloudflare/Fly proxy,
    // and what the urlShortener middleware keys on — falling back to the
    // request URL's host if the header is somehow absent.
    const requestHost =
      c.req.header("host")?.toLowerCase() ?? hostFromUrl(c.req.url);

    const headers = buildSecurityHeaders({
      isHttps: isHttpsRequest(c.req.header("x-forwarded-proto")),
      isCanonicalHost: canonicalHost !== null && requestHost === canonicalHost,
    });

    for (const [name, value] of Object.entries(headers)) {
      c.res.headers.set(name, value);
    }
  });
}
