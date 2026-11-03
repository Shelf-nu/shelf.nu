/**
 * Tests for opening the in-app browser past a stale lock.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./browser-lock.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openPastStaleLock, RELEASE_CAP_MS } from "./browser-lock";

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
  const { open, calls } = opener("locked", "cancel");
  const started = Date.now();
  const result = await openPastStaleLock(
    open,
    () => new Promise(() => undefined),
    "locked"
  );
  assert.deepEqual(result, { type: "cancel" });
  assert.equal(calls.open, 2);
  assert.ok(Date.now() - started < RELEASE_CAP_MS + 500);
});

test("a second locked answer is returned, not retried again", async () => {
  const { open, calls } = opener("locked", "locked", "cancel");
  const result = await openPastStaleLock(open, async () => undefined, "locked");
  assert.deepEqual(result, { type: "locked" });
  assert.equal(calls.open, 2);
});
