import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  buildSecurityHeaders,
  securityHeaders,
  CONTENT_SECURITY_POLICY_REPORT_ONLY,
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
} from "./security-headers";

describe("buildSecurityHeaders", () => {
  it("always sets the baseline static headers", () => {
    const headers = buildSecurityHeaders({ isHttps: false });

    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    expect(headers["Content-Security-Policy-Report-Only"]).toBe(
      CONTENT_SECURITY_POLICY_REPORT_ONLY
    );
  });

  it("omits HSTS over http and includes it over https", () => {
    expect(
      buildSecurityHeaders({ isHttps: false })["Strict-Transport-Security"]
    ).toBeUndefined();
    expect(
      buildSecurityHeaders({ isHttps: true })["Strict-Transport-Security"]
    ).toBe(STRICT_TRANSPORT_SECURITY);
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

describe("securityHeaders middleware", () => {
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
    const res = await makeApp().request("/login");

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
    const res = await makeApp().request("/static/app.js");

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("emits HSTS only when x-forwarded-proto is https", async () => {
    const app = makeApp();

    const httpRes = await app.request("/login");
    expect(httpRes.headers.get("Strict-Transport-Security")).toBeNull();

    const httpsRes = await app.request("/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(httpsRes.headers.get("Strict-Transport-Security")).toBe(
      STRICT_TRANSPORT_SECURITY
    );
  });
});
