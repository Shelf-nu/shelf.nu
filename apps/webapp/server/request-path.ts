/**
 * Request path normalisation shared by the server's path-scoped guards and the
 * rate limiters' bucket keys.
 *
 * React Router matches routes case-insensitively and ignores a trailing slash,
 * so several spellings of a path reach the same route. Anything that scopes or
 * counts by path compares the normalised form, so every spelling of a route
 * lands in the same guard and the same bucket.
 *
 * @see {@link file://./path-guards.ts}
 * @see {@link file://./rate-limit.ts}
 */

/**
 * Normalise a request path the way route matching sees it: lower-case, runs
 * of slashes collapsed to one, and trailing slashes removed (the root stays
 * `/`).
 *
 * @param path - The request path, as `c.req.path` returns it (already
 *   percent-decoded by Hono, query string excluded)
 * @returns The normalised path
 */
export function normalizeRequestPath(path: string): string {
  const collapsed = path.toLowerCase().replace(/\/{2,}/g, "/");
  const trimmed = collapsed.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/**
 * Whether a normalised path is `prefix` itself or sits beneath it.
 *
 * @param path - A path already passed through {@link normalizeRequestPath}
 * @param prefix - A lower-case prefix without a trailing slash, e.g. `/api/mobile`
 * @returns `true` when the path is inside the prefix
 */
export function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
