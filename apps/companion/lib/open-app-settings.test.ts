/**
 * Tests for {@link openAppSettings}: Settings opens when it can, and a failure
 * becomes an alert instead of an unhandled rejection.
 *
 * @see {@link file://./open-app-settings.ts}
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

/** Whether the mocked `Linking.openSettings` rejects. */
let settingsFail = false;
/** How many times Settings was asked to open. */
let openCalls = 0;
/** Alerts shown, as [title, message]. */
const alerts: [string, string][] = [];

// why: Linking and Alert are native modules; the fakes record what was asked.
mock.module("react-native", {
  namedExports: {
    Linking: {
      openSettings: () => {
        openCalls++;
        return settingsFail
          ? Promise.reject(new Error("Unable to open URL: app-settings:"))
          : Promise.resolve();
      },
    },
    Alert: {
      alert: (title: string, message: string) => {
        alerts.push([title, message]);
      },
    },
  },
});

/** The module under test, imported once its native dependencies are mocked. */
let settings: typeof import("./open-app-settings");

before(async () => {
  settings = await import("./open-app-settings");
});

beforeEach(() => {
  settingsFail = false;
  openCalls = 0;
  alerts.length = 0;
});

describe("openAppSettings", () => {
  it("opens Settings without an alert", async () => {
    await settings.openAppSettings(settings.CAMERA_SETTINGS_FALLBACK);

    assert.equal(openCalls, 1);
    assert.deepEqual(alerts, []);
  });

  it("shows the fallback alert, and does not reject, when Settings cannot open", async () => {
    settingsFail = true;

    await assert.doesNotReject(
      settings.openAppSettings(settings.CAMERA_SETTINGS_FALLBACK)
    );

    const { title, message } = settings.CAMERA_SETTINGS_FALLBACK;
    assert.deepEqual(alerts, [[title, message]]);
  });
});
