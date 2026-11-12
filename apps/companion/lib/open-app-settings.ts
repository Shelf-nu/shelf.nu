/**
 * Opens Shelf's page in the phone's Settings app, for a permission the person
 * has turned off (camera, notifications) and can only turn back on there.
 *
 * `Linking.openSettings()` opens the app's own settings page on both iOS and
 * Android. It can reject (an emulator, a managed device that blocks Settings),
 * so the rejection is always handled: the person gets an alert telling them
 * where to go instead, and nothing reaches the unhandled-rejection handler.
 *
 * @see {@link file://../app/(tabs)/scanner.tsx} camera permission
 * @see {@link file://../app/(tabs)/audits/scan.tsx} camera permission
 * @see {@link file://../app/(tabs)/settings/notifications.tsx} notifications
 */
import { Alert, Linking } from "react-native";

/** What to show when Settings cannot be opened. */
export type OpenAppSettingsFallback = {
  /** Alert title. */
  title: string;
  /** Alert body: how to reach the setting by hand. */
  message: string;
};

/** The fallback for camera access, shared by both scan screens. */
export const CAMERA_SETTINGS_FALLBACK: OpenAppSettingsFallback = {
  title: "Couldn't open Settings",
  message: "Open your phone's Settings, find Shelf, and allow camera access.",
};

/**
 * Opens the app's page in Settings, or shows `fallback` if that fails.
 *
 * @param fallback - The alert shown when Settings cannot be opened
 * @returns A promise that settles once Settings opened or the alert showed;
 *   it never rejects
 */
export function openAppSettings(
  fallback: OpenAppSettingsFallback
): Promise<void> {
  return Linking.openSettings().catch(() => {
    Alert.alert(fallback.title, fallback.message);
  });
}
