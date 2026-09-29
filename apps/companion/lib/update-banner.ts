/**
 * Rules for the soft "new version available" banner.
 *
 * A Shelf server advertises `latestCompanionVersion` on `/api/mobile/config`.
 * When this build is older, the app shows a dismissible banner with a store
 * link. Unlike `minCompanionVersion` it blocks nothing.
 *
 * It exists for installs that over-the-air updates can no longer reach: an
 * update only lands on builds with the same runtime version, so a phone that
 * never installs a new store build stops receiving fixes and nothing else
 * tells it so.
 *
 * Pure on purpose, like `./server/contract.ts`, so the Node test runner can
 * execute it. The fetch lives in `./server/discovery.ts` and the UI in
 * `components/update-available-banner.tsx`.
 *
 * @see ./server/contract.ts for `compareAppVersions`
 */
import { compareAppVersions } from "./server/contract";

/**
 * AsyncStorage key holding the advertised version the user last dismissed.
 *
 * Not server-scoped: it describes this install, not the server's data, so a
 * server switch leaves it alone.
 */
export const UPDATE_BANNER_DISMISSED_KEY =
  "shelf_update_banner_dismissed_version";

/**
 * Reads `latestCompanionVersion` from a `/api/mobile/config` response.
 *
 * Deliberately separate from `parseServerConfigResponse`: the banner needs one
 * field and must stay quiet on anything unexpected, while that parser rejects
 * whole responses for reasons the banner does not care about.
 *
 * @param json - Parsed response body; anything, since a server can return an
 *   error page, an empty body or a proxy's own JSON.
 * @returns The trimmed version string, or `null` when the field is absent,
 *   empty or not a string.
 */
export function parseLatestCompanionVersion(json: unknown): string | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return null;
  }
  const { latestCompanionVersion } = json as {
    latestCompanionVersion?: unknown;
  };
  if (typeof latestCompanionVersion !== "string") return null;
  return latestCompanionVersion.trim() || null;
}

/**
 * Whether to show the banner.
 *
 * Every "cannot tell" case answers `false`: a banner that nags about an update
 * which may not exist is worse than no banner.
 *
 * @param appVersion - This build's version, from `getAppVersion()`; `""` when
 *   it cannot be read.
 * @param latestVersion - The server's advertised version, or null for none.
 * @param dismissedVersion - The advertised version the user last dismissed,
 *   or null when they never have.
 * @returns `true` only when this build is older than the advertised version
 *   and the user has not dismissed that version (or a newer one).
 */
export function shouldShowUpdateBanner({
  appVersion,
  latestVersion,
  dismissedVersion,
}: {
  appVersion: string;
  latestVersion: string | null;
  dismissedVersion: string | null;
}): boolean {
  if (!latestVersion) return false;

  const order = compareAppVersions(appVersion, latestVersion);
  if (order === null || order >= 0) return false;

  if (dismissedVersion) {
    // A dismissal covers the version it was given for and anything older, so
    // only a genuinely newer release brings the banner back.
    const seen = compareAppVersions(dismissedVersion, latestVersion);
    if (seen !== null && seen >= 0) return false;
  }
  return true;
}
