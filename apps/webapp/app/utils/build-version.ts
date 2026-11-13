/**
 * Build Version
 *
 * Pure, isomorphic helpers for telling whether the server runs a newer build
 * than the bundle a tab loaded with. Every build carries an ordered id (a
 * build timestamp, injected as `__SHELF_BUILD_ID__` by `vite.config.ts`) in
 * both its client and server bundle. The server reports its id at
 * `BUILD_VERSION_PATH`; a tab compares it with its own.
 *
 * During a rolling deploy old and new machines serve side by side, so a tab
 * can reach a machine running an older build than its own. Ids are ordered
 * precisely so that case reads "older" and never prompts a reload.
 *
 * No React and no `window` access here: the server endpoint imports this too.
 *
 * @see {@link file://./build-version-checker.ts} - the client store built on these helpers
 * @see {@link file://./../../server/build-version.ts} - the endpoint that reports the server id
 */

/** Path of the endpoint that answers `{ buildId }` with the server's build id. */
export const BUILD_VERSION_PATH = "/api/build-version";

/** Build id of a dev-server bundle. Never comparable with anything. */
export const DEV_BUILD_ID = "dev";

/** Build ids that compare: a non-empty run of decimal digits. */
const ORDERED_BUILD_ID = /^\d+$/;

/**
 * Returns the build id baked into the running bundle.
 *
 * @returns The build timestamp as a digit string, or `DEV_BUILD_ID` when the
 * bundle has no id (dev server, or a runtime without the `define`)
 */
export function getOwnBuildId(): string {
  return typeof __SHELF_BUILD_ID__ === "undefined"
    ? DEV_BUILD_ID
    : __SHELF_BUILD_ID__;
}

/**
 * How the server's build relates to the tab's own build.
 *
 * - `newer`: the server runs a later build, so the tab is stale
 * - `same`: both run the same build
 * - `older`: the server runs an earlier build (a machine not yet updated)
 * - `unknown`: the ids cannot be compared (dev, malformed or missing)
 */
export type BuildComparison = "newer" | "same" | "older" | "unknown";

/**
 * Compares the tab's own build id with the server's.
 *
 * Both ids must be digit strings; anything else (including `DEV_BUILD_ID`)
 * gives `unknown`. The comparison uses `BigInt` so ids of any length compare
 * exactly.
 *
 * @param own - The build id of the running bundle
 * @param server - The build id the server reported
 * @returns Where the server's build stands relative to the tab's
 */
export function compareBuildIds(own: string, server: string): BuildComparison {
  if (own === DEV_BUILD_ID || server === DEV_BUILD_ID) return "unknown";
  if (!ORDERED_BUILD_ID.test(own) || !ORDERED_BUILD_ID.test(server)) {
    return "unknown";
  }

  const ownId = BigInt(own);
  const serverId = BigInt(server);
  if (serverId > ownId) return "newer";
  if (serverId < ownId) return "older";
  return "same";
}

/**
 * Reads the build id out of a `BUILD_VERSION_PATH` response body.
 *
 * @param body - The parsed JSON body, of unknown shape
 * @returns The `buildId` when it is a non-empty string, otherwise `null`
 */
export function parseBuildVersionResponse(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { buildId } = body as { buildId?: unknown };
  return typeof buildId === "string" && buildId.length > 0 ? buildId : null;
}

/**
 * Messages browsers use when a JavaScript module fails to download or
 * evaluate as a module: Chrome and Edge ("Failed to fetch dynamically
 * imported module"), Firefox ("error loading dynamically imported module")
 * and Safari ("Importing a module script failed"). The one definition for
 * both the lazy-load boundary and the client Sentry filters.
 */
export const MODULE_LOAD_FAILURE_PATTERN =
  /dynamically imported module|importing a module script failed/i;

/**
 * Bundler wording for a chunk that could not be fetched: Vite's preload
 * helper when a chunk's stylesheet fails, and webpack-style
 * "Loading chunk <id> failed" / `ChunkLoadError`.
 */
const BUNDLER_CHUNK_FAILURE_PATTERN =
  /unable to preload css|loading (?:css )?chunk \S+ failed|chunkloaderror/i;

/**
 * Tells whether an error means a build chunk failed to load.
 *
 * @param error - Anything thrown or rejected: an `Error`, or any value with a
 * string `message`
 * @returns `true` when the message matches a known chunk-load failure
 */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { message } = error as { message?: unknown };
  if (typeof message !== "string") return false;

  return (
    MODULE_LOAD_FAILURE_PATTERN.test(message) ||
    BUNDLER_CHUNK_FAILURE_PATTERN.test(message)
  );
}
