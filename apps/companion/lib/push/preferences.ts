/**
 * State model for the push notification settings.
 *
 * Two sources decide what the Notifications screen shows. The phone: its
 * notification permission, whether the person turned notifications on here
 * (the opt-in flag only the explainer sets), and whether this phone is
 * registered for them. The server: the answer to
 * `GET /api/mobile/notification-preferences` (the person's switches and
 * whether any of their workspaces' plans include push). This module holds
 * both in one model, applies changes through a reducer, and derives the one
 * screen state the UI renders, so the screen and the Settings row never
 * disagree about which case applies. It also queues the saves of switch
 * flips, one PUT at a time, so the server applies them in the order they
 * were made.
 *
 * `NotificationPreferences` MIRRORS the server type in
 * `apps/webapp/app/modules/push/types.ts`. The server
 * stores the switches and applies them at send time; this copy only renders
 * them. Extraction target: a pure `packages/*` push module (none yet).
 *
 * Pure on purpose (no React Native, Expo or `@/` imports) so `node:test` can
 * load it. The phone reads live in `./registration.ts` and the hook that
 * drives this model in `hooks/use-push-settings.ts`.
 *
 * @see {@link file://./preferences.test.ts}
 */
import type { PushCategory } from "./routing";
import type { PushRegistrationStatus } from "./token-record";

/**
 * A person's push switches. `pushEnabled` silences every category at once; a
 * category push is delivered only when both it and `pushEnabled` are on.
 */
export type NotificationPreferences = {
  pushEnabled: boolean;
} & Record<PushCategory, boolean>;

/** One switch in {@link NotificationPreferences}. */
export type NotificationPreferenceKey = keyof NotificationPreferences;

/**
 * The phone's notification permission, reduced to what the screen acts on.
 * `undetermined` means the app may still show the system prompt.
 */
export type PushPermission = "undetermined" | "granted" | "denied";

/** The OS permission answer, as expo-notifications reports it. */
export type PermissionAnswer = {
  granted: boolean;
  /** "granted", "denied" or "undetermined". */
  status: string;
  canAskAgain: boolean;
};

/**
 * Reduces the OS permission answer to what the settings screen acts on.
 *
 * @param answer - The answer of `getPermissionsAsync` or
 *   `requestPermissionsAsync`
 * @returns "granted"; "undetermined" while the prompt can still be shown
 *   (Android reports "denied" before its first prompt); "denied" when only
 *   the phone's settings can change it
 */
export function toPushPermission(answer: PermissionAnswer): PushPermission {
  if (answer.granted) return "granted";
  if (answer.status === "undetermined" || answer.canAskAgain) {
    return "undetermined";
  }
  return "denied";
}

/** What the phone knows, read together. */
export type PushDeviceState = {
  permission: PushPermission;
  /**
   * Whether the person turned notifications on on this phone, through the
   * explainer. Android 12 and older grant the permission without asking, so
   * the permission alone does not say the person wants notifications.
   */
  optedIn: boolean;
  /** Whether this phone is registered for the signed-in person and server. */
  registration: PushRegistrationStatus;
};

/** The server's answer about the person's switches. */
export type PushServerState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | {
      status: "loaded";
      /** The switches as the server last answered them. */
      preferences: NotificationPreferences;
      /** Whether any of the person's workspaces' plans include push. */
      pushAvailable: boolean;
    };

/**
 * The saves of switch flips the server has not answered yet. One PUT is on
 * the wire at a time; flips made meanwhile wait, merged per switch, for the
 * next one. The server therefore applies the flips in the order they were
 * made, and the last flip is the last write.
 */
export type PreferenceSaves = {
  /** The switches the PUT on the wire carries; null when none is. */
  sending: Partial<NotificationPreferences> | null;
  /** Flips made while that PUT is on the wire; null when there are none. */
  waiting: Partial<NotificationPreferences> | null;
};

/** Everything the push settings know. `device` is null until read. */
export type PushSettingsModel = {
  device: PushDeviceState | null;
  server: PushServerState;
  /** The screen shows these flips on top of the server's switches. */
  saves: PreferenceSaves;
  /**
   * Numbers the newest read or switch flip. A read's answer replaces the
   * switches only while it is the newest, so a read that started before a
   * flip cannot undo it.
   */
  latestRequest: number;
};

/** The model before anything has been read. */
export const INITIAL_PUSH_SETTINGS: PushSettingsModel = {
  device: null,
  server: { status: "loading" },
  saves: { sending: null, waiting: null },
  latestRequest: 0,
};

/**
 * A change to the push settings model, other than a switch save (see
 * {@link flipPreference}). `request` numbers come from the caller, one per
 * read or flip, increasing.
 */
export type PushSettingsAction =
  | { type: "device-read"; device: PushDeviceState }
  /** A read of the server's answer is starting. */
  | { type: "server-requested"; request: number }
  /** The server's answer to a read. */
  | {
      type: "server-loaded";
      request: number;
      preferences: NotificationPreferences;
      pushAvailable: boolean;
    }
  | { type: "server-failed"; request: number; message: string };

/**
 * Applies one action to the model.
 *
 * Answers of any read but the newest are dropped, and so is a read that
 * started before a switch flipped. A refetch keeps the switches already on
 * screen until the new answer arrives; only a retry after a failure shows the
 * loading state again. A failed refetch likewise keeps loaded switches rather
 * than replacing them with an error.
 *
 * @param model - The current model
 * @param action - What happened
 * @returns The next model
 */
