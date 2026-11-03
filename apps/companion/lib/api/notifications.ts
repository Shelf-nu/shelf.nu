/**
 * Push notification endpoints: device registration and the person's switches.
 *
 * All four calls carry the bearer token only, never an organization: a device
 * and its switches belong to the person, and the server applies each
 * workspace's plan at send time.
 *
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/push-token.ts}
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/notification-preferences.ts}
 * @see {@link file://../push/registration.ts} the only caller of the token calls
 */
import { apiFetch } from "./client";
import type {
  NotificationPreferencesResponse,
  PushTokenResponse,
  RegisterPushTokenPayload,
  UpdateNotificationPreferencesResponse,
} from "./types";
import type { NotificationPreferences } from "../push/preferences";

export const notificationsApi = {
  /**
   * Registers this device for the signed-in person. Idempotent on the server,
   * so the default retry is safe.
   *
   * @param payload - The token and what the server shows about this device
   * @param signal - Aborts the request, retry included; sign-out aborts a
   *   registration in flight so it cannot land after the session ends
   */
  registerPushToken: (
    payload: RegisterPushTokenPayload,
    signal?: AbortSignal
  ) =>
    apiFetch<PushTokenResponse>("/api/mobile/push-token", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }),

  /**
   * Forgets this device for the signed-in person. Answers 404 when the token
   * is not theirs, which the caller treats like success.
   *
   * @param token - The token registered earlier
   * @param signal - Aborts the request; sign-out bounds how long it waits
   */
  unregisterPushToken: (token: string, signal?: AbortSignal) =>
    apiFetch<PushTokenResponse>("/api/mobile/push-token", {
      method: "DELETE",
      body: JSON.stringify({ token }),
      signal,
      // why: sign-out waits on this call, and a retry would double the wait
      retry: false,
    }),

  /** The person's switches and whether any workspace plan includes push. */
  notificationPreferences: () =>
    apiFetch<NotificationPreferencesResponse>(
      "/api/mobile/notification-preferences"
    ),

  /**
   * Saves some of the person's switches. The others keep their values.
   *
   * @param changes - At least one switch; the server answers 400 for none
   */
  updateNotificationPreferences: (changes: Partial<NotificationPreferences>) =>
    apiFetch<UpdateNotificationPreferencesResponse>(
      "/api/mobile/notification-preferences",
      { method: "PUT", body: JSON.stringify(changes) }
    ),
};
