import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSecurityHeaders,
  hostFromUrl,
  securityHeaders,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
} from "./security-headers";

describe("buildSecurityHeaders", () => {
  it("always sets the baseline static headers", () => {
    const headers = buildSecurityHeaders({
      isHttps: false,
      isCanonicalHost: true,
    });

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(
      CONTENT_SECURITY_POLICY_REPORT_ONLY
    );
  });

  it("sets HSTS only when the request is HTTPS AND for the canonical host", () => {
    const hsts = (isHttps: boolean, isCanonicalHost: boolean) =>
      buildSecurityHeaders({ isHttps, isCanonicalHost })[
        "Strict-Transport-Security"
      ];

    expect(hsts(true, true)).toBe(STRICT_TRANSPORT_SECURITY);
    expect(hsts(false, true)).toBeUndefined(); // http
    expect(hsts(true, false)).toBeUndefined(); // non-canonical host (e.g. shortener)
    expect(hsts(false, false)).toBeUndefined();
  });

  it("allows camera + geolocation for self and blocks unused sensors", () => {
    // Both are in active use (scanner + public-QR geolocation) — denying them
    // would silently break those features.
    expect(PERMISSIONS_POLICY).toContain("camera=(self)");
    expect(PERMISSIONS_POLICY).toContain("geolocation=(self)");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).toContain("payment=()");
  });

  it("does not disable autoplay (subscription-success modal plays a video)", () => {
    expect(PERMISSIONS_POLICY).not.toContain("autoplay=()");
    expect(PERMISSIONS_POLICY).toContain("autoplay=(self)");
  });

  it("ships CSP as report-only scaffolding, not enforcing", () => {
    expect(CONTENT_SECURITY_POLICY_REPORT_ONLY).toContain(
      "frame-ancestors 'none'"
    );
  });
});

describe("hostFromUrl", () => {
  it("returns the lowercased host (with port if present)", () => {
    expect(hostFromUrl("https://app.shelf.nu")).toBe("app.shelf.nu");
    expect(hostFromUrl("https://APP.Shelf.NU/login")).toBe("app.shelf.nu");
    expect(hostFromUrl("http://localhost:3000")).toBe("localhost:3000");
  });

  it("returns null for missing or unparseable input", () => {
    expect(hostFromUrl(undefined)).toBeNull();
    expect(hostFromUrl("")).toBeNull();
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

describe("securityHeaders middleware", () => {
  // why: securityHeaders() reads SERVER_URL once when constructed to resolve the
  // canonical host, so each test sets it before calling makeApp(). Saved/restored
  // to avoid leaking between tests.
  const originalServerUrl = process.env.SERVER_URL;

  beforeEach(() => {
    process.env.SERVER_URL = "https://app.shelf.nu";
  });

  afterEach(() => {
    process.env.SERVER_URL = originalServerUrl;
  });

  /**
   * A tiny Hono app mirroring the real pipeline: `securityHeaders()` registered
   * first (as the `beforeAll` hook does), then a short-circuiting static-like
   * handler and a normal dynamic route. This proves headers land on responses
   * that never call `next()` (static assets) as well as ordinary ones.
   */
  function makeApp() {
    const app = new Hono();
    app.use("*", securityHeaders());
    // Static-like handler: a route that responds without calling downstream,
    // mirroring serveStatic short-circuiting for an existing file.
    app.get("/static/*", (c) => c.text("asset"));
    app.get("/login", (c) => c.html("<h1>login</h1>"));
    return app;
  }

  it("sets headers on a normal dynamic response", async () => {
    const res = await makeApp().request("https://app.shelf.nu/login");

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(res.headers.get("Permissions-Policy")).toContain("camera=(self)");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "frame-ancestors 'none'"
    );
  });

  it("sets headers on a short-circuiting static-like response", async () => {
    const res = await makeApp().request("https://app.shelf.nu/static/app.js");

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("emits HSTS for the canonical host over HTTPS", async () => {
    const res = await makeApp().request("https://app.shelf.nu/login", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(res.headers.get("Strict-Transport-Security")).toBe(
      STRICT_TRANSPORT_SECURITY
    );
  });

  it("omits HSTS over http even on the canonical host", async () => {
    const res = await makeApp().request("https://app.shelf.nu/login");

    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("omits HSTS on a non-canonical host (e.g. the URL-shortener) even over HTTPS", async () => {
    // Same server, different host (the short domain) — must NOT be HSTS-pinned.
    const res = await makeApp().request("https://eam.sh/abc123", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    // ...but the host-independent headers are still applied.
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
