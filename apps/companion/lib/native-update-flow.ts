/**
 * The step-by-step native update flows, one per platform.
 *
 * The library calls are passed in, so the order of calls, the arguments and
 * every early exit run under the Node test runner. The real calls are wired in
 * `./native-update-runner.ts`.
 *
 * @see ./native-update.ts for the decision rules these flows apply
 */
import {
  planPlayUpdate,
  shouldPresentStoreSheet,
  type NativeUpdateResult,
} from "./native-update";

/** Whether the server answer this attempt was started for is still current. */
export type IsCurrent = () => boolean;

/** Google Play's answer to "is there an update?", as the library reports it. */
export type PlayUpdateCheck = {
  updateAvailable: boolean;
  downloaded?: boolean;
  updateInProgress?: boolean;
  flexibleAllowed?: boolean;
};

/** The Play calls the Android flow needs. */
export type PlayApi = {
  checkForUpdate: () => Promise<PlayUpdateCheck>;
  /**
   * Starts an update. `false` asks for FLEXIBLE explicitly; leaving it out
   * lets the library pick IMMEDIATE for a high Play priority, which blocks
   * the app.
   */
  startUpdate: (isImmediate: boolean) => Promise<boolean>;
};

/** The App Store calls the iOS flow needs. */
export type AppStoreApi = {
  checkForUpdate: () => Promise<{
    updateAvailable: boolean;
    storeVersion?: string | null;
  }>;
  /** Resolves `true` only once the sheet is on screen. */
  startUpdate: () => Promise<boolean>;
  /** Records the store version the sheet was shown for. */
  rememberShown: (storeVersion: string) => Promise<void>;
};

/**
 * Runs Google Play's flexible flow.
 *
 * Play is asked first because `startUpdate` answers `false` both when there is
 * no update and when the flexible flow is not allowed, and only the second
 * needs the fallback banner.
 *
 * @param api - The Play calls.
 * @param isCurrent - Asked right before the Play UI opens.
 * @returns How the attempt ended.
 */
export async function runPlayFlow(
  api: PlayApi,
  isCurrent: IsCurrent
): Promise<NativeUpdateResult> {
  const plan = planPlayUpdate(await api.checkForUpdate());
  if (plan !== "start") return plan;
  if (!isCurrent()) return "superseded";
  if (await api.startUpdate(false)) return "started";
  // Play's answer changed between the two calls. Ask again: an update that is
  // still offered but no longer flexible needs the banner, and one that has
  // finished downloading needs the restart offer.
  const retry = planPlayUpdate(await api.checkForUpdate());
  return retry === "unavailable" || retry === "downloaded"
    ? retry
    : "no-store-update";
}

/**
 * Runs the App Store sheet flow, once per store version.
 *
 * @param api - The App Store calls.
 * @param isCurrent - Asked right before the sheet opens.
 * @param shownStoreVersion - The store version the sheet was last shown for.
 * @returns How the attempt ended.
 */
export async function runAppStoreFlow(
  api: AppStoreApi,
  {
    isCurrent,
    shownStoreVersion,
  }: { isCurrent: IsCurrent; shownStoreVersion: string | null }
): Promise<NativeUpdateResult> {
  const { updateAvailable, storeVersion } = await api.checkForUpdate();
  // A lookup with no store version (no result for this storefront, an
  // unexpected response) says nothing about whether an update exists, so the
  // banner covers it.
  if (!storeVersion) return "unavailable";
  if (
    !shouldPresentStoreSheet({
      storeUpdateAvailable: updateAvailable,
      storeVersion,
      shownStoreVersion,
    })
  ) {
    return "no-store-update";
  }

  if (!isCurrent()) return "superseded";
  // `false` covers a sheet that could not load or open (another view
  // controller mid-transition, no network): it must not count as shown, or
  // later launches would skip both it and the fallback banner.
  if (!(await api.startUpdate())) return "unavailable";

  try {
    await api.rememberShown(storeVersion);
  } catch {
    // Non-fatal: the once-per-launch rule still holds for this session.
  }
  return "started";
}
