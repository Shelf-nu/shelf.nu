/**
 * Build version endpoint.
 *
 * Answers `GET /api/build-version` with `{ buildId }`, the ordered id of the
 * build this machine runs. Open tabs poll it to learn that a newer build is
 * live and offer a reload.
 *
 * It is registered before logger(), session() and protect(): polls are
 * frequent and carry no information worth logging, and the answer needs no
 * session and no database, so it works for signed-out tabs and costs nothing.
 *
 * @see {@link file://./index.ts} - registered before logger, session and auth
 * @see {@link file://./../app/utils/build-version.ts} - the id and how it compares
 * @see {@link file://./../app/utils/build-version-checker.ts} - the client that polls it
 */
import { createMiddleware } from "hono/factory";
import { getOwnBuildId } from "~/utils/build-version";

export { BUILD_VERSION_PATH } from "~/utils/build-version";

/**
 * Answers every request it receives with this build's id as JSON.
 *
 * `no-store` keeps Cloudflare and the browser from caching the answer: during
 * a deploy the same URL returns a different id from one request to the next.
 *
 * @returns Hono middleware that never calls `next()`
 */
export function buildVersion() {
  return createMiddleware((c) =>
    Promise.resolve(
      c.json({ buildId: getOwnBuildId() }, 200, { "cache-control": "no-store" })
    )
  );
}
