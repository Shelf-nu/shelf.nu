import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { getSession } from "remix-hono/session";
import { getClientIp } from "./client-ip";
import { authSessionKey } from "./session";
import type { FlashData, SessionData } from "./session";

/**
 * Coarse IP-based rate limit for `/api/mobile/*`.
 *
 * Every mobile API request invokes Supabase Admin's `auth.getUser` inside
 * `requireMobileAuth`, so anonymous flooders amplify cost on our Supabase
 * quota. This middleware caps that surface per client IP before the route
 * handler runs.
 *
 * Backed by an in-memory MemoryStore. Per-machine counters are acceptable on
 * Fly: even with N machines a 30/min limit stays at ~30N/min worst-case,
 * which still defeats the threat. If we later need cross-machine accuracy,
 * swap the store — the interface is stable.
 */
export const mobileIpRateLimit = () =>
  rateLimiter({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-7",
    keyGenerator: (c) => `mobile:ip:${getClientIp(c)}`,
    handler: (c) =>
      c.json(
        {
          error: {
            message: "Too many requests. Please try again later.",
          },
        },
        429
      ),
  });

/**
 * Per-(user, path) rate limit for single-fetch `.data` loader revalidations.
 *
 * React Router's single-fetch data requests (`*.data`) are issued on every
 * revalidation. A buggy client — e.g. a tab stuck in a revalidation loop — can
 * fire these unbounded, and each one opens a DB connection; a single runaway
 * tab is enough to exhaust the Prisma connection pool and take down the app
 * (this guard exists because that happened in production).
 *
 * The bucket key is `(userId | clientIP, path)`:
 * - Keying by `userId` (falling back to client IP for unauthenticated/edge
 *   cases) isolates one user's loop from everyone else.
 * - Keying by `c.req.path` (which excludes the query string — intentional)
 *   means a loop hammering ONE path is capped, while normal navigation across
 *   many varied paths is never throttled. Same-path/different-query
 *   revalidations deliberately share a bucket.
 *
 * Backed by an in-memory MemoryStore, so counters are per-machine: with N Fly
 * machines the effective ceiling is ~`limit`×N/min worst-case. That's an
 * accepted trade-off (matching {@link mobileIpRateLimit}); a Cloudflare edge
 * rule is the eventual hard, cross-machine ceiling. `limit` is the tuning knob
 * — raise it if legitimate high-frequency revalidation is misfiring, lower it
 * to clamp down harder.
 *
 * @param limit - Max `.data` requests per (user, path) per 60s window.
 *   Defaults to 60. Exposed primarily so tests can drive a low, deterministic
 *   threshold; production callers should rely on the default.
 */
export const appLoaderRateLimit = (limit = 60) =>
  rateLimiter({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-7",
    keyGenerator: (c) => {
      // `hono-rate-limiter` types the handler context with hono's default
      // `Env`, which is structurally narrower than the `Context<Env>` that
      // remix-hono's `getSession` expects; cast to bridge the two (the value
      // is a genuine hono Context, only the generic differs).
      const auth = getSession<SessionData, FlashData>(c as Context).get(
        authSessionKey
      );
      const identity = auth?.userId ?? getClientIp(c);
      return `app:${identity}:${c.req.path}`;
    },
    handler: (c) =>
      c.json(
        {
          error: {
            message: "Too many requests. Please try again later.",
          },
        },
        429
      ),
  });

/**
 * Per-feed rate limit for the subscribable iCal feed (`/api/calendar/feed/*`).
 *
 * The feed is in `publicPaths` (cookie-bypassed, secret-token auth) and runs an
 * unpaginated, windowed booking query per request. We key on the request PATH
 * (which embeds the secret token) rather than the client IP, because:
 *  - calendar providers (Google/Apple/Outlook) fetch many unrelated feeds from
 *    shared, rotating egress IPs — per-IP keying would cross-throttle them; and
 *  - a leaked URL can be polled from many IPs — per-path caps that single feed.
 * Each feed gets its own budget; clients legitimately poll only every few hours.
 *
 * Same in-memory MemoryStore caveat as `mobileIpRateLimit`. Generic floods of
 * random (invalid-token) paths are cheap indexed 404s, best absorbed at the edge.
 */
export const calendarFeedRateLimit = () =>
  rateLimiter({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    keyGenerator: (c) => `calendar:${c.req.path}`,
    handler: (c) => c.text("Too many requests. Please try again later.", 429),
  });
