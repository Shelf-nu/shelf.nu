/**
 * Tests for the push settings state model.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./preferences.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  derivePushScreenState,
  INITIAL_PUSH_SETTINGS,
  notificationsRowValue,
  pushSettingsReducer,
  toPushPermission,
  type NotificationPreferences,
  type PushDeviceState,
  type PushSettingsAction,
  type PushSettingsModel,
} from "./preferences";

const ALL_ON: NotificationPreferences = {
  pushEnabled: true,
  bookings: true,
  audits: true,
  stockAndReminders: true,
};

/** Runs the actions through the reducer from the initial model. */
function after(...actions: PushSettingsAction[]): PushSettingsModel {
  return actions.reduce(pushSettingsReducer, INITIAL_PUSH_SETTINGS);
}

/** A phone that allowed notifications, opted in, and is registered. */
const CONNECTED: PushDeviceState = {
  permission: "granted",
  optedIn: true,
  registration: "registered",
};

const device = (
  overrides: Partial<PushDeviceState> = {}
): PushSettingsAction => ({
  type: "device-read",
  device: { ...CONNECTED, ...overrides },
});

const requested = (request: number): PushSettingsAction => ({
  type: "server-requested",
  request,
});

const loaded = (
  request: number,
  overrides: {
    preferences?: NotificationPreferences;
    pushAvailable?: boolean;
  } = {}
): PushSettingsAction => ({
  type: "server-loaded",
  request,
  preferences: overrides.preferences ?? ALL_ON,
  pushAvailable: overrides.pushAvailable ?? true,
});

test("the screen loads until both the phone and the server have answered", () => {
  assert.deepEqual(derivePushScreenState(after()), { kind: "loading" });
  assert.deepEqual(derivePushScreenState(after(device())), {
    kind: "loading",
  });
  assert.deepEqual(derivePushScreenState(after(requested(1), loaded(1))), {
    kind: "loading",
  });
});

test("a phone that never opted in shows the explainer, whatever the permission says", () => {
  for (const permission of ["undetermined", "granted", "denied"] as const) {
    assert.deepEqual(
      derivePushScreenState(
        after(
          requested(1),
          loaded(1),
          device({ optedIn: false, permission, registration: "none" })
        )
      ),
      { kind: "opt-in" },
      permission
    );
  }
});

test("an opted-in phone that can still be asked shows the explainer again", () => {
  assert.deepEqual(
    derivePushScreenState(
      after(requested(1), loaded(1), device({ permission: "undetermined" }))
    ),
    { kind: "opt-in" }
  );
});

test("a blocked permission shows the open-settings state", () => {
  assert.deepEqual(
    derivePushScreenState(
      after(requested(1), loaded(1), device({ permission: "denied" }))
    ),
    { kind: "denied" }
  );
});

test("an opted-in phone with permission shows the switches and its registration", () => {
  assert.deepEqual(
    derivePushScreenState(after(requested(1), loaded(1), device())),
    { kind: "ready", preferences: ALL_ON, registration: "registered" }
  );
  assert.deepEqual(
    derivePushScreenState(
      after(requested(1), loaded(1), device({ registration: "failed" }))
    ),
    { kind: "ready", preferences: ALL_ON, registration: "failed" }
  );
});

test("no plan with push shows disabled switches, before any opt-in", () => {
  for (const optedIn of [false, true]) {
    assert.deepEqual(
      derivePushScreenState(
        after(
          requested(1),
          loaded(1, { pushAvailable: false }),
          device({ optedIn })
        )
      ),
      { kind: "unavailable", preferences: ALL_ON },
      String(optedIn)
    );
  }
});

test("a failed first load is an error, and a retry goes back to loading", () => {
  const failed = after(device(), requested(1), {
    type: "server-failed",
    request: 1,
    message: "Request timed out.",
  });
  assert.deepEqual(derivePushScreenState(failed), {
    kind: "error",
    message: "Request timed out.",
  });
  assert.deepEqual(
    derivePushScreenState(pushSettingsReducer(failed, requested(2))),
    { kind: "loading" }
  );
});

