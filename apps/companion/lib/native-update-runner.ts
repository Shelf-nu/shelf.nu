/**
 * Native in-app update calls, wrapping `expo-in-app-updates`.
 *
 * - Android: starts Google Play's flexible update flow. Play downloads in the
 *   background; when the download finishes the library calls Play's
 *   `completeUpdate()`, which shows Play's install screen and restarts the app.
 *   The immediate (blocking) flow is never requested.
 * - iOS: looks the app up on the App Store (`AppStoreID` in Info.plist) and,
 *   when the store offers a newer build, presents the App Store product sheet.
 *
 * The native module is resolved with `requireOptionalNativeModule` before the
 * library is imported. The library's own entry calls `requireNativeModule`,
 * which throws at import time on a binary built without it; an over-the-air
 * update can carry this file to such a binary, and there it must report
 * `unavailable` (so the banner takes over) instead of crashing.
 *
 * Never throws: every failure is an `unavailable` outcome.
 *
 * @see ./native-update.ts for the pure rules
 * @see ../components/update-available-banner.tsx for the wiring
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requireOptionalNativeModule } from "expo";
import * as Sentry from "@sentry/react-native";
import {
  IOS_STORE_SHEET_SHOWN_KEY,
  shouldPresentStoreSheet,
  type NativeUpdateOutcome,
} from "./native-update";

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

/** Starts Play's flexible flow; `false` from the library means no update. */
async function runAndroid(lib: InAppUpdates): Promise<NativeUpdateOutcome> {
  // `false` asks for FLEXIBLE explicitly. Leaving it undefined would let the
  // library pick IMMEDIATE for a high Play priority, which blocks the app.
  const started = await lib.startUpdate(false);
  return started ? "started" : "no-store-update";
}

/** Presents the App Store sheet once per store version. */
async function runIos(lib: InAppUpdates): Promise<NativeUpdateOutcome> {
  const { updateAvailable, storeVersion } = await lib.checkForUpdate();
  const shownStoreVersion = await readIosShownStoreVersion();
  if (
    !storeVersion ||
    !shouldPresentStoreSheet({
      storeUpdateAvailable: updateAvailable,
      storeVersion,
      shownStoreVersion,
    })
  ) {
    return "no-store-update";
  }

  const started = await lib.startUpdate();
  if (!started) return "unavailable";

  // Remembered only once the sheet is up: closing it is the dismissal, and the
  // library reports no outcome beyond "presented". A sheet that failed to open
  // must not count as shown, or later launches would skip both it and the
  // fallback banner.
  try {
    await AsyncStorage.setItem(IOS_STORE_SHEET_SHOWN_KEY, storeVersion);
  } catch {
    // Non-fatal: the once-per-launch rule still holds for this session.
  }
  return "started";
}

/**
 * Runs the platform's native update flow once.
 *
 * Call only after `shouldAttemptNativeUpdate` says so: this function does not
 * check the server's advertised version itself.
 *
 * @returns How the attempt ended. Never rejects.
 */
export async function runNativeUpdate(): Promise<NativeUpdateOutcome> {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return "unavailable";
  try {
    const lib = await loadInAppUpdates();
    if (!lib) return "unavailable";
    return Platform.OS === "android"
      ? await runAndroid(lib)
      : await runIos(lib);
  } catch (error) {
    // Expected on sideloaded or debug Android builds (Play does not own the
    // install) and on devices without Play services. A breadcrumb, not an
    // event: the banner covers the user, and this is not an app fault.
    Sentry.addBreadcrumb({
      category: "in-app-update",
      level: "info",
      message: "Native update flow unavailable",
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return "unavailable";
  }
}
