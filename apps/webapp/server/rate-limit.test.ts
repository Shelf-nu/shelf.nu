import { Hono } from "hono";
import { session } from "remix-hono/session";
import { describe, expect, it } from "vitest";

import { appLoaderRateLimit } from "./rate-limit";
import { createSessionStorage } from "./session";

describe("appLoaderRateLimit middleware", () => {
  /**
   * A tiny Hono app mirroring the real `.data`-matcher wiring from
   * `server/index.ts`: only single-fetch loader paths (`*.data`, excluding the
   * `/__*` manifest) are passed through the limiter; everything else is left
   * untouched. The downstream handler always returns 200 so any non-200
   * response can only have come from the limiter's 429 handler.
   *
   * @param limit - Low, deterministic threshold so tests stay fast.
   */
  function makeApp(limit: number) {
    const app = new Hono();
    // Register the real session middleware exactly as production does, so the
    // limiter's `getSession(...)` call resolves to an (empty) session instead
    // of throwing "A session middleware was not set." No cookie is sent in
    // these tests, so `auth?.userId` is undefined and the limiter falls back
    // to the client IP — the realistic anonymous-request path.
    app.use("*", session({ autoCommit: true, createSessionStorage }));
    // Instantiate the limiter ONCE so its in-memory store persists across
    // requests (each call to appLoaderRateLimit() builds a fresh MemoryStore).
    // The `.data` matcher mirrors server/index.ts; only the instantiation site
    // differs.
    const limiter = appLoaderRateLimit(limit);
    app.use("*", async (c, next) => {
      const p = c.req.path;
      if (!p.endsWith(".data") || p.startsWith("/__")) return next();
      return limiter(c, next);
    });
    app.all("*", (c) => c.text("ok"));
    return app;
  }

  /**
   * Fires a request at the given app/path. A unique `x-forwarded-for` header
   * lets each test pin its own identity bucket (no session cookie is sent, so
   * the limiter falls back to `getClientIp`), keeping the per-machine
   * MemoryStore isolated between tests.
   */
  function request(app: Hono, path: string, ip: string) {
    return app.request(`https://app.shelf.nu${path}`, {
      // why: vary the client IP per test so each test owns a distinct
      // (identity, path) bucket and the shared MemoryStore can't leak counts.
      headers: { "x-forwarded-for": ip },
    });
  }

  it("allows requests up to the limit to the same path", async () => {
    const app = makeApp(3);

    for (let i = 0; i < 3; i++) {
      const res = await request(app, "/assets.data", "10.0.0.1");
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 on the request past the limit for the same path", async () => {
    const app = makeApp(3);

    for (let i = 0; i < 3; i++) {
      const res = await request(app, "/assets.data", "10.0.0.2");
      expect(res.status).toBe(200);
    }

    const overLimit = await request(app, "/assets.data", "10.0.0.2");
    expect(overLimit.status).toBe(429);
    expect(await overLimit.json()).toEqual({
      error: { message: "Too many requests. Please try again later." },
    });
  });

  it("buckets per path, so a different path is unaffected by another path's limit", async () => {
    const app = makeApp(3);

    // Exhaust the bucket for /assets.data.
    for (let i = 0; i < 4; i++) {
      await request(app, "/assets.data", "10.0.0.3");
    }

    // Same identity, different path → its own fresh bucket → still 200.
    const otherPath = await request(app, "/bookings.data", "10.0.0.3");
    expect(otherPath.status).toBe(200);
  });

  it("never limits non-`.data` paths", async () => {
    const app = makeApp(3);

    // Well past the limit on an SSE-style route that is not a `.data` loader.
    for (let i = 0; i < 10; i++) {
      const res = await request(app, "/api/sse/notification", "10.0.0.4");
      expect(res.status).toBe(200);
    }
  });
});
