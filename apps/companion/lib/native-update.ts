/**
 * Rules for the native in-app update prompts.
 *
 * When the active server advertises a `latestCompanionVersion` newer than this
 * build, the app hands over to the platform's own update UI:
 *
 * - Android: Google Play's flexible update flow, started once per app launch.
 *   Play downloads in the background. The app never restarts on its own: once
 *   the download is ready, the banner offers "Restart" and the user picks the
 *   moment, so no scan, audit or form is cut off mid-way.
 * - iOS: the App Store product sheet, shown once per store version. The version
 *   the sheet was shown for is remembered, so closing it keeps it away until
 *   the next store release.
 *
 * The store-link banner (`./update-banner.ts`) is the fallback for when the
 * native flow cannot run at all: no Play services, a sideloaded build, a binary
 * without the native module, a sheet that could not open, or a library error.
 *
 * Pure on purpose, like `./update-banner.ts`, so the Node test runner can
 * execute it. The native flows live in `./native-update-flow.ts`, the attempt
 * queue in `./native-update-scheduler.ts`, the library calls in
 * `./native-update-runner.ts` and the UI in
 * `components/update-available-banner.tsx`.
 *
 * @see ./update-banner.ts for `isNewerVersionAdvertised` and `isVersionCoveredBy`
 */
import {
  isNewerVersionAdvertised,
  isVersionCoveredBy,
  shouldShowUpdateBanner,
} from "./update-banner";

/**
 * AsyncStorage key holding the App Store version the iOS sheet was last shown
 * for. Written once the sheet is on screen, so closing it counts as dismissing
 * it, and a sheet that never appeared is never recorded.
 *
 * Not server-scoped: it describes this install, not the server's data.
 */
export const IOS_STORE_SHEET_SHOWN_KEY = "shelf_ios_store_sheet_shown_version";

/**
 * How a native update attempt ended.
 *
 * - `started`: the platform UI is on screen (Play flow or App Store sheet).
 * - `downloaded`: Android only. A flexible update finished downloading and
 *   waits for the user to restart the app.
 * - `no-store-update`: the native flow works, but the store does not offer a
 *   newer build to this device yet (staged rollout, review still pending, a
 *   download still running, or the sheet was already shown for this version).
 * - `unavailable`: the native flow cannot run on this install, or its UI could
 *   not be shown.
 */
export type NativeUpdateOutcome =
  | "started"
  | "downloaded"
  | "no-store-update"
  | "unavailable";

/**
 * What one native attempt resolves to: an outcome, or `superseded` when a
 * newer server answer arrived before any native UI opened, so nothing was
 * shown and the newer answer is evaluated instead.
 */
export type NativeUpdateResult = NativeUpdateOutcome | "superseded";

/**
 * Whether to try the native update flow after the server answers.
 *
 * @param platform - `Platform.OS`.
 * @param appVersion - This build's version; `""` when it cannot be read.
 * @param latestVersion - The server's advertised version, or null for none.
 * @param settledThisLaunch - Whether an earlier attempt in this app launch
 *   already showed the native UI, found a download ready, or found the flow
 *   unavailable. Nothing new can be learned until the next launch.
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
    isVersionCoveredBy(iosShownStoreVersion, latestVersion)
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
  return !isVersionCoveredBy(shownStoreVersion, storeVersion);
}

/**
 * Whether an outcome ends native attempts for the rest of this app launch.
 *
 * `no-store-update` does not: the store may start offering the build later in
 * the same session (a rollout step, an App Store release, a download that
 * finishes), and the foreground re-check is cheap and shows nothing when there
 * is still no update.
 *
 * @param outcome - How the attempt ended.
 * @returns `true` for every outcome except `no-store-update`.
 */
export function settlesLaunch(outcome: NativeUpdateOutcome): boolean {
  return outcome !== "no-store-update";
}

/**
 * Which banner, if any, sits below the app.
 *
 * - `restart`: Android downloaded an update; the user restarts to install it.
 * - `store-link`: the native flow is unavailable, so the banner links to the
 *   store instead, under the usual dismissal rules.
 */
export type UpdateBannerKind = "restart" | "store-link";

/**
 * Chooses the banner from the latest native outcome.
 *
 * While an attempt is pending (`null`) nothing shows, so the store-link banner
 * never flashes ahead of a native sheet.
 *
 * @param outcome - The latest native outcome, or null when none finished.
 * @param appVersion - This build's version; `""` when it cannot be read.
 * @param latestVersion - The server's advertised version, or null for none.
 * @param dismissedVersion - The advertised version the store-link banner was
 *   last dismissed for.
 * @param restartDismissed - Whether the restart banner was closed in this
 *   launch. It returns on the next launch, while the download still waits.
 * @returns The banner to show, or null for none.
 */
export function chooseUpdateBanner({
  outcome,
  appVersion,
  latestVersion,
  dismissedVersion,
  restartDismissed,
}: {
  outcome: NativeUpdateOutcome | null;
  appVersion: string;
  latestVersion: string | null;
  dismissedVersion: string | null;
  restartDismissed: boolean;
}): UpdateBannerKind | null {
  // A finished download is real whatever the server says now.
  if (outcome === "downloaded") return restartDismissed ? null : "restart";
  if (
    outcome === "unavailable" &&
    shouldShowUpdateBanner({ appVersion, latestVersion, dismissedVersion })
  ) {
    return "store-link";
  }
  return null;
}

/**
 * What to do with Google Play's answer to "is there an update?".
 *
 * - `start`: Play offers an update and allows the flexible flow.
 * - `downloaded`: a flexible update finished downloading and waits for the
 *   user to restart.
 * - `no-store-update`: Play offers nothing yet, or a download this app started
 *   is still running. Its end arrives as the library's `updateDownloaded`
 *   event in this process, or as `downloaded` on a later check.
 * - `unavailable`: Play offers an update but not through the flexible flow,
 *   which is the only one this app requests, so the banner must cover it.
 */
export type PlayUpdatePlan =
  | "start"
  | "downloaded"
  | "no-store-update"
  | "unavailable";

/**
 * Classifies Google Play's update check for the flexible flow.
 *
 * @param updateAvailable - Play has a newer build for this install.
 * @param downloaded - A flexible update finished downloading.
 * @param updateInProgress - A developer-triggered update is already running.
 * @param flexibleAllowed - Play allows the flexible flow for that build.
 *   Absent counts as not allowed.
 * @returns The plan for this launch.
 */
export function planPlayUpdate({
  updateAvailable,
  downloaded,
  updateInProgress,
  flexibleAllowed,
}: {
  updateAvailable: boolean;
  downloaded?: boolean;
  updateInProgress?: boolean;
  flexibleAllowed?: boolean;
}): PlayUpdatePlan {
  if (downloaded) return "downloaded";
  if (!updateAvailable || updateInProgress) return "no-store-update";
  return flexibleAllowed ? "start" : "unavailable";
}
