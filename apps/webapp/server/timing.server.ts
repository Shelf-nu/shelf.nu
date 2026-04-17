/**
 * Server-Timing Middleware
 *
 * Hono middleware that measures total request duration and exposes it
 * via the standard `Server-Timing` HTTP header. This lets developers
 * inspect timing breakdowns in DevTools → Network → Timing without any
 * extra tooling.
 *
 * **Only active in non-production environments** to avoid leaking
 * performance information to end users.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing
 * @see {@link file://./index.ts} — registered in the Hono server pipeline
 */

import type { MiddlewareHandler } from "hono";

/**
 * Creates a Hono middleware that records total request duration in a
 * `Server-Timing` response header.
 *
 * The header follows the Server-Timing spec:
 * `total;dur=<ms>;desc="Total Request"`
 *
 * Skipped entirely when `NODE_ENV === "production"` so timing data is
 * never exposed in deployed environments.
 *
 * @returns A Hono {@link MiddlewareHandler} that can be registered with
 *   `server.use("*", serverTiming())`
 */
export function serverTiming(): MiddlewareHandler {
  return async (c, next) => {
    // Skip in production to avoid leaking timing information
    if (process.env.NODE_ENV === "production") {
      return next();
    }

    const start = performance.now();

    await next();

    const duration = performance.now() - start;

    c.res.headers.append(
      "Server-Timing",
      `total;dur=${duration.toFixed(1)};desc="Total Request"`
    );
  };
}
