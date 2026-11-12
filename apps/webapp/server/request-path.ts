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
 * Suffix React Router's single fetch appends to a path to request the route's
 * data, or to submit to its action, without rendering HTML.
 */
const SINGLE_FETCH_SUFFIX = ".data";

/**
 * Path single fetch uses for a request to the root route (`/`).
 */
const ROOT_SINGLE_FETCH_PATH = "/_root.data";

/**
 * Normalise a request path to the route it reaches: {@link normalizeRequestPath}
 * plus the single-fetch suffix removed. `/x.data` reaches the same loader and
 * action as `/x`, so a guard or bucket scoped to a route uses this form to
 * cover both.
 *
 * @param path - The request path, as `c.req.path` returns it
 * @returns The normalised path of the route the request reaches
 */
export function normalizeRoutePath(path: string): string {
  const normalized = normalizeRequestPath(path);
  if (normalized === ROOT_SINGLE_FETCH_PATH) return "/";
  return normalized.endsWith(SINGLE_FETCH_SUFFIX)
    ? normalizeRequestPath(normalized.slice(0, -SINGLE_FETCH_SUFFIX.length))
    : normalized;
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
