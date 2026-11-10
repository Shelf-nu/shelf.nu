/**
 * Path-scoped guards match every spelling of the route they protect.
 *
 * React Router serves `/API/Mobile/me` and `/api/mobile/me/` from the same
 * route as `/api/mobile/me`, so each guard must count and bound all of them
 * together. The apps here mount the production guard builders exactly as
 * `server/index.ts` does.
 *
 * @see {@link file://./path-guards.ts}
 * @see {@link file://./request-path.ts}
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SENTRY_TUNNEL_MAX_ENVELOPE_BYTES,
  SENTRY_TUNNEL_PATH,
} from "~/utils/constants";
import {
  calendarFeedGuard,
  mobileApiGuard,
  sentryTunnelGuard,
} from "./path-guards";
import { normalizeRequestPath } from "./request-path";

// @vitest-environment node

// why: the limiters emit their 429 trail through Logger.handledClientError,
// which talks to Sentry's structured-log API.
vi.mock("~/utils/logger", () => ({
  Logger: {
    handledClientError: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
  },
}));

/** Mobile limiter ceiling per minute, from `mobileIpRateLimit`. */
const MOBILE_LIMIT = 30;

/** Calendar feed ceiling per minute, from `calendarFeedRateLimit`. */
const CALENDAR_LIMIT = 60;

/** Low tunnel ceiling so the rate tests stay short. */
const TUNNEL_LIMIT = 5;

/**
 * An app with the three guards mounted on `*`, as in `server/index.ts`, and a
 * handler that answers 200 for anything that gets past them.
 */
function buildApp() {
  const app = new Hono();
  app.use("*", mobileApiGuard());
  app.use("*", calendarFeedGuard());
  app.use("*", sentryTunnelGuard(TUNNEL_LIMIT));
  app.all("*", (c) => c.text("ok"));
  return app;
}

/**
 * Sends a request as a given client address.
 *
 * @param app - The app under test
 * @param path - Request path
 * @param ip - Address the Fly edge would stamp
 * @param init - Extra request options (method, body)
 */
function send(app: Hono, path: string, ip: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { "Fly-Client-IP": ip, ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  // why: getClientIp only trusts Fly-Client-IP when running on Fly.
  vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("normalizeRequestPath", () => {
  it.each([
    ["/api/mobile/me", "/api/mobile/me"],
    ["/API/Mobile/Me", "/api/mobile/me"],
    ["/api/mobile/me/", "/api/mobile/me"],
    ["/api/mobile/me///", "/api/mobile/me"],
    ["//api//mobile/me", "/api/mobile/me"],
    ["/", "/"],
    ["//", "/"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeRequestPath(input)).toBe(expected);
  });
});

describe("mobileApiGuard", () => {
  it("counts every spelling of the mobile prefix in one bucket", async () => {
    const app = buildApp();
    const spellings = [
      "/api/mobile/me",
      "/API/MOBILE/me",
      "/api/Mobile/me/",
    ] as const;

    for (let i = 0; i < MOBILE_LIMIT; i++) {
      const res = await send(app, spellings[i % spellings.length], "1.1.1.1");
      expect(res.status).toBe(200);
    }

    for (const path of spellings) {
      expect((await send(app, path, "1.1.1.1")).status).toBe(429);
    }
  });

  it("leaves paths that only share a prefix string alone", async () => {
    const app = buildApp();

    for (let i = 0; i < MOBILE_LIMIT + 5; i++) {
      const res = await send(app, "/api/mobile-other", "1.1.1.2");
      expect(res.status).toBe(200);
    }
  });
});

describe("calendarFeedGuard", () => {
  it("counts a feed's spellings against that feed's budget", async () => {
    const app = buildApp();
    const spellings = [
      "/api/calendar/feed/token-a.ics",
      "/api/Calendar/feed/token-a.ics",
      "/API/CALENDAR/FEED/token-a.ics/",
    ] as const;

    for (let i = 0; i < CALENDAR_LIMIT; i++) {
      const res = await send(app, spellings[i % spellings.length], "2.2.2.2");
      expect(res.status).toBe(200);
    }

    for (const path of spellings) {
      expect((await send(app, path, "2.2.2.2")).status).toBe(429);
    }

    // A different feed keeps its own budget.
    expect(
      (await send(app, "/api/calendar/feed/token-b.ics", "2.2.2.2")).status
    ).toBe(200);
  });
});

describe("sentryTunnelGuard", () => {
  const oversized = "x".repeat(SENTRY_TUNNEL_MAX_ENVELOPE_BYTES + 1);

  it.each([
    ["POST", SENTRY_TUNNEL_PATH],
    ["POST", `${SENTRY_TUNNEL_PATH}/`],
    ["POST", SENTRY_TUNNEL_PATH.toUpperCase()],
    ["PUT", SENTRY_TUNNEL_PATH],
    ["PATCH", SENTRY_TUNNEL_PATH],
    ["DELETE", `${SENTRY_TUNNEL_PATH}/`],
  ])("refuses an oversized %s to %s", async (method, path) => {
    const app = buildApp();

    const res = await send(app, path, "3.3.3.3", { method, body: oversized });

    expect(res.status).toBe(413);
  });

  it("accepts an envelope at the ceiling", async () => {
    const app = buildApp();

    const res = await send(app, SENTRY_TUNNEL_PATH, "3.3.3.4", {
      method: "POST",
      body: "x".repeat(SENTRY_TUNNEL_MAX_ENVELOPE_BYTES),
    });

    expect(res.status).toBe(200);
  });

  it("counts every method and spelling that reaches the action in one bucket", async () => {
    const app = buildApp();
    const attempts = [
      ["POST", SENTRY_TUNNEL_PATH],
      ["PUT", SENTRY_TUNNEL_PATH],
      ["POST", `${SENTRY_TUNNEL_PATH}/`],
      ["PATCH", SENTRY_TUNNEL_PATH.toUpperCase()],
      ["DELETE", SENTRY_TUNNEL_PATH],
    ] as const;

    for (const [method, path] of attempts.slice(0, TUNNEL_LIMIT)) {
      const res = await send(app, path, "3.3.3.5", { method, body: "{}" });
      expect(res.status).toBe(200);
    }

    const blocked = await send(app, `${SENTRY_TUNNEL_PATH}/`, "3.3.3.5", {
      method: "PUT",
      body: "{}",
    });
    expect(blocked.status).toBe(429);
  });

  it("does not spend the budget on methods that carry no envelope", async () => {
    const app = buildApp();

    for (let i = 0; i < TUNNEL_LIMIT * 3; i++) {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        const res = await send(app, SENTRY_TUNNEL_PATH, "3.3.3.6", { method });
        expect(res.status).toBe(200);
      }
    }

    const envelope = await send(app, SENTRY_TUNNEL_PATH, "3.3.3.6", {
      method: "POST",
      body: "{}",
    });
    expect(envelope.status).toBe(200);
  });
});
