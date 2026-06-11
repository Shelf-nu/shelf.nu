import { rateLimiter } from "hono-rate-limiter";
import { getClientIp } from "./client-ip";

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
