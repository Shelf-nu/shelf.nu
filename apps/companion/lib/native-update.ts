/**
 * Rules for the native in-app update prompts.
 *
 * When the active server advertises a `latestCompanionVersion` newer than this
 * build, the app hands over to the platform's own update UI:
 *
 * - Android: Google Play's flexible update flow, started once per app launch.
 *   Play downloads in the background and installs when the download finishes.
 * - iOS: the App Store product sheet, shown once per store version. The version
 *   the sheet was shown for is remembered, so closing it keeps it away until
 *   the next store release.
 *
 * The in-app banner (`./update-banner.ts`) is only the fallback for when the
 * native flow cannot run at all: no Play services, a sideloaded build, a binary
 * without the native module, or a library error.
 *
 * Pure on purpose, like `./update-banner.ts`, so the Node test runner can
 * execute it. The native calls live in `./native-update-runner.ts` and the
 * wiring in `components/update-available-banner.tsx`.
 *
 * @see ./server/contract.ts for `compareAppVersions`
 */
import { compareAppVersions } from "./server/contract";

/**
 * AsyncStorage key holding the App Store version the iOS sheet was last shown
 * for. Written before the sheet opens, so closing it counts as dismissing it.
 *
 * Not server-scoped: it describes this install, not the server's data.
 */
export const IOS_STORE_SHEET_SHOWN_KEY = "shelf_ios_store_sheet_shown_version";

/**
 * How a native update attempt ended.
 *
 * - `started`: the platform UI was shown (Play flow or App Store sheet).
 * - `no-store-update`: the native flow works, but the store does not offer a
 *   newer build to this device yet (staged rollout, review still pending, or
 *   the sheet was already shown for this store version).
 * - `unavailable`: the native flow cannot run on this install.
 */
export type NativeUpdateOutcome = "started" | "no-store-update" | "unavailable";

/**
 * Whether the server advertises a version newer than this build.
 *
 * Every "cannot tell" case answers `false`, as in `shouldShowUpdateBanner`.
 *
 * @param appVersion - This build's version; `""` when it cannot be read.
 * @param latestVersion - The server's advertised version, or null for none.
 * @returns `true` only when both parse and this build is older.
 */
export function isNewerVersionAdvertised({
  appVersion,
  latestVersion,
}: {
  appVersion: string;
  latestVersion: string | null;
}): boolean {
  if (!latestVersion) return false;
  const order = compareAppVersions(appVersion, latestVersion);
  return order !== null && order < 0;
}

/**
 * Whether a remembered version covers `version`, meaning it is the same or newer.
 *
 * An unreadable remembered value covers nothing, so a corrupt entry can only
 * cause one extra prompt, never suppress prompts for good.
 */
function isCoveredBy(remembered: string | null, version: string): boolean {
  if (!remembered) return false;
  const order = compareAppVersions(remembered, version);
  return order !== null && order >= 0;
}

/**
 * Whether to try the native update flow after the server answers.
 *
 * @param platform - `Platform.OS`.
 * @param appVersion - This build's version; `""` when it cannot be read.
 * @param latestVersion - The server's advertised version, or null for none.
 * @param settledThisLaunch - Whether an earlier attempt in this app launch
 *   already showed the native UI or found it unavailable. Either way there is
 *   nothing new to learn until the next launch.
 * @param iosShownStoreVersion - The App Store version the iOS sheet was last
 *   shown for, or null. Ignored on Android.
 * @returns `true` when the native flow should be tried now.
 */
export function shouldAttemptNativeUpdate({
  platform,
  appVersion,
  latestVersion,
  settledThisLaunch,
  iosShownStoreVersion,
}: {
  platform: string;
  appVersion: string;
  latestVersion: string | null;
  settledThisLaunch: boolean;
  iosShownStoreVersion: string | null;
}): boolean {
  if (settledThisLaunch) return false;
  if (!isNewerVersionAdvertised({ appVersion, latestVersion })) return false;
  // The sheet was already shown for this advertised version (or a newer one).
  // Skipping here saves an App Store lookup on every launch until the next
  // release.
  if (
    platform === "ios" &&
    latestVersion &&
    isCoveredBy(iosShownStoreVersion, latestVersion)
  ) {
    return false;
  }
  return true;
}

/**
 * Whether to open the iOS App Store sheet once the store lookup has answered.
 *
 * @param storeUpdateAvailable - The lookup's verdict: the store version is
 *   newer than this binary.
 * @param storeVersion - The version the App Store offers, if the lookup gave one.
 * @param shownStoreVersion - The store version the sheet was last shown for.
 * @returns `true` when the store has a newer build and the sheet has not been
 *   shown for it (or anything newer) yet.
 */
export function shouldPresentStoreSheet({
  storeUpdateAvailable,
  storeVersion,
  shownStoreVersion,
}: {
  storeUpdateAvailable: boolean;
  storeVersion: string | null;
  shownStoreVersion: string | null;
}): boolean {
  if (!storeUpdateAvailable || !storeVersion) return false;
  return !isCoveredBy(shownStoreVersion, storeVersion);
}

/**
 * Whether an outcome ends native attempts for the rest of this app launch.
 *
 * `no-store-update` does not: the store may start offering the build later in
 * the same session (a rollout step, an App Store release), and the foreground
 * re-check is cheap and shows nothing when there is still no update.
 *
 * @param outcome - How the attempt ended.
 * @returns `true` for `started` and `unavailable`.
 */
export function settlesLaunch(outcome: NativeUpdateOutcome): boolean {
  return outcome !== "no-store-update";
}

/**
 * Whether the in-app banner may show as a fallback.
 *
 * Only when the native flow is unavailable. While an attempt is pending
 * (`null`) the banner stays hidden, so it never flashes before a native sheet.
 *
 * @param outcome - The latest attempt's outcome, or null when none finished.
 * @returns `true` only for `unavailable`.
 */
export function isBannerFallbackActive(
  outcome: NativeUpdateOutcome | null
): boolean {
  return outcome === "unavailable";
}
