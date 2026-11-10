/**
 * Path-scoped guard helpers for the Hono server.
 *
 * Hono's own route patterns are case-sensitive and treat a trailing slash as a
 * different path, while React Router matches routes case-insensitively and
 * ignores a trailing slash. A guard mounted with `server.use("/api/mobile/*")`
 * therefore misses `/API/mobile/...` or `/api/mobile/x/`, even though React
 * Router serves the same route for both. These helpers match on a normalised
 * path instead, so a guard covers every spelling that reaches its route.
 *
 * @see {@link file://./index.ts} where the guards are mounted
 * @see {@link file://./rate-limit.ts} the limiters they wrap
 */
import type { Context, MiddlewareHandler, Next } from "hono";
import { bodyLimit } from "hono/body-limit";
import { every } from "hono/combine";
import {
  SENTRY_TUNNEL_MAX_ENVELOPE_BYTES,
  SENTRY_TUNNEL_PATH,
} from "~/utils/constants";
import {
  calendarFeedRateLimit,
  mobileIpRateLimit,
  sentryTunnelRateLimit,
} from "./rate-limit";
import { isPathWithin, normalizeRequestPath } from "./request-path";

/**
 * Methods that never deliver a body to a route action: GET and HEAD go to the
 * loader, and OPTIONS is a CORS preflight. Every other method can reach the
 * action with a body.
 */
const BODYLESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request method can deliver a body to a route action.
 *
 * @param method - The HTTP method, in any case
 * @returns `false` for GET, HEAD and OPTIONS, `true` for everything else
 */
export function methodCarriesBody(method: string): boolean {
  return !BODYLESS_METHODS.has(method.toUpperCase());
}

/**
 * Wrap a middleware so it runs only when the request matches.
 *
 * To apply several guards in order, compose them first with `every` from
 * `hono/combine`, which keeps Hono's own `next()` semantics.
 *
 * @param matches - Receives the normalised path and the context; return
 *   `true` to apply the middleware
 * @param middleware - The guard to apply. The caller instantiates it once so
 *   its state (such as a limiter's store) persists across requests.
 * @returns A single middleware for `server.use("*", ...)`
 */
export function guardWhen(
  matches: (normalizedPath: string, c: Context) => boolean,
  middleware: MiddlewareHandler
): MiddlewareHandler {
  return (c: Context, next: Next) =>
    matches(normalizeRequestPath(c.req.path), c) ? middleware(c, next) : next();
}

/** Prefix of the mobile companion API, normalised. */
const MOBILE_API_PREFIX = "/api/mobile";

/** Prefix of the public iCal feed, normalised. */
const CALENDAR_FEED_PREFIX = "/api/calendar/feed";

/**
 * Whether a normalised path is a mobile companion API request.
 *
 * @param path - A path already passed through {@link normalizeRequestPath}
 */
export function isMobileApiPath(path: string): boolean {
  return isPathWithin(path, MOBILE_API_PREFIX);
}

/**
 * Whether a normalised path is an iCal feed request.
 *
 * @param path - A path already passed through {@link normalizeRequestPath}
 */
export function isCalendarFeedPath(path: string): boolean {
  return isPathWithin(path, CALENDAR_FEED_PREFIX);
}

/**
 * Whether a request is one the Sentry tunnel's action would receive: the
 * tunnel path in any spelling, with any method that carries a body. GET, HEAD
 * and CORS preflights are left out so they never spend an address's budget.
 *
 * @param path - A path already passed through {@link normalizeRequestPath}
 * @param c - The Hono context, for the method
 */
export function isSentryTunnelEnvelope(path: string, c: Context): boolean {
  return path === SENTRY_TUNNEL_PATH && methodCarriesBody(c.req.method);
}

/**
 * IP rate limit for the mobile API, applied to every spelling of its prefix.
 *
 * @returns A middleware for `server.use("*", ...)`
 */
export function mobileApiGuard(): MiddlewareHandler {
  return guardWhen(isMobileApiPath, mobileIpRateLimit());
}

/**
 * Per-feed rate limit for the iCal feed, applied to every spelling of its
 * prefix.
 *
 * @returns A middleware for `server.use("*", ...)`
 */
export function calendarFeedGuard(): MiddlewareHandler {
  return guardWhen(isCalendarFeedPath, calendarFeedRateLimit());
}

/**
 * The Sentry tunnel's two bounds, body size then rate, applied to every
 * request its action would receive.
 *
 * The body bound comes first: the route reads the whole envelope, so the size
 * is refused before anything reads it. The route also enforces the same cap
 * itself, so the bound holds even where this guard does not run.
 *
 * @param limit - Envelopes per bucket per minute; tests pass a low value,
 *   production uses the limiter's default
 * @returns A middleware for `server.use("*", ...)`
 */
export function sentryTunnelGuard(limit?: number): MiddlewareHandler {
  return guardWhen(
    isSentryTunnelEnvelope,
    every(
      bodyLimit({
        maxSize: SENTRY_TUNNEL_MAX_ENVELOPE_BYTES,
        onError: (c) =>
          c.json({ error: { message: "Envelope too large." } }, 413),
      }),
      sentryTunnelRateLimit(limit)
    )
  );
}
