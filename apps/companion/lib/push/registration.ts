/**
 * Push registration on this phone: the notification permission, the opt-in
 * flag, the Android channels, and the native calls the registrar runs on.
 *
 * The decisions (when to register, when to wait, what sign-out forgets) live
 * in the pure `./registrar.ts`; this module only supplies its effects and
 * exports the one registrar the app uses. Registration never prompts: only
 * {@link requestPushPermission}, which the Notifications explainer calls,
 * shows the system prompt, and background registration runs only once that
 * explainer set the opt-in flag.
 *
 * Imports native modules, so it stays outside the `node:test` suite.
 *
 * @see {@link file://./registrar.ts} the registration and sign-out runs
 * @see {@link file://./token-record.ts} the stored record
 * @see {@link file://./handlers.ts} the registration triggers
 * @see {@link file://../api/notifications.ts} the endpoints
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "../api";
import { getAppVersion } from "../app-update";
import { getActiveServer } from "../server/active-server";
import { reportPushRegistrationFailure } from "../sentry";
import { getSupabase } from "../supabase";
import {
  toPushPermission,
  type PushDeviceState,
  type PushPermission,
} from "./preferences";
import {
  createPushRegistrar,
  type PushApiAnswer,
  type PushSession,
  type RegisterOptions,
  type RegistrationOutcome,
} from "./registrar";
import { PUSH_CATEGORIES, type PushCategory } from "./routing";
import {
  parsePushTokenRecord,
  PUSH_TOKEN_STORAGE_KEY,
  registrationStatus,
  type PushTokenRecord,
} from "./token-record";

/**
 * AsyncStorage key of the opt-in flag: "true" once the person tapped "Turn on
 * notifications" on this phone. Device-scoped like the scan sound and start
 * page, so it survives sign-out and server switches.
 */
const PUSH_OPTED_IN_STORAGE_KEY = "shelf_push_opted_in";

/**
 * How long the token step (APNs or FCM, then Expo) may take. Registrations
 * queue behind each other, so a token call that never answers would
 * otherwise hold up every later one.
 */
const TOKEN_TIMEOUT_MS = 15_000;

/** Android channel names, one per category; the channel id is the category. */
const CATEGORY_CHANNEL_NAMES: Record<PushCategory, string> = {
  bookings: "Bookings",
  audits: "Audits",
  stockAndReminders: "Stock and reminders",
};

/**
 * Channel for a push that names none. Its id matches `defaultChannel` of the
 * expo-notifications plugin in app.json.
 */
const DEFAULT_CHANNEL = { id: "default", name: "General" } as const;

/** Whether this platform receives push at all (not web). */
function isPushPlatform(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

/**
 * Creates the Android channels. Android 13 shows the permission prompt only
 * once a channel exists, and the token call needs one, so this runs before
 * both. Calling it again updates names in place and keeps the person's
 * per-channel choices.
 */
async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Promise.all([
      Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL.id, {
        name: DEFAULT_CHANNEL.name,
        importance: Notifications.AndroidImportance.DEFAULT,
      }),
      ...PUSH_CATEGORIES.map((category) =>
        Notifications.setNotificationChannelAsync(category, {
          name: CATEGORY_CHANNEL_NAMES[category],
          // why: these pushes are about the person's own booking, audit or
          // asset, often due soon, so they show as a heads-up banner
          importance: Notifications.AndroidImportance.HIGH,
        })
      ),
    ]);
  } catch (cause) {
    if (__DEV__) console.warn("[Push] channel setup failed:", cause);
  }
}

/**
 * Reads the notification permission without prompting.
 *
 * @returns "granted", "denied" (only the phone's settings can change it), or
 *   "undetermined" (the system prompt can still be shown)
 */
export async function getPushPermissionState(): Promise<PushPermission> {
  return toPushPermission(await Notifications.getPermissionsAsync());
}

/**
 * Shows the system permission prompt when it can still be shown, asking for
 * alerts and sounds only (the app sets no badge). Where the permission is
 * already decided, as on Android 12 and older, no prompt appears and the
 * current answer comes back.
 *
 * Call only from the Notifications explainer, after the person asked for
 * notifications.
 *
 * @returns The permission after the prompt
 */
export async function requestPushPermission(): Promise<PushPermission> {
  await ensureAndroidChannels();
  return toPushPermission(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    })
  );
}

/** Whether the person turned notifications on on this phone. Never throws. */
async function readPushOptedIn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PUSH_OPTED_IN_STORAGE_KEY)) === "true";
  } catch {
    return false;
  }
}

/**
 * Records that the person turned notifications on on this phone, which lets
 * background registration run from then on. Only the explainer's button
 * calls it.
 */
export async function setPushOptedIn(): Promise<void> {
  try {
    await AsyncStorage.setItem(PUSH_OPTED_IN_STORAGE_KEY, "true");
  } catch {
    // Unsaved, the explainer shows again next time; nothing else depends on it.
  }
}

