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
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AppState } from "react-native";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { api } from "@/lib/api";
import {
  derivePushScreenState,
  flipPreference,
  INITIAL_PUSH_SETTINGS,
  pushSettingsReducer,
  settlePreferenceSave,
  type NotificationPreferenceKey,
  type NotificationPreferences,
  type PushScreenState,
  type PushSettingsAction,
  type PushSettingsModel,
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
   * Flips one switch at once and saves it. Saves go out one at a time, so the
   * last flip is the last write; a failed save shows the server's value again
   * and says why.
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
  // The latest model, which the save steps build on: a flip can come before
  // React renders the change ahead of it.
  const modelRef = useRef(INITIAL_PUSH_SETTINGS);
  const [model, setModel] = useState(INITIAL_PUSH_SETTINGS);
  const commit = useCallback((next: PushSettingsModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);
  const dispatch = useCallback(
    (action: PushSettingsAction) =>
      commit(pushSettingsReducer(modelRef.current, action)),
    [commit]
  );
  const isFocused = useIsFocused();

  // Numbers each read of the switches and each flip; the model applies a
  // read's answer only while it is the newest.
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
  }, [dispatch]);

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
  }, [dispatch, readDevice]);

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

  // Sends one PUT; its answer sends the flips that waited for it.
  const save = useCallback(
    function send(changes: Partial<NotificationPreferences>) {
      void api
        .updateNotificationPreferences(changes)
        .then(({ data, error }) => {
          if (error) Alert.alert("Couldn't save the change", error);
          const step = settlePreferenceSave(
            modelRef.current,
            data?.preferences ?? null
          );
          commit(step.model);
          if (step.send) send(step.send);
        });
    },
    [commit]
  );

  const setPreference = useCallback(
    (key: NotificationPreferenceKey, value: boolean) => {
      const request = ++requestCount.current;
      const step = flipPreference(modelRef.current, { request, key, value });
      commit(step.model);
      if (step.send) save(step.send);
    },
    [commit, save]
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
