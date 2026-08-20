import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { getSession } from "remix-hono/session";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { getClientIp } from "./client-ip";
import { authSessionKey } from "./session";
import type { FlashData, SessionData } from "./session";

/**
 * How long one bucket stays silent after emitting a telemetry entry. Matches
 * every limiter's `windowMs`, so a bucket contributes at most one log per
 * limiter window.
 */
const TELEMETRY_WINDOW_MS = 60_000;

/**
 * Hard cap on tracked buckets, so the throttle cannot itself become the leak.
 * An attacker rotating source IPs mints a fresh bucket per request; without a
 * ceiling this map would grow without bound and we would have traded a log
 * flood for a memory exhaustion.
 */
const TELEMETRY_MAX_TRACKED_BUCKETS = 5_000;

/** Bucket key → epoch ms of the last telemetry entry emitted for it. */
const lastLoggedAt = new Map<string, number>();

/**
 * Whether this bucket may emit a telemetry entry now, recording the emission
 * when it may.
 *
 * `hono-rate-limiter` invokes a limiter's `handler` for EVERY request once the
 * bucket is over its limit — `MemoryStore.increment` unconditionally bumps
 * `totalHits`, and the middleware calls `handler` whenever `totalHits > limit`.
 * So the natural shape of a rate-limit incident (a client that keeps going) is
 * also the shape that would flood the log trail. `mobileIpRateLimit` runs
 * before `session()` on a `publicPaths` route, making that flood anonymously
 * triggerable, and `SENTRY_HANDLED_4XX_SAMPLE_RATE` defaults to 1, so sampling
 * offers no protection unless someone has explicitly dialled it down. Left
 * unbounded, a runaway client could bury the very incident trail this telemetry
 * exists to preserve.
 *
 * @param bucket - The limiter's OWN bucket key. Callers must pass the real key
 *   rather than the log message: `calendarFeedRateLimit`'s message detail is a
 *   redacted placeholder shared by every feed, so throttling on that would
 *   collapse all feeds into one bucket and silence all but the first.
 * @param now - Current epoch ms, injected so tests stay deterministic
 * @returns `true` when the caller should emit
 */
function shouldEmitTelemetry(bucket: string, now: number): boolean {
  const last = lastLoggedAt.get(bucket);
  if (last !== undefined && now - last < TELEMETRY_WINDOW_MS) {
    return false;
  }

  if (lastLoggedAt.size >= TELEMETRY_MAX_TRACKED_BUCKETS) {
    // Drop anything that can no longer suppress an emit (its window has long
    // passed) before falling back to evicting the least recently emitted.
    for (const [key, at] of lastLoggedAt) {
      if (now - at >= TELEMETRY_WINDOW_MS * 2) {
        lastLoggedAt.delete(key);
      }
    }
    while (lastLoggedAt.size >= TELEMETRY_MAX_TRACKED_BUCKETS) {
      const oldest = lastLoggedAt.keys().next();
      if (oldest.done) {
        break;
      }
      lastLoggedAt.delete(oldest.value);
    }
  }

  // Delete before set so the entry moves to the end of the Map's insertion
  // order — `set` on an existing key keeps its original position, which would
  // make the eviction above evict by first-seen rather than by least-recent.
  lastLoggedAt.delete(bucket);
  lastLoggedAt.set(bucket, now);
  return true;
}

/**
 * Emit a searchable, low-severity trail entry when a rate limiter rejects a
 * request.
 *
 * Rate limiters short-circuit inside Hono middleware: they return
 * `c.json(..., 429)` BEFORE `refreshSession()`, `protect()` and React Router
 * run (see the ordering comment in `server/index.ts`). No `ShelfError` is ever
 * constructed, so `error()` / `logException()` — the only callers of
 * `Logger.handledClientError` — never fire. That left 429s invisible in EVERY
 * Sentry dataset: the client error-boundary deliberately skips them
 * (`EXPECTED_ERROR_BOUNDARY_STATUSES`), and the handled-4xx log trail is only
 * reachable from a caught `ShelfError`. The sole record was Fly's request log,
 * which is live-tail only and carries no user id — so a customer report ("too
 * many requests when adding a kit to my booking") could not be confirmed after
 * the fact.
 *
 * Routing through `Logger.handledClientError` keeps ONE pipeline for handled
 * 4xx: the entry lands on the Sentry **logs** quota rather than the small
 * error-event quota, honours `SENTRY_HANDLED_4XX_SAMPLE_RATE`, and is
 * filterable by `label:"Rate limit"`.
 *
 * Throttled to at most one entry per bucket per window — see
 * {@link shouldEmitTelemetry} for why an unthrottled emit is self-defeating.
 *
 * @param scope - Which limiter fired (e.g. `app-loader`), so the three
 *   limiters stay distinguishable in one query
 * @param bucket - The limiter's own bucket key, used ONLY as the throttle key.
 *   Never logged: for `calendarFeedRateLimit` it embeds the feed's secret
 *   token. It stays in process memory, exactly as `hono-rate-limiter`'s own
 *   MemoryStore already holds it, so this is no new exposure.
 * @param detail - Caller-supplied description of WHAT was limited, appended to
 *   the log message. **Must not contain secrets** — `calendarFeedRateLimit`
 *   keys on a path that embeds the feed's secret token, so it passes a
 *   redacted string rather than the raw path.
 * @param userId - The authenticated user, when known. `handledClientError`
 *   promotes this to a log attribute, which is what makes an incident
 *   attributable to a reporting customer. The client IP is deliberately NOT
 *   logged: it is PII and useless for attribution.
 */
