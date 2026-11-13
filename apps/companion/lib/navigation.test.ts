/**
 * Tests for leaving the booking scanner: `returnToBooking` goes back through
 * the scanner screen's own navigation, on the frame after the call, and never
 * through the global router (which acts on whatever tab is in front).
 *
 * @see {@link file://./navigation.ts}
 */
import assert from "node:assert/strict";
import { before, beforeEach, test, mock } from "node:test";

/** Router calls the fake recorded, in order. */
const calls: string[] = [];
/** Frame callbacks waiting to run. */
let frames: (() => void)[] = [];

// why: the router needs a mounted navigator; the fake records each call so
// the test can see which method navigated.
mock.module("expo-router", {
  namedExports: {
    router: {
      back: () => calls.push("back"),
      dismissTo: () => calls.push("dismissTo"),
      navigate: () => calls.push("navigate"),
      push: () => calls.push("push"),
    },
  },
});

// why: Platform comes from the native runtime; navigation.ts only reads OS.
mock.module("react-native", {
  namedExports: { Platform: { OS: "ios" } },
});

// why: expo-web-browser is a native module navigation.ts imports for its
// in-app browser helpers, which these tests do not call.
mock.module("expo-web-browser", {
  namedExports: {
    WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
    WebBrowserResultType: { LOCKED: "locked" },
    openBrowserAsync: () => Promise.resolve({ type: "dismiss" }),
    dismissBrowser: () => undefined,
  },
});

let returnToBooking: (scannerNavigation: { goBack: () => void }) => void;

before(async () => {
  // why: Node has no requestAnimationFrame; the fake holds callbacks until
  // the test runs the frame, so "not before the next frame" is observable.
  globalThis.requestAnimationFrame = ((cb: () => void) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
  ({ returnToBooking } = await import("./navigation"));
});

beforeEach(() => {
  calls.length = 0;
  frames = [];
});

/** The scanner screen's navigation; records into the same call list. */
const scannerNavigation = { goBack: () => calls.push("scanner.goBack") };

/** Runs every waiting frame callback. */
function runFrame() {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb();
}

test("returnToBooking goes back through the scanner's own navigation, not the router", () => {
  returnToBooking(scannerNavigation);
  runFrame();
  assert.deepEqual(calls, ["scanner.goBack"]);
});

test("returnToBooking waits for the next frame, so it is safe in an Alert button", () => {
  returnToBooking(scannerNavigation);
  assert.deepEqual(calls, []);
  runFrame();
  assert.deepEqual(calls, ["scanner.goBack"]);
});
