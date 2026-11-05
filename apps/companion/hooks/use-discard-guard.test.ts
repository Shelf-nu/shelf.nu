/**
 * Tests for `useDiscardGuard`: what a stopped leave does for each decision,
 * and that the guard comes back after a leave that keeps the screen mounted.
 *
 * Runs under `node --test` with module mocks, so the hook renders in a plain
 * React test tree without a navigator or native modules.
 *
 * @see {@link file://./use-discard-guard.ts}
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import type { LeaveDecision } from "./use-discard-guard";

type StoppedLeave = { data: { action: unknown }; repeat: () => void };
type AlertButton = { text: string; style?: string; onPress?: () => void };
type GuardOptions = {
  active: boolean;
  decide: () => LeaveDecision;
  title: string;
  message: string;
};

/** What the guard last passed to `usePreventRemove`. */
const preventRemove: {
  active: boolean;
  onStopped: ((event: StoppedLeave) => void) | null;
} = { active: false, onStopped: null };
/** The guard's focus effect, run by hand to stand for a focus event. */
let onFocus: (() => void) | null = null;
/** Every alert the guard showed. */
const alerts: { title: string; message: string; buttons: AlertButton[] }[] = [];

// why: usePreventRemove needs expo-router's navigation tree. The mock records
// what the guard asks for, so a test can play a stopped leave by hand.
mock.module("expo-router", {
  namedExports: {
    usePreventRemove: (
      active: boolean,
      onStopped: (event: StoppedLeave) => void
    ) => {
      preventRemove.active = active;
      preventRemove.onStopped = onStopped;
    },
    // why: focus events come from the navigator, which these tests do not
    // mount. The mock keeps the effect so a test can fire a focus.
    useFocusEffect: (effect: () => void) => {
      onFocus = effect;
    },
  },
});

// why: Alert is a native dialog. The mock records it so a test can press its
// buttons.
mock.module("react-native", {
  namedExports: {
    Alert: {
      alert: (title: string, message: string, buttons: AlertButton[]) => {
        alerts.push({ title, message, buttons });
      },
    },
  },
});

let useDiscardGuard: (options: GuardOptions) => void;

before(async () => {
  ({ useDiscardGuard } = await import("./use-discard-guard"));
  // React only flushes `act` updates synchronously in an act environment.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  preventRemove.active = false;
  preventRemove.onStopped = null;
  onFocus = null;
  alerts.length = 0;
});

/** A component that only runs the hook. */
function Harness(options: GuardOptions) {
  useDiscardGuard(options);
  return null;
}

/** Renders the guard and returns a way to re-render it with new options. */
function renderGuard(options: GuardOptions) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(Harness, options));
  });
  return {
    rerender: (next: GuardOptions) =>
      act(() => renderer.update(createElement(Harness, next))),
  };
}

/** Plays a leave that the guard stopped; returns how often `repeat` ran. */
function stopLeave(): { repeats: () => number } {
  let count = 0;
  act(() => {
    preventRemove.onStopped?.({
      data: { action: { type: "GO_BACK" } },
      repeat: () => {
        count += 1;
      },
    });
  });
  return { repeats: () => count };
}

const copy = {
  title: "Discard changes?",
  message: "Your edits won't be saved.",
};

describe("useDiscardGuard", () => {
  it("does not stop a leave while inactive", () => {
    renderGuard({ ...copy, active: false, decide: () => "prompt" });
    assert.equal(preventRemove.active, false);
  });

  it("lets a 'leave' decision through with repeat and no alert", () => {
    renderGuard({ ...copy, active: true, decide: () => "leave" });
    assert.equal(preventRemove.active, true);

    const leave = stopLeave();

    assert.equal(leave.repeats(), 1);
    assert.equal(alerts.length, 0);
    // The hold drops in the same render that repeat replays the navigation.
    assert.equal(preventRemove.active, false);
  });

  it("keeps the user on the screen for a 'hold' decision", () => {
    renderGuard({ ...copy, active: true, decide: () => "hold" });

    const leave = stopLeave();

    assert.equal(leave.repeats(), 0);
    assert.equal(alerts.length, 0);
    assert.equal(preventRemove.active, true);
  });

  it("asks on a 'prompt' decision and leaves only on Discard", () => {
    renderGuard({ ...copy, active: true, decide: () => "prompt" });

    const leave = stopLeave();

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].title, copy.title);
    assert.equal(alerts[0].message, copy.message);
    assert.deepEqual(
      alerts[0].buttons.map((b) => b.text),
      ["Keep Editing", "Discard"]
    );
    assert.equal(leave.repeats(), 0);

    act(() => {
      alerts[0].buttons.find((b) => b.text === "Discard")?.onPress?.();
    });

    assert.equal(leave.repeats(), 1);
    assert.equal(preventRemove.active, false);
  });

  it("guards again on focus after a leave that kept the screen", () => {
    renderGuard({ ...copy, active: true, decide: () => "leave" });
    stopLeave();
    assert.equal(preventRemove.active, false);

    act(() => onFocus?.());

    assert.equal(preventRemove.active, true);
  });

  it("guards again when active changes after a leave", () => {
    const options: GuardOptions = {
      ...copy,
      active: true,
      decide: () => "leave",
    };
    const guard = renderGuard(options);
    stopLeave();
    assert.equal(preventRemove.active, false);

    guard.rerender({ ...options, active: false });
    guard.rerender({ ...options, active: true });

    assert.equal(preventRemove.active, true);
  });
});
