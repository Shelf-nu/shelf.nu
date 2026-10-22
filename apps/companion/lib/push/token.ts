/**
 * Expo push token for this device.
 *
 * Thin wrapper around expo-notifications that yields the `ExponentPushToken[...]`
 * string the server stores and the Expo push service addresses. It owns the two
 * preconditions of the token call: a notification channel on Android (Android 13
 * shows the permission prompt only once a channel exists, and
 * `getExpoPushTokenAsync` refuses to run without one) and a granted permission.
 *
 * This module imports native modules, so it stays outside the `node:test`
 * suite by design. Logic that needs tests (payload routing, preference
 * state) lives in pure modules next to it.
 *
 * @see {@link file://../../PUSH-NOTIFICATIONS.md} credentials and native setup
 */
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/** Android channel every push lands on until per-category channels exist. */
export const DEFAULT_ANDROID_CHANNEL_ID = "default";

/** Raised when the device cannot produce a push token, with a reason a person can act on. */
export class PushTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushTokenError";
  }
}

/**
 * Reads the EAS project id from the app config. The token is bound to this id,
 * so it is passed explicitly rather than left to expo-notifications' lookup.
 */
function getProjectId(): string {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new PushTokenError("No EAS project id in the app config.");
  }
  return projectId;
}

/**
 * Returns this device's Expo push token, requesting notification permission
 * when it has not been decided yet.
 *
 * The system prompt appears at most once per install. A denied permission is
 * reported as a {@link PushTokenError}; the caller decides whether to point
 * the person at the system settings.
 *
 * @returns The `ExponentPushToken[...]` string to register with the server
 * @throws {PushTokenError} When permission is denied or the config lacks a project id
 */
export async function getExpoPushToken(): Promise<string> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(
      DEFAULT_ANDROID_CHANNEL_ID,
      {
        name: "Default",
        importance: Notifications.AndroidImportance.DEFAULT,
      }
    );
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== "granted") {
    throw new PushTokenError(
      "Notifications are off for Shelf. Turn them on in the system settings."
    );
  }

  const { data } = await Notifications.getExpoPushTokenAsync({
    projectId: getProjectId(),
  });
  return data;
}