export function pushSettingsReducer(
  model: PushSettingsModel,
  action: PushSettingsAction
): PushSettingsModel {
  const { server } = model;
  switch (action.type) {
    case "device-read":
      return { ...model, device: action.device };
    case "server-requested":
      return {
        ...model,
        latestRequest: action.request,
        server: server.status === "failed" ? { status: "loading" } : server,
      };
    case "server-loaded":
      if (action.request !== model.latestRequest) return model;
      return {
        ...model,
        server: {
          status: "loaded",
          preferences: action.preferences,
          pushAvailable: action.pushAvailable,
        },
      };
    case "server-failed":
      if (action.request !== model.latestRequest) return model;
      if (server.status === "loaded") return model;
      return {
        ...model,
        server: { status: "failed", message: action.message },
      };
  }
}

/** A change to the model, and the PUT it asks the caller to send. */
export type PreferenceSaveStep = {
  model: PushSettingsModel;
  /** The switches to PUT now; null when the change sends nothing. */
  send: Partial<NotificationPreferences> | null;
};

/**
 * Flips one switch on screen and queues its save. The flip shows at once.
 * Its PUT leaves now when none is on the wire; otherwise it waits, merged
 * with the other waiting flips, until {@link settlePreferenceSave} sends it.
 *
 * @param model - The current model
 * @param flip.request - Numbers the flip, so a read that started before it
 *   is dropped
 * @param flip.key - The switch
 * @param flip.value - Its new value
 * @returns The next model, and the PUT to send now, if any. Nothing changes
 *   before the server's switches have loaded.
 */
export function flipPreference(
  model: PushSettingsModel,
  flip: { request: number; key: NotificationPreferenceKey; value: boolean }
): PreferenceSaveStep {
  if (model.server.status !== "loaded") return { model, send: null };
  const change = { [flip.key]: flip.value };
  const { sending, waiting } = model.saves;
  const flipped = { ...model, latestRequest: flip.request };
  if (sending === null) {
    return {
      model: { ...flipped, saves: { sending: change, waiting: null } },
      send: change,
    };
  }
  return {
    model: {
      ...flipped,
      saves: { sending, waiting: { ...waiting, ...change } },
    },
    send: null,
  };
}

/**
 * Applies the answer to the PUT on the wire, and sends the flips that waited
 * for it as the next PUT.
 *
 * @param model - The current model
 * @param answer - Every switch as the server holds it after the save; null
 *   when the save failed, which drops the flips it carried unless they were
 *   made again since
 * @returns The next model, and the PUT to send now, if any
 */
export function settlePreferenceSave(
  model: PushSettingsModel,
  answer: NotificationPreferences | null
): PreferenceSaveStep {
  const { server, saves } = model;
  return {
    model: {
      ...model,
      server:
        answer && server.status === "loaded"
          ? { ...server, preferences: answer }
          : server,
      saves: { sending: saves.waiting, waiting: null },
    },
    send: saves.waiting,
  };
}

/** The switches the screen shows: the server's, with unsaved flips on top. */
function shownPreferences(
  preferences: NotificationPreferences,
  { sending, waiting }: PreferenceSaves
): NotificationPreferences {
  return { ...preferences, ...sending, ...waiting };
}

/** The one case the Notifications screen renders. */
export type PushScreenState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** No workspace plan includes push: the switches show, disabled. */
  | { kind: "unavailable"; preferences: NotificationPreferences }
  /**
   * The person has not turned notifications on on this phone, or the system
   * prompt can still be shown: the explainer offers it.
   */
  | { kind: "opt-in" }
  /** The person turned notifications off for Shelf in the phone's settings. */
  | { kind: "denied" }
  | {
      kind: "ready";
      preferences: NotificationPreferences;
      registration: PushRegistrationStatus;
    };

/**
 * Derives the screen state from the model.
 *
 * The plan check comes before the opt-in: someone whose workspaces cannot
 * receive push is told so, and is never asked for a permission that would
 * bring them nothing. The explainer shows whenever the person has not opted
 * in on this phone, on every platform, whatever the permission says.
 *
 * @param model - The push settings model
 * @returns The state to render
 */
export function derivePushScreenState(
  model: PushSettingsModel
): PushScreenState {
  const { device, server, saves } = model;
  if (server.status === "failed") {
    return { kind: "error", message: server.message };
  }
  if (device === null || server.status === "loading") {
    return { kind: "loading" };
  }
  const preferences = shownPreferences(server.preferences, saves);
  if (!server.pushAvailable) {
    return { kind: "unavailable", preferences };
  }
  if (!device.optedIn || device.permission === "undetermined") {
    return { kind: "opt-in" };
  }
  if (device.permission === "denied") return { kind: "denied" };
  return {
    kind: "ready",
    preferences,
    registration: device.registration,
  };
}

/** What the Settings row says about notifications. */
export type NotificationsRowValue =
  | "On"
  | "Off"
  | "Off in system settings"
  | "Not connected";

/**
 * The value shown on the Settings "Notifications" row.
 *
 * @param state - The derived screen state
 * @returns "On" only when the master switch is on and this phone is
 *   registered for the signed-in person and server; "Not connected" when the
 *   switch is on but the phone is not registered (the last attempt failed or
 *   none has finished); "Off in system settings" when the phone blocks
 *   notifications; "Off" otherwise; null while that is not known yet
 */
export function notificationsRowValue(
  state: PushScreenState
): NotificationsRowValue | null {
  switch (state.kind) {
    case "loading":
    case "error":
      return null;
    case "denied":
      return "Off in system settings";
    case "unavailable":
    case "opt-in":
      return "Off";
    case "ready":
      if (!state.preferences.pushEnabled) return "Off";
      return state.registration === "registered" ? "On" : "Not connected";
  }
}