/** Reads the stored registration record. Never throws. */
async function readRecord(): Promise<PushTokenRecord | null> {
  try {
    return parsePushTokenRecord(
      await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

/** Stores the record, or removes it for null. Never throws. */
async function writeRecord(record: PushTokenRecord | null): Promise<void> {
  try {
    if (record) {
      await AsyncStorage.setItem(
        PUSH_TOKEN_STORAGE_KEY,
        JSON.stringify(record)
      );
    } else {
      await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Without the record the next trigger registers again, which is harmless.
  }
}

/** The signed-in session, or null. Never throws. */
async function getSession(): Promise<PushSession | null> {
  try {
    const {
      data: { session },
    } = await getSupabase().auth.getSession();
    return session
      ? { userId: session.user.id, accessToken: session.access_token }
      : null;
  } catch {
    return null;
  }
}

/** Reads the EAS project id the Expo token is bound to. */
function getProjectId(): string {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("No EAS project id in the app config.");
  }
  return projectId;
}

/** The string inside an APNs or FCM token. */
function deviceTokenOf(deviceToken: Notifications.DevicePushToken): string {
  return typeof deviceToken.data === "string"
    ? deviceToken.data
    : JSON.stringify(deviceToken.data);
}

/**
 * Gets this device's token from APNs or FCM, then the Expo token minted from
 * it, within {@link TOKEN_TIMEOUT_MS} and until the signal aborts.
 *
 * The device token is fetched explicitly, rather than inside the Expo token
 * call, so it can be stored. A token the OS just reported is used as is: on
 * iOS every fetch reports the token to `addPushTokenListener` again, so
 * fetching here would answer the listener with another run.
 *
 * @param reported - A device token from `addPushTokenListener`, if any
 * @param signal - Aborted by sign-out
 * @returns Both tokens
 * @throws {Error} When either call fails, the time runs out, or the signal
 *   aborts
 */
async function fetchTokens(
  reported: Notifications.DevicePushToken | undefined,
  signal: AbortSignal
): Promise<{ token: string; deviceToken: string }> {
  await ensureAndroidChannels();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<never>((_, reject) => {
    const stopped = () => reject(new Error("Stopped by sign-out."));
    if (signal.aborted) stopped();
    signal.addEventListener("abort", stopped);
    timer = setTimeout(
      () => reject(new Error("Timed out getting a push token.")),
      TOKEN_TIMEOUT_MS
    );
  });
  const request = async () => {
    const deviceToken =
      reported ?? (await Notifications.getDevicePushTokenAsync());
    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: getProjectId(),
      devicePushToken: deviceToken,
    });
    return { token, deviceToken: deviceTokenOf(deviceToken) };
  };
  try {
    return await Promise.race([request(), stop]);
  } finally {
    clearTimeout(timer);
  }
}

/** Turns an `apiFetch` result into the registrar's answer. Never throws. */
async function answerOf(
  request: () => Promise<{
    data: unknown;
    error: string | null;
    status?: number;
  }>
): Promise<PushApiAnswer> {
  try {
    const { data, error, status } = await request();
    if (data) return { kind: "ok" };
    if (status !== undefined) {
      return { kind: "rejected", status, message: error ?? "" };
    }
    return error
      ? { kind: "unreachable", message: error }
      : { kind: "aborted" };
  } catch (cause) {
    return {
      kind: "unreachable",
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** The app's one registrar. */
const registrar = createPushRegistrar<Notifications.DevicePushToken>({
  getSession,
  getBaseUrl: () => getActiveServer().baseUrl,
  readRecord,
  writeRecord,
  readOptedIn: readPushOptedIn,
  readPermission: getPushPermissionState,
  deviceTokenOf,
  fetchTokens,
  postToken: (token, signal) =>
    answerOf(() =>
      api.registerPushToken(
        {
          token,
          platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
          deviceName: Device.modelName?.slice(0, 120) ?? null,
          appVersion: getAppVersion().slice(0, 20) || null,
        },
        signal
      )
    ),
  deleteToken: (token, signal) =>
    answerOf(() => api.unregisterPushToken(token, signal)),
  report: reportPushRegistrationFailure,
  now: Date.now,
});

/**
 * Registers this device's Expo push token for the signed-in person.
 *
 * Never prompts and never throws. A background run (no `force`) does nothing
 * until the person opted in on this phone, waits out the interval after a
 * failure, and sends nothing when the stored record already covers this
 * person, server and device token. Failures are recorded, and reported to
 * Sentry once per stage per app session.
 *
 * @param options.force - A run the person asked for: skips those checks
 * @param options.reported - A device token the OS just reported through
 *   `addPushTokenListener`
 * @returns What the run did
 */
export function registerThisDevice(
  options: RegisterOptions<Notifications.DevicePushToken> = {}
): Promise<RegistrationOutcome> {
  if (!isPushPlatform()) return Promise.resolve("unsupported");
  return registrar.register(options);
}

/**
 * Asks the server to forget this device for the person signing out, and
 * drops the stored record once it has.
 *
 * For sign-out: it stops a registration in flight, waits at most three
 * seconds, and never throws. A request that fails or times out keeps the
 * record and leaves the token on the server until the next person to sign in
 * on this phone claims it, or Expo reports it dead.
 *
 * @returns Resolves when the server answered or the time ran out
 */
export function unregisterThisDevice(): Promise<void> {
  if (!isPushPlatform()) return Promise.resolve();
  return registrar.unregister();
}

/**
 * Reads what the Notifications settings need from this phone: the
 * permission, the opt-in flag, and whether this phone is registered for the
 * signed-in person on the active server. Never throws; an unreadable
 * permission reads as not yet asked.
 *
 * @returns The phone's state
 */
export async function readPushDeviceState(): Promise<PushDeviceState> {
  const [permission, optedIn, record, session] = await Promise.all([
    getPushPermissionState().catch((): PushPermission => "undetermined"),
    readPushOptedIn(),
    readRecord(),
    getSession(),
  ]);
  return {
    permission,
    optedIn,
    registration: session
      ? registrationStatus(record, {
          userId: session.userId,
          baseUrl: getActiveServer().baseUrl,
        })
      : "none",
  };
}
