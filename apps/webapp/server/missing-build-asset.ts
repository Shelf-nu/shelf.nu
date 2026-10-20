/**
 * Missing build asset handler.
 *
 * Client build files live under `/file-assets/` (`assetsDir` in
 * `vite.config.ts`). react-router-hono-server serves the ones that exist
 * before `configure` runs, so any request for that prefix that reaches the app
 * middleware asks for a file this build does not have: usually a chunk from a
 * previous deploy, requested by a document rendered before it.
 *
 * That request must fail as a 404. Letting it fall through to `protect()`
 * answers it with a 302 to `/login`, which the browser follows and then
 * rejects as a module script with the wrong MIME type. The failure looks the
 * same to the user (the app never hydrates), but the 302 hides what actually
 * went wrong from devtools, from logs and from the hydration watchdog.
 *
 * @see {@link file://./index.ts} - registered first in `configure`
 * @see {@link file://./../app/utils/hydration-watchdog.ts} - what the browser does with the 404
 */
import { createMiddleware } from "hono/factory";

/** URL prefix of the client build output. Must match `assetsDir` in `vite.config.ts`. */
export const BUILD_ASSETS_PATH = "/file-assets/*";

/**
 * Answers every request it receives with a plain-text 404.
 *
 * `no-store` keeps Cloudflare from caching the miss: the same URL can become
 * valid again during a deploy, and a cached 404 would outlive that.
 *
 * @returns Hono middleware that never calls `next()`
 */
export function missingBuildAsset() {
  return createMiddleware(async (c) =>
    c.text("Not found", 404, { "cache-control": "no-store" })
  );
}
