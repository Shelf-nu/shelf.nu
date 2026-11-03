/**
 * Native in-app update calls, wrapping `expo-in-app-updates`.
 *
 * - Android: Google Play's flexible update flow. Play downloads in the
 *   background and reports `updateDownloaded`; the install happens only when
 *   the user taps "Restart" (`completeNativeUpdate`). The immediate (blocking)
 *   flow is never requested.
 * - iOS: looks the app up on the App Store (`AppStoreID` in Info.plist) and,
 *   when the store offers a newer build, presents the App Store product sheet.
 *
 * The library is patched (`patches/expo-in-app-updates@0.12.0.patch`): Play
 * never restarts the app or opens the Play Store on its own, `completeUpdate`
 * and the `downloaded` check field exist, and the iOS sheet opens above any
 * modal and resolves `true` only once it is on screen.
 *
 * The native module is resolved with `requireOptionalNativeModule` before the
 * library is imported. The library's own entry calls `requireNativeModule`,
 * which throws at import time on a binary built without it; an over-the-air
 * update can carry this file to such a binary, and there it must report
 * `unavailable` (so the banner takes over) instead of crashing.
 *
 * Never throws: every failure is an `unavailable` outcome.
 *
 * @see ./native-update-flow.ts for the flows themselves
 * @see ./native-update-scheduler.ts for when they run
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo";
import * as Sentry from "@sentry/react-native";
import {
  IOS_STORE_SHEET_SHOWN_KEY,
  type NativeUpdateResult,
} from "./native-update";
import {
  runAppStoreFlow,
  runPlayFlow,
  type IsCurrent,
} from "./native-update-flow";

/** Name the library registers its native module under. */
const NATIVE_MODULE_NAME = "ExpoInAppUpdates";

/** The library's JS API. */
type InAppUpdates = typeof import("expo-in-app-updates");

/**
 * Loads the library, or returns null when this binary lacks its native module.
 *
 * @returns The library's API, or null when the native flow cannot run here.
 */
async function loadInAppUpdates(): Promise<InAppUpdates | null> {
  if (!requireOptionalNativeModule(NATIVE_MODULE_NAME)) return null;
  return import("expo-in-app-updates");
}

/** Records a native failure as a breadcrumb: the banner covers the user. */
function noteUnavailable(message: string, error: unknown) {
  Sentry.addBreadcrumb({
    category: "in-app-update",
    level: "info",
    message,
    data: { error: error instanceof Error ? error.message : String(error) },
  });
}

/**
 * Reads the App Store version the iOS sheet was last shown for.
 *
 * @returns The stored version, or null when none is stored or storage fails.
 */
export async function readIosShownStoreVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(IOS_STORE_SHEET_SHOWN_KEY);
  } catch {
    return null;
  }
}

/**
 * Runs the platform's native update flow once.
 *
 * Call only after `shouldAttemptNativeUpdate` says so: this function does not
 * check the server's advertised version itself.
 *
 * @param isCurrent - Asked right before any native UI opens. Answering `false`
 *   ends the attempt as `superseded` without showing anything. A native call
 *   already under way cannot be cancelled.
 * @param iosShownStoreVersion - The store version the iOS sheet was last shown
 *   for, as the caller already read it.
 * @returns How the attempt ended. Never rejects.
 */
export async function runNativeUpdate({
  isCurrent,
  iosShownStoreVersion,
}: {
  isCurrent: IsCurrent;
  iosShownStoreVersion: string | null;
}): Promise<NativeUpdateResult> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "unavailable";
  try {
    const lib = await loadInAppUpdates();
    if (!lib) return "unavailable";
    if (Platform.OS === "android") {
      return await runPlayFlow(
        {
          checkForUpdate: lib.checkForUpdate,
          startUpdate: lib.startUpdate,
        },
        isCurrent
      );
    }
    return await runAppStoreFlow(
      {
        checkForUpdate: lib.checkForUpdate,
        startUpdate: () => lib.startUpdate(),
        rememberShown: (storeVersion) =>
          AsyncStorage.setItem(IOS_STORE_SHEET_SHOWN_KEY, storeVersion),
      },
      { isCurrent, shownStoreVersion: iosShownStoreVersion }
    );
  } catch (error) {
    // Expected on sideloaded or debug Android builds (Play does not own the
    // install) and on devices without Play services. A breadcrumb, not an
    // event: the banner covers the user, and this is not an app fault.
    noteUnavailable("Native update flow unavailable", error);
    return "unavailable";
  }
}

/**
 * Listens for Play's "flexible update downloaded" event. Android only.
 *
 * @param onDownloaded - Called once the update is ready to install.
 * @returns Stops listening. Safe to call before the listener is attached.
 */
export function subscribeToUpdateDownloaded(
  onDownloaded: () => void
): () => void {
  if (Platform.OS !== "android") return () => {};
  let remove: (() => void) | null = null;
  let stopped = false;
  void loadInAppUpdates()
    .then((lib) => {
      if (!lib || stopped) return;
      remove = lib.addUpdateListener("updateDownloaded", onDownloaded);
    })
    .catch((error) => noteUnavailable("Update listener unavailable", error));
  return () => {
    stopped = true;
    remove?.();
  };
}

/**
 * Installs a downloaded Play update, which restarts the app. Android only.
 *
 * Never rejects: if Play refuses, the app keeps running and the next launch
 * offers the restart again.
 */
export async function completeNativeUpdate(): Promise<void> {
  try {
    const lib = await loadInAppUpdates();
    await lib?.completeUpdate();
  } catch (error) {
    noteUnavailable("Completing the update failed", error);
  }
}
