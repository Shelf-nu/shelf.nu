/**
 * The Sentry tunnel's two halves: reachable without a session, and bounded.
 *
 * Making the path public is what fixes the lost reports, and it is also what
 * turns the endpoint into an anonymous POST relay into our own Sentry project.
 * The limit is the other half of that change, so it is pinned here.
 *
 * @see {@link file://./../../server/rate-limit.ts} `sentryTunnelRateLimit`
 * @see {@link file://./../../server/index.ts} where it is scoped and bypassed
 */
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyLimit } from "hono/body-limit";
import { sentryTunnelRateLimit } from "@server/rate-limit";
import {
  SENTRY_TUNNEL_MAX_ENVELOPE_BYTES,
  SENTRY_TUNNEL_PATH,
} from "~/utils/constants";

// @vitest-environment node

/**
 * A low, deterministic ceiling. The production default is far looser, for the
 * reasons in `sentryTunnelRateLimit`; what is pinned here is the behaviour.
 */
const LIMIT = 5;

/** Mirrors how `server/index.ts` mounts the tunnel's two bounds. */
function buildApp() {
  const app = new Hono();
  app.on(
    "POST",
    SENTRY_TUNNEL_PATH,
    bodyLimit({
      maxSize: SENTRY_TUNNEL_MAX_ENVELOPE_BYTES,
      onError: (c) => c.json({ error: { message: "too large" } }, 413),
    }),
    sentryTunnelRateLimit(LIMIT)
  );
  app.post(SENTRY_TUNNEL_PATH, (c) => c.json({ ok: true }));
  app.get(SENTRY_TUNNEL_PATH, (c) => c.json({ ok: true }));
  // A route outside the limiter's scope, to prove it is scoped.
  app.post("/api/public-stats", (c) => c.json({ ok: true }));
  return app;
}

/**
 * Posts a minimal envelope as a given client address.
 *
 * @param app - The app under test
 * @param ip - The address the Fly edge would have stamped
 * @param path - Defaults to the tunnel; pass another to prove the scope
 */
function send(app: Hono, ip: string, path = SENTRY_TUNNEL_PATH) {
  return app.request(path, {
    method: "POST",
    headers: { "Fly-Client-IP": ip },
    body: '{"dsn":"https://key@o1.ingest.sentry.io/1"}\n',
  });
}

describe("sentryTunnelRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // why: getClientIp only trusts Fly-Client-IP when running on Fly.
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("accepts envelopes up to the limit, then refuses", async () => {
    const app = buildApp();

    for (let i = 0; i < LIMIT; i++) {
      const res = await send(app, "1.2.3.4");
      expect(res.status).toBe(200);
    }

    const blocked = await send(app, "1.2.3.4");
    expect(blocked.status).toBe(429);
  });

  it("gives each trusted address its own bucket", async () => {
    const app = buildApp();

    for (let i = 0; i < LIMIT; i++) {
      await send(app, "10.0.0.1");
    }

    const other = await send(app, "10.0.0.2");
    expect(other.status).toBe(200);
    // Worth knowing what this does NOT promise: in production the trusted
    // header is the Cloudflare edge address, so everyone arriving through one
    // edge shares a bucket. Per-visitor isolation only holds where the trusted
    // header is the visitor's, which is the self-hosted case.
  });

  it("lets a bucket recover once its window passes", async () => {
    const app = buildApp();

    for (let i = 0; i < LIMIT; i++) {
      await send(app, "1.2.3.4");
    }
    expect((await send(app, "1.2.3.4")).status).toBe(429);

    vi.advanceTimersByTime(60_000);

    expect((await send(app, "1.2.3.4")).status).toBe(200);
  });

  it("does not spend the budget on methods that carry no envelope", async () => {
    const app = buildApp();

    // A GET, HEAD or CORS preflight must not be able to exhaust an address's
    // budget and have its real reports refused.
    for (let i = 0; i < LIMIT * 3; i++) {
      const res = await app.request(SENTRY_TUNNEL_PATH, {
        method: "GET",
        headers: { "Fly-Client-IP": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    }

    const envelope = await send(app, "1.2.3.4");
    expect(envelope.status).toBe(200);
  });

  it("refuses an envelope larger than the ceiling", async () => {
    const app = buildApp();

    const oversized = await app.request(SENTRY_TUNNEL_PATH, {
      method: "POST",
      headers: { "Fly-Client-IP": "1.2.3.4" },
      body: "x".repeat(SENTRY_TUNNEL_MAX_ENVELOPE_BYTES + 1),
    });

    expect(oversized.status).toBe(413);
  });

  it("accepts an envelope at the ceiling", async () => {
    const app = buildApp();

    const atLimit = await app.request(SENTRY_TUNNEL_PATH, {
      method: "POST",
      headers: { "Fly-Client-IP": "1.2.3.4" },
      body: "x".repeat(SENTRY_TUNNEL_MAX_ENVELOPE_BYTES),
    });

    expect(atLimit.status).toBe(200);
  });

  it("leaves other routes alone", async () => {
    const app = buildApp();

    for (let i = 0; i < LIMIT + 5; i++) {
      await send(app, "1.2.3.4");
    }

    const elsewhere = await send(app, "1.2.3.4", "/api/public-stats");
    expect(elsewhere.status).toBe(200);
  });
});

/**
 * The path is named in three places and only one of them can fail loudly.
 *
 * A mismatch between the client's `tunnel` option and the auth bypass does not
 * throw: the browser posts, gets a 302 to the login page, discards it, and the
 * error is never reported. Nothing in a type check or a passing suite can see
 * that, so the three sites read one constant and this pins that they do.
 */
describe("the tunnel path is named once", () => {
  const SERVER_ENTRY = path.resolve(__dirname, "../../server/index.ts");
  const CLIENT_ENTRY = path.resolve(__dirname, "../../app/entry.client.tsx");

  /**
   * Source with runs of whitespace collapsed, so these assertions pin the code
   * rather than however prettier chose to wrap it.
   */
  function collapsed(file: string) {
    return fs.readFileSync(file, "utf8").replace(/\s+/g, " ");
  }

  /** The contents of the `publicPaths` array in the server entry. */
  function publicPathsBlock() {
    const src = fs.readFileSync(SERVER_ENTRY, "utf8");
    const start = src.indexOf("publicPaths: [");
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("]", start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  it("bypasses auth for the tunnel", () => {
    // Without this the fix is undone and anonymous reports go to /login.
    expect(publicPathsBlock()).toContain("SENTRY_TUNNEL_PATH");
  });

  it("rate limits the path it exposes, for POST only", () => {
    const src = collapsed(SERVER_ENTRY);
    expect(src).toContain('server.on( "POST", SENTRY_TUNNEL_PATH');
    expect(src).toContain("sentryTunnelRateLimit()");
  });

  it("has the client post to the same constant", () => {
    const src = fs.readFileSync(CLIENT_ENTRY, "utf8");
    expect(src).toContain("tunnel: SENTRY_TUNNEL_PATH");
  });

  it("keeps the literal out of both entries", () => {
    // A literal reintroduces the drift the constant exists to prevent.
    for (const file of [SERVER_ENTRY, CLIENT_ENTRY]) {
      expect(fs.readFileSync(file, "utf8")).not.toContain(
        `"${SENTRY_TUNNEL_PATH}"`
      );
    }
  });
});
