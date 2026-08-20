import { Hono } from "hono";
import { session } from "remix-hono/session";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appLoaderRateLimit, calendarFeedRateLimit } from "./rate-limit";
import { createSessionStorage } from "./session";

const mockHandledClientError = vi.hoisted(() => vi.fn());

// why: the limiters emit their 429 trail through Logger.handledClientError,
// which talks to Sentry's structured-log API — capture the call instead.
vi.mock("~/utils/logger", () => ({
  Logger: {
    handledClientError: mockHandledClientError,
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

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

  /**
   * The limiter short-circuits in Hono middleware, so no `ShelfError` is built
   * and `error()`/`logException()` never run. Combined with the client
   * boundary deliberately not capturing 429s, that made rate limiting
   * invisible in every Sentry dataset — a customer report of "too many
   * requests" could not be confirmed after the fact. These tests pin the
   * replacement trail.
   */
  describe("observability", () => {
    beforeEach(() => {
      mockHandledClientError.mockReset();
    });

    it("records a rate-limited request on the handled-4xx log trail", async () => {
      const app = makeApp(1);

      await request(
        app,
        "/bookings/abc123/overview/manage-kits.data",
        "10.1.0.1"
      );
      expect(mockHandledClientError).not.toHaveBeenCalled();

      const overLimit = await request(
        app,
        "/bookings/abc123/overview/manage-kits.data",
        "10.1.0.1"
      );
      expect(overLimit.status).toBe(429);

      expect(mockHandledClientError).toHaveBeenCalledTimes(1);
      const logged = mockHandledClientError.mock.calls[0][0];
      expect(logged.status).toBe(429);
      expect(logged.label).toBe("Rate limit");
      // Never an error event — this is an expected, transient condition.
      expect(logged.shouldBeCaptured).toBe(false);
      // The path names the surface the user was on, which is what makes a
      // customer report actionable.
      expect(logged.message).toContain("app-loader");
      expect(logged.message).toContain(
        "/bookings/abc123/overview/manage-kits.data"
      );
    });

    it("emits at most once per bucket per window, however long the flood runs", async () => {
      // why: hono-rate-limiter runs the 429 handler for EVERY request once a
      // bucket is over its limit, so an unthrottled emit would let a runaway
      // client (or, via the pre-auth mobile limiter, an attacker) flood the
      // logs quota and bury the very trail this telemetry exists to keep.
      const app = makeApp(1);

      for (let i = 0; i < 50; i++) {
        await request(app, "/assets.data", "10.2.0.1");
      }

      expect(mockHandledClientError).toHaveBeenCalledTimes(1);
    });

    it("still logs separately for distinct buckets", async () => {
      // The throttle must not collapse unrelated incidents into one entry —
      // two different users hitting the same surface are two incidents.
      const app = makeApp(1);

      for (const ip of ["10.3.0.1", "10.3.0.2", "10.3.0.3"]) {
        await request(app, "/assets.data", ip);
        await request(app, "/assets.data", ip);
      }

      expect(mockHandledClientError).toHaveBeenCalledTimes(3);
    });

    it("does not log the client IP for anonymous requests", async () => {
      const app = makeApp(1);

      await request(app, "/assets.data", "203.0.113.77");
      await request(app, "/assets.data", "203.0.113.77");

      const logged = mockHandledClientError.mock.calls[0][0];
      expect(JSON.stringify(logged.additionalData ?? {})).not.toContain(
        "203.0.113.77"
      );
      expect(logged.message).not.toContain("203.0.113.77");
    });

    it("never puts the calendar feed's secret token in the log trail", async () => {
      // why: calendarFeedRateLimit keys on the request PATH, which embeds the
      // feed's secret token. Logging that path verbatim would leak the secret
      // into Sentry.
      const secret = "s3cr3t-feed-token-do-not-log";
      const app = new Hono();
      const limiter = calendarFeedRateLimit();
      app.use("*", limiter);
      app.all("*", (c) => c.text("ok"));

      // The limiter's default budget is 60/min; exhaust it, then trip it.
      for (let i = 0; i <= 60; i++) {
        await app.request(`https://app.shelf.nu/api/calendar/feed/${secret}`);
      }

      expect(mockHandledClientError).toHaveBeenCalled();
      const logged = mockHandledClientError.mock.calls[0][0];
      expect(logged.message).not.toContain(secret);
      expect(logged.message).toContain("redacted");
    });
  });
});
