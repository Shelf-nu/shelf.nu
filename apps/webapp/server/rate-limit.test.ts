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
   * and `error()`/`logException()` never run. With the client boundary also
   * skipping 429 by design, this trail is the only thing that makes a rate
   * limit visible in Sentry and attributable to a user. These tests pin it.
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

/**
 * Direct unit tests for the telemetry throttle.
 *
 * Driven through the exported `shouldEmitTelemetry` with an injected clock
 * rather than over HTTP: saturating the tracker takes thousands of distinct
 * buckets, which would mean tens of thousands of requests through Hono.
 *
 * Each test re-imports the module so the module-scope tracker starts empty —
 * a shared tracker would let one test's buckets suppress the next test's.
 */
describe("telemetry throttle saturation", () => {
  const MAX = 5_000;
  const WINDOW = 60_000;

  async function freshModule() {
    vi.resetModules();
    return import("./rate-limit");
  }

  it("keeps a bucket suppressed even after the tracker fills with other buckets", async () => {
    // why: evicting a live suppressor to make room lets its bucket emit again
    // inside its own window, degrading the throttle to roughly one entry per
    // request — exactly what it exists to prevent.
    const { shouldEmitTelemetry } = await freshModule();
    const now = 1_000_000;

    expect(shouldEmitTelemetry("victim", now)).toBe(true);

    // Fill well past the cap, all inside the victim's window.
    for (let i = 0; i < MAX + 500; i++) {
      shouldEmitTelemetry(`filler-${i}`, now + 1);
    }

    expect(shouldEmitTelemetry("victim", now + WINDOW - 1)).toBe(false);
  });

  it("never grows past the cap", async () => {
    const { shouldEmitTelemetry } = await freshModule();
    const now = 2_000_000;

    for (let i = 0; i < MAX + 1_000; i++) {
      shouldEmitTelemetry(`bucket-${i}`, now);
    }

    // Every survivor is live, so the tracker refuses new buckets rather than
    // evicting — and the map cannot exceed its ceiling.
    expect(shouldEmitTelemetry("one-more", now)).toBe(false);
  });

  it("lets a bucket emit again once its own window has expired", async () => {
    const { shouldEmitTelemetry } = await freshModule();
    const now = 3_000_000;

    expect(shouldEmitTelemetry("recurring", now)).toBe(true);
    expect(shouldEmitTelemetry("recurring", now + WINDOW - 1)).toBe(false);
    expect(shouldEmitTelemetry("recurring", now + WINDOW)).toBe(true);
  });

  it("recovers once the saturating buckets age out", async () => {
    // Fail-closed silence must self-heal — otherwise one flood would mute
    // telemetry permanently on that machine.
    const { shouldEmitTelemetry } = await freshModule();
    const now = 4_000_000;

    for (let i = 0; i < MAX + 100; i++) {
      shouldEmitTelemetry(`flood-${i}`, now);
    }
    expect(shouldEmitTelemetry("after-flood", now)).toBe(false);

    // A full window later the flood's entries can no longer suppress anything.
    expect(shouldEmitTelemetry("after-flood", now + WINDOW)).toBe(true);
  });

  it("reports saturation once per window instead of silently dropping", async () => {
    // why: a fail-closed branch that logs nothing is indistinguishable from
    // "no rate limiting happened" — a silent empty result that looks healthy.
    const { shouldEmitTelemetry } = await freshModule();
    mockHandledClientError.mockReset();
    const now = 5_000_000;

    for (let i = 0; i < MAX + 200; i++) {
      shouldEmitTelemetry(`sat-${i}`, now);
    }

    const saturationLogs = mockHandledClientError.mock.calls.filter(
      (call) =>
        typeof call[0]?.message === "string" &&
        call[0].message.includes("saturated")
    );
    expect(saturationLogs).toHaveLength(1);
    expect(saturationLogs[0][0].label).toBe("Rate limit");
  });
});