function logRateLimitHit({
  scope,
  bucket,
  detail,
  userId,
}: {
  scope: string;
  bucket: string;
  detail: string;
  userId?: string;
}) {
  // Gate BEFORE constructing the ShelfError: the constructor captures a V8
  // stack and mints a cuid2 traceId, and this runs on the path whose whole
  // point is to reject an over-limit request with as little work as possible.
  if (!shouldEmitTelemetry(`${scope}:${bucket}`, Date.now())) {
    return;
  }

  Logger.handledClientError(
    new ShelfError({
      cause: null,
      label: "Rate limit",
      message: `Rate limit exceeded (${scope}): ${detail}`,
      status: 429,
      // Expected, transient, user-facing — never an error event.
      shouldBeCaptured: false,
      additionalData: userId ? { userId } : {},
    })
  );
}

/**
 * Bucket-key builders, shared between each limiter's `keyGenerator` and its
 * 429 `handler`.
 *
 * The handler must throttle on the SAME key the store counted, so these are
 * defined once rather than duplicated at both call sites — the two drifting
 * apart would silently mis-scope the throttle.
 */
const bucketKeys = {
  mobileIp: (c: Context) => `mobile:ip:${getClientIp(c)}`,
  appLoader: (c: Context) =>
    `app:${resolveAppLoaderIdentity(c).identity}:${c.req.path}`,
  calendarFeed: (c: Context) => `calendar:${c.req.path}`,
};

/**
 * Resolve the identity half of {@link appLoaderRateLimit}'s bucket key.
 *
 * Shared by the limiter's `keyGenerator` and its 429 `handler` so the value
 * logged is provably the value that was counted — recomputing the lookup
 * inline in both places would let them drift.
 *
 * @param c - The Hono request context
 * @returns The signed-session `userId` when authenticated, plus the bucket
 *   identity actually used (falling back to the client IP for anonymous and
 *   edge cases).
 */
function resolveAppLoaderIdentity(c: Context) {
  // `hono-rate-limiter` types the handler context with hono's default `Env`,
  // which is structurally narrower than the `Context<Env>` that remix-hono's
  // `getSession` expects; cast to bridge the two (the value is a genuine hono
  // Context, only the generic differs).
  const auth = getSession<SessionData, FlashData>(c).get(authSessionKey);
  const userId = auth?.userId;

  return { userId, identity: userId ?? getClientIp(c) };
}

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
    keyGenerator: bucketKeys.mobileIp,
    handler: (c) => {
      // Pre-auth surface, so there is no user id to attribute this to; the
      // path is all we can safely record.
      logRateLimitHit({
        scope: "mobile-ip",
        bucket: bucketKeys.mobileIp(c),
        detail: c.req.path,
      });

      return c.json(
        {
          error: {
            message: "Too many requests. Please try again later.",
          },
        },
        429
      );
    },
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
    keyGenerator: (c) => bucketKeys.appLoader(c as Context),
    handler: (c) => {
      const { userId } = resolveAppLoaderIdentity(c as Context);

      // The path is the other half of the bucket key, and is what makes a
      // report actionable: it names the surface the user was on (e.g.
      // `/bookings/<id>/overview/manage-kits.data`). Loader paths carry no
      // secrets — the query string is excluded from `c.req.path` anyway.
      logRateLimitHit({
        scope: "app-loader",
        bucket: bucketKeys.appLoader(c as Context),
        detail: c.req.path,
        userId,
      });

      return c.json(
        {
          error: {
            message: "Too many requests. Please try again later.",
          },
        },
        429
      );
    },
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
    keyGenerator: bucketKeys.calendarFeed,
    handler: (c) => {
      // why: this limiter keys on the request PATH, which embeds the feed's
      // SECRET TOKEN (see the doc comment above). Logging the raw path would
      // leak that secret into the Sentry log trail, so record only that a feed
      // was limited — the token is never recoverable from this entry.
      logRateLimitHit({
        scope: "calendar-feed",
        // The raw key (token included) throttles per-feed; only the redacted
        // `detail` is ever written to the log.
        bucket: bucketKeys.calendarFeed(c),
        detail: "/api/calendar/feed/<redacted>",
      });

      return c.text("Too many requests. Please try again later.", 429);
    },
  });
