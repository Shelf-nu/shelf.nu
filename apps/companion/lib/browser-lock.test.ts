/**
 * Tests for opening the in-app browser past a stale lock.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./browser-lock.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  DOUBLE_TAP_WINDOW_MS,
  joinOpensInFlight,
  openPastStaleLock,
  RELEASE_CAP_MS,
} from "./browser-lock";

type Result = { type: string };

/** An `open` that answers the given types in order, counting its calls. */
function opener(...types: string[]) {
  const calls = { open: 0 };
  const open = async (): Promise<Result> => ({ type: types[calls.open++] });
  return { open, calls };
}

test("an open that is not locked returns without releasing", async () => {
  const { open, calls } = opener("cancel");
  let released = 0;
  const result = await openPastStaleLock(
    open,
    async () => released++,
    "locked"
  );
  assert.deepEqual(result, { type: "cancel" });
  assert.equal(calls.open, 1);
  assert.equal(released, 0);
});

test("a locked answer releases the session once and opens again", async () => {
  const { open, calls } = opener("locked", "cancel");
  let released = 0;
  const result = await openPastStaleLock(
    open,
    async () => released++,
    "locked"
  );
  assert.deepEqual(result, { type: "cancel" });
  assert.equal(calls.open, 2);
  assert.equal(released, 1);
});

test("a release that fails still leads to the second open", async () => {
  const { open, calls } = opener("locked", "cancel");
  const result = await openPastStaleLock(
    open,
    () => Promise.reject(new Error("not open")),
    "locked"
  );
  assert.deepEqual(result, { type: "cancel" });
  assert.equal(calls.open, 2);
});

test("a release that never settles does not hold the open forever", async () => {
  // why: fake timers stand in for the cap, so the test does not depend on
  // how fast the machine runs.
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { open, calls } = opener("locked", "cancel");
    const pending = openPastStaleLock(
      open,
      () => new Promise(() => undefined),
      "locked"
    );
    // Let the first open and the release start before the clock moves.
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    mock.timers.tick(RELEASE_CAP_MS);
    assert.deepEqual(await pending, { type: "cancel" });
    assert.equal(calls.open, 2);
  } finally {
    mock.timers.reset();
  }
});

test("a second locked answer is returned, not retried again", async () => {
  const { open, calls } = opener("locked", "locked", "cancel");
  const result = await openPastStaleLock(open, async () => undefined, "locked");
  assert.deepEqual(result, { type: "locked" });
  assert.equal(calls.open, 2);
});

test("a second open while the first is presenting joins it", async () => {
  let clock = 0;
  const opened: string[] = [];
  let finish: (result: Result) => void = () => {};
  const open = joinOpensInFlight(
    (url: string) => {
      opened.push(url);
      return new Promise<Result>((resolve) => {
        finish = resolve;
      });
    },
    () => clock
  );

  const first = open("https://a.example");
  clock = DOUBLE_TAP_WINDOW_MS - 1;
  const second = open("https://a.example");
  assert.equal(second, first);
  assert.deepEqual(opened, ["https://a.example"]);

  finish({ type: "cancel" });
  assert.deepEqual(await first, { type: "cancel" });
});

test("an open after the double-tap window, or after the first ends, runs", async () => {
  let clock = 0;
  const opened: string[] = [];
  const open = joinOpensInFlight(
    async (url: string): Promise<Result> => {
      opened.push(url);
      return { type: "cancel" };
    },
    () => clock
  );

  await open("https://a.example");
  await open("https://b.example");
  assert.deepEqual(opened, ["https://a.example", "https://b.example"]);

  const pending = joinOpensInFlight(
    (url: string) => {
      opened.push(url);
      return new Promise<Result>(() => {});
    },
    () => clock
  );
  void pending("https://c.example");
  clock += DOUBLE_TAP_WINDOW_MS;
  void pending("https://d.example");
  assert.deepEqual(opened.slice(2), ["https://c.example", "https://d.example"]);
});
