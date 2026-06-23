import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mobileIpRateLimit } from "@server/rate-limit";

// @vitest-environment node

function buildApp() {
  const app = new Hono();
  app.use("/api/mobile/*", mobileIpRateLimit());
  app.get("/api/mobile/me", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

function fire(app: Hono, ip: string, path = "/api/mobile/me") {
  return app.request(path, {
    method: "GET",
    headers: { "Fly-Client-IP": ip },
  });
}

describe("mobileIpRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // why: these cases exercise the Fly-Client-IP path, which getClientIp only
    // trusts when on Fly (FLY_APP_NAME set). Simulate the Fly runtime.
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("allows requests under the limit and blocks when exceeded", async () => {
    const app = buildApp();
    const ip = "1.2.3.4";

    // 30 allowed in the 60s window
    for (let i = 0; i < 30; i++) {
      const res = await fire(app, ip);
      expect(res.status).toBe(200);
    }

    // 31st must be rate limited
    const blocked = await fire(app, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    const body = await blocked.json();
    expect(body).toEqual({
      error: { message: "Too many requests. Please try again later." },
    });
  });

  it("does not affect non-mobile paths", async () => {
    const app = buildApp();
    for (let i = 0; i < 50; i++) {
      const res = await fire(app, "1.2.3.4", "/health");
      expect(res.status).toBe(200);
    }
  });

  it("buckets are per-IP", async () => {
    const app = buildApp();
    // Burn IP A to the limit
    for (let i = 0; i < 30; i++) {
      await fire(app, "10.0.0.1");
    }
    // IP B should still pass
    const res = await fire(app, "10.0.0.2");
    expect(res.status).toBe(200);
  });

  it("falls back to x-forwarded-for when fly-client-ip is absent", async () => {
    // why: XFF is only trusted off Fly; override the beforeEach Fly stub to
    // simulate a self-hosted deployment behind a trusted proxy.
    vi.stubEnv("FLY_APP_NAME", "");
    const app = new Hono();
    app.use("/api/mobile/*", mobileIpRateLimit());
    app.get("/api/mobile/me", (c) => c.json({ ok: true }));

    for (let i = 0; i < 30; i++) {
      const res = await app.request("/api/mobile/me", {
        headers: { "X-Forwarded-For": "9.9.9.9, 10.0.0.5" },
      });
      expect(res.status).toBe(200);
    }
    const blocked = await app.request("/api/mobile/me", {
      headers: { "X-Forwarded-For": "9.9.9.9, 10.0.0.5" },
    });
    expect(blocked.status).toBe(429);
  });
});
