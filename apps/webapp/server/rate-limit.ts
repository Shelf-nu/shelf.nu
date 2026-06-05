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
 * Coarse IP-based rate limit for `/api/calendar/*` (the subscribable iCal feed).
 *
 * The feed is in `publicPaths` (cookie-bypassed, secret-token auth) and runs an
 * unpaginated, windowed booking query per request. Real calendar clients poll
 * only every few hours, so a generous per-IP cap is invisible to them while
 * defeating a leaked/shared URL being hammered. The limit is higher than the
 * mobile one because calendar providers (Google/Apple/Outlook) fetch from
 * shared, rotating IP pools and we don't want to throttle legitimate polls.
 *
 * Same in-memory MemoryStore caveat as `mobileIpRateLimit`.
 */
export const calendarIpRateLimit = () =>
  rateLimiter({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-7",
    keyGenerator: (c) => `calendar:ip:${getClientIp(c)}`,
    handler: (c) => c.text("Too many requests. Please try again later.", 429),
  });