test("a refetch keeps the switches on screen, even when it fails", () => {
  const ready = after(requested(1), loaded(1), device());
  const refetching = pushSettingsReducer(ready, requested(2));
  assert.deepEqual(derivePushScreenState(refetching), {
    kind: "ready",
    preferences: ALL_ON,
    registration: "registered",
  });
  assert.deepEqual(
    derivePushScreenState(
      pushSettingsReducer(refetching, {
        type: "server-failed",
        request: 2,
        message: "offline",
      })
    ),
    derivePushScreenState(ready)
  );
});

test("an older read that answers after a newer one is dropped", () => {
  const model = after(
    device(),
    requested(1),
    requested(2),
    loaded(2, { preferences: { ...ALL_ON, audits: false } }),
    loaded(1)
  );
  assert.deepEqual(derivePushScreenState(model), {
    kind: "ready",
    preferences: { ...ALL_ON, audits: false },
    registration: "registered",
  });
});

test("a read that started before a switch flipped does not flip it back", () => {
  const model = after(
    requested(1),
    loaded(1),
    device(),
    requested(2),
    { type: "preference-set", request: 3, key: "audits", value: false },
    loaded(2)
  );
  assert.deepEqual(derivePushScreenState(model), {
    kind: "ready",
    preferences: { ...ALL_ON, audits: false },
    registration: "registered",
  });
});

test("a saved switch takes the server's answer for every switch", () => {
  const model = after(
    requested(1),
    loaded(1),
    device(),
    { type: "preference-set", request: 2, key: "audits", value: false },
    {
      type: "server-loaded",
      request: 2,
      preferences: { ...ALL_ON, audits: false, bookings: false },
      pushAvailable: null,
    }
  );
  assert.deepEqual(derivePushScreenState(model), {
    kind: "ready",
    preferences: { ...ALL_ON, audits: false, bookings: false },
    registration: "registered",
  });
});

test("a failed save puts back the value the switch had before", () => {
  const model = after(
    requested(1),
    loaded(1, { preferences: { ...ALL_ON, audits: false } }),
    device(),
    { type: "preference-set", request: 2, key: "audits", value: true },
    { type: "preference-save-failed", key: "audits", previous: false }
  );
  assert.deepEqual(derivePushScreenState(model), {
    kind: "ready",
    preferences: { ...ALL_ON, audits: false },
    registration: "registered",
  });
});

test("flipping a switch before the server answers changes nothing", () => {
  const model = after({
    type: "preference-set",
    request: 1,
    key: "bookings",
    value: false,
  });
  assert.deepEqual(model, INITIAL_PUSH_SETTINGS);
});

test("the Settings row says On only for a phone registered for this person and server", () => {
  const ready = (overrides: Partial<PushDeviceState> = {}) =>
    derivePushScreenState(after(requested(1), loaded(1), device(overrides)));

  assert.equal(notificationsRowValue({ kind: "loading" }), null);
  assert.equal(notificationsRowValue({ kind: "error", message: "x" }), null);
  assert.equal(notificationsRowValue(ready()), "On");
  assert.equal(
    notificationsRowValue(ready({ registration: "failed" })),
    "Not connected"
  );
  assert.equal(
    notificationsRowValue(ready({ registration: "none" })),
    "Not connected"
  );
  assert.equal(
    notificationsRowValue(
      derivePushScreenState(
        after(
          requested(1),
          loaded(1, { preferences: { ...ALL_ON, pushEnabled: false } }),
          device({ registration: "failed" })
        )
      )
    ),
    "Off"
  );
  assert.equal(notificationsRowValue({ kind: "opt-in" }), "Off");
  assert.equal(
    notificationsRowValue({ kind: "unavailable", preferences: ALL_ON }),
    "Off"
  );
  assert.equal(
    notificationsRowValue({ kind: "denied" }),
    "Off in system settings"
  );
});

test("the OS permission answer reduces to granted, undetermined or denied", () => {
  assert.equal(
    toPushPermission({ granted: true, status: "granted", canAskAgain: true }),
    "granted"
  );
  assert.equal(
    toPushPermission({
      granted: false,
      status: "undetermined",
      canAskAgain: true,
    }),
    "undetermined"
  );
  // Android reports "denied" before its first prompt, and can still ask
  assert.equal(
    toPushPermission({ granted: false, status: "denied", canAskAgain: true }),
    "undetermined"
  );
  assert.equal(
    toPushPermission({ granted: false, status: "denied", canAskAgain: false }),
    "denied"
  );
});
