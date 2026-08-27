/**
 * App version + store hand-off for the force-update prompt.
 *
 * A Shelf server advertises `minCompanionVersion` on `/api/mobile/config`. When
 * this build is older, discovery refuses to connect and the login screen offers
 * a store link instead of letting the user hit a wall of confusing 4xx errors.
 *
 * Kept separate from `lib/server/*` because it touches Expo and React Native,
 * which the pure contract module must not.
 *
 * @see ./server/contract.ts — `isAppVersionSupported`, the pure comparison
 * @see ./server/discovery.ts — where the gate is applied
 */
import { Linking, Platform } from "react-native";
import Constants from "expo-constants";

/**
 * iOS App Store id for Shelf Companion.
 * Must match `submit.production.ios.ascAppId` in `eas.json`.
 */
const IOS_APP_STORE_ID = "6765639874";

/**
 * Android package name.
 * Must match `android.package` in `app.json` and the webapp's
 * `config.companionAndroidPackageName`.
 */
const ANDROID_PACKAGE = "com.shelf.companion";

/**
 * This build's version string.
 *
 * Mirrors the resolution order used on the Settings screen: `expoConfig` is
 * present in normal builds, `manifest2` covers an OTA-updated install.
 *
 * @returns The semver-ish version, or `""` when it cannot be determined.
 *   Empty on purpose: `isAppVersionSupported` fails OPEN on a version it cannot
 *   parse, whereas a placeholder like `"0.0.0"` parses perfectly and compares
 *   as very old — which would show a force-update prompt the user can never
 *   satisfy, on a build whose only fault is that we could not read its version.
 */
export function getAppVersion(): string {
  return (
    Constants.expoConfig?.version ??
    Constants.manifest2?.extra?.expoClient?.version ??
    ""
  );
}

/**
 * Opens this app's store listing so the user can update.
 *
 * Never throws — a failure to open the store must not break the screen that
 * called it; the user can still update manually.
 *
 * @returns Resolves once the store has been opened, or immediately on failure.
 */
export async function openAppStore(): Promise<void> {
  const url =
    Platform.OS === "ios"
      ? `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`
      : `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  try {
    // why: Linking.openURL, NOT the in-app browser — a store listing must open
    // in the real App Store / Play Store app to offer an Update button. This is
    // also not a claimed deep-link host, so there is no re-entry loop risk.
    await Linking.openURL(url);
  } catch {
    // Non-fatal by design.
  }
}
