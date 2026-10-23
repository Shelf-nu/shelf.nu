/**
 * Push notification settings, shared by every screen of the Settings stack.
 *
 * `PushSettingsProvider` wraps the Settings stack (`app/(tabs)/settings/
 * _layout.tsx`) and holds the one copy of the state: the phone's permission,
 * opt-in flag and registration, and the person's switches from the server.
 * It reads both when the Settings tab gains focus, and again when the app
 * returns to the foreground while the tab is focused (the person may have
 * changed the permission in the phone's settings meanwhile); a foreground
 * on any other tab reads nothing. The Settings row and the Notifications
 * screen read the same state through {@link usePushSettings}, so they never
 * disagree.
 *
 * The state model and its derivation live in `lib/push/preferences.ts`; this
 * hook only performs the reads and writes.
 *
 * @see {@link file://../lib/push/preferences.ts}
 * @see {@link file://../app/(tabs)/settings/notifications.tsx}
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { api } from "@/lib/api";
import {
  derivePushScreenState,
  INITIAL_PUSH_SETTINGS,
  pushSettingsReducer,
  type NotificationPreferenceKey,
  type PushScreenState,
} from "@/lib/push/preferences";
import {
  readPushDeviceState,
  registerThisDevice,
  requestPushPermission,
  setPushOptedIn,
} from "@/lib/push/registration";

/** What {@link usePushSettings} returns. */
export type PushSettings = {
  /** The case to render. */
  state: PushScreenState;
  /**
   * Shows the system prompt where it can still be shown, records that the
   * person turned notifications on on this phone, and registers it. For the
   * explainer's button only.
   */
  turnOn: () => Promise<void>;
  /**
   * Registers this phone again at once, skipping the wait after a failure.
   * For the "Try again" notice.
   */
  retryRegistration: () => Promise<void>;
  /**
   * Flips one switch at once and saves it. A failed save puts back the value
   * it had before and says why.
   */
  setPreference: (key: NotificationPreferenceKey, value: boolean) => void;
  /** Reads the phone and the switches again. */
  reload: () => void;
};

const PushSettingsContext = createContext<PushSettings | null>(null);

/**
 * Loads and edits the person's push notification settings. Runs once, in
 * {@link PushSettingsProvider}.
 *
 * @returns The derived screen state and the actions the screens offer
 */
function usePushSettingsState(): PushSettings {
  const [model, dispatch] = useReducer(
    pushSettingsReducer,
    INITIAL_PUSH_SETTINGS
  );
  const isFocused = useIsFocused();

  // Numbers each request touching the switches, reads and saves alike; the
  // reducer applies only the newest one's answer.
  const requestCount = useRef(0);
  // Only the newest phone read may answer: a focus and a foreground event can
  // start two that return out of order.
  const deviceReadCount = useRef(0);

  const readDevice = useCallback(async () => {
    const read = ++deviceReadCount.current;
    const device = await readPushDeviceState();
    if (read === deviceReadCount.current) {
      dispatch({ type: "device-read", device });
    }
  }, []);

  const reload = useCallback(() => {
    void readDevice();

    const request = ++requestCount.current;
    dispatch({ type: "server-requested", request });
    void api.notificationPreferences().then(({ data, error }) => {
      if (data) {
        dispatch({
          type: "server-loaded",
          request,
          preferences: data.preferences,
          pushAvailable: data.pushAvailable,
        });
      } else if (error) {
        dispatch({ type: "server-failed", request, message: error });
      }
    });
  }, [readDevice]);

  useFocusEffect(reload);

  useEffect(() => {
    if (!isFocused) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") reload();
    });
    return () => subscription.remove();
  }, [isFocused, reload]);

  const turnOn = useCallback(async () => {
    const permission = await requestPushPermission();
    await setPushOptedIn();
    // The switches replace the explainer at once; the registration follows.
    await readDevice();
    if (permission !== "granted") return;
    await registerThisDevice({ force: true });
    await readDevice();
  }, [readDevice]);

  const retryRegistration = useCallback(async () => {
    await registerThisDevice({ force: true });
    await readDevice();
  }, [readDevice]);

  const { server } = model;
  const setPreference = useCallback(
    (key: NotificationPreferenceKey, value: boolean) => {
      if (server.status !== "loaded") return;
      const previous = server.preferences[key];
      const request = ++requestCount.current;
      dispatch({ type: "preference-set", request, key, value });
      void api
        .updateNotificationPreferences({ [key]: value })
        .then(({ data, error }) => {
          if (data) {
            dispatch({
              type: "server-loaded",
              request,
              preferences: data.preferences,
              pushAvailable: null,
            });
          } else if (error) {
            dispatch({ type: "preference-save-failed", key, previous });
            Alert.alert("Couldn't save the change", error);
          }
        });
    },
    [server]
  );

  const state = useMemo(() => derivePushScreenState(model), [model]);

  return useMemo(
    () => ({ state, turnOn, retryRegistration, setPreference, reload }),
    [state, turnOn, retryRegistration, setPreference, reload]
  );
}

/**
 * Holds the push settings for the screens inside it. Mount once, around the
 * Settings stack, inside the Settings tab so focus means "the Settings tab is
 * on screen".
 *
 * @param props.children - The Settings stack
 */
export function PushSettingsProvider({ children }: { children: ReactNode }) {
  const value = usePushSettingsState();
  return createElement(PushSettingsContext.Provider, { value }, children);
}

/**
 * The push settings of the surrounding {@link PushSettingsProvider}.
 *
 * @returns The derived screen state and the actions the screens offer
 * @throws {Error} When used outside the Settings stack
 */
export function usePushSettings(): PushSettings {
  const settings = useContext(PushSettingsContext);
  if (!settings) {
    throw new Error("usePushSettings must be used inside PushSettingsProvider");
  }
  return settings;
}
