/**
 * Tests for home-screen quick actions: the launch action holder, and the
 * hook's listening, taking the launch action and navigating.
 *
 * The hook keeps one launch action per app process, so the hook cases run in
 * order and share it: the first mount opens it, later mounts do not.
 *
 * @see {@link file://./quick-actions.ts}
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import type { Action } from "expo-quick-actions";

/** Calls into the mocked expo-quick-actions and router, in order. */
const calls: string[] = [];
/** Routes the hook pushed. */
const pushes: string[] = [];
/** The listener the hook added, so a test can deliver a warm action. */
let listener: ((action: Action) => void) | null = null;
/** What takePendingActionAsync resolves with on the first mount. */
let pendingAction: Action | null = null;

// why: expo-quick-actions is a native module. The fake records the order of
// addListener and takePendingActionAsync, which is what the hook guarantees.
mock.module("expo-quick-actions", {
  namedExports: {
    initial: undefined,
    setItems: () => Promise.resolve(),
    addListener: (next: (action: Action) => void) => {
      calls.push("addListener");
      listener = next;
      return {
        remove: () => {
          listener = null;
        },
      };
    },
    takePendingActionAsync: () => {
      calls.push("takePendingActionAsync");
      return Promise.resolve(pendingAction);
    },
  },
});

// why: the router needs a mounted navigator; the fake records pushes.
const router = {
  push: (href: string) => {
    pushes.push(href);
  },
};
mock.module("expo-router", {
  namedExports: { useRouter: () => router },
});

// why: Platform comes from the native runtime; the icons only need an OS.
mock.module("react-native", {
  namedExports: { Platform: { OS: "ios" } },
});

let quickActions: typeof import("./quick-actions");

before(async () => {
  quickActions = await import("./quick-actions");
  // React only flushes `act` updates synchronously in an act environment.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  calls.length = 0;
  pushes.length = 0;
});

/** A component that only runs the hook. */
function Harness() {
  quickActions.useQuickActions();
  return null;
}

/** Mounts the hook and lets its promises settle. */
async function mount() {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(createElement(Harness));
  });
  return renderer;
}

const scan: Action = {
  id: "scan_qr",
  title: "Scan QR Code",
  params: { route: "/(tabs)/scanner" },
};

describe("createLaunchAction", () => {
  it("prefers the launch-options action over a pending one", async () => {
    let pendingTaken = false;
    const launch = quickActions.createLaunchAction({
      initial: scan,
      takePending: () => {
        pendingTaken = true;
        return Promise.resolve(null);
      },
    });

    assert.equal(await launch.read(), scan);
    assert.equal(pendingTaken, false);
  });

  it("asks the source once and keeps the action until it is opened", async () => {
    let takes = 0;
    const launch = quickActions.createLaunchAction({
      initial: undefined,
      takePending: () => {
        takes += 1;
        return Promise.resolve(scan);
      },
    });

    assert.equal(await launch.read(), scan);
    assert.equal(
      await launch.read(),
      scan,
      "a cancelled run can read it again"
    );
    launch.markOpened();
    assert.equal(await launch.read(), null);
    assert.equal(takes, 1);
  });
});

describe("useQuickActions", () => {
  it("opens the launch action after a delay, even when the first run is cut short", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      pendingAction = scan;
      const first = await mount();
      assert.deepEqual(pushes, [], "not before navigation has settled");
      // Unmounted before the delay ran out: the action must survive.
      act(() => first.unmount());

      const second = await mount();
      mock.timers.tick(300);

      assert.deepEqual(pushes, ["/(tabs)/scanner"]);
      assert.equal(
        calls.filter((call) => call === "takePendingActionAsync").length,
        1,
        "native is asked once"
      );
      act(() => second.unmount());
    } finally {
      mock.timers.reset();
    }
  });

  it("does not open the launch action again on a later mount", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const renderer = await mount();

      assert.deepEqual(calls, ["addListener"]);
      mock.timers.tick(300);
      assert.deepEqual(pushes, []);
      act(() => renderer.unmount());
    } finally {
      mock.timers.reset();
    }
  });

  it("opens an action picked while the app runs right away", async () => {
    const renderer = await mount();

    act(() => listener?.(scan));

    assert.deepEqual(pushes, ["/(tabs)/scanner"]);
    act(() => renderer.unmount());
  });
});
