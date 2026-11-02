/**
 * Tests for the work that runs before a session ends.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./session-end.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { onBeforeSessionEnd, runBeforeSessionEnd } from "./session-end";

test("a registered task finishes before the sign-out it precedes goes ahead", async () => {
  const calls: string[] = [];
  const unregister = onBeforeSessionEnd(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    calls.push("task");
  });

  await runBeforeSessionEnd();
  calls.push("sign-out");
  unregister();

  assert.deepEqual(calls, ["task", "sign-out"]);
});

test("a task that rejects does not fail the sign-out or stop the others", async () => {
  const calls: string[] = [];
  const unregisterFailing = onBeforeSessionEnd(async () => {
    throw new Error("offline");
  });
  const unregisterOther = onBeforeSessionEnd(async () => {
    calls.push("other");
  });

  await runBeforeSessionEnd();
  unregisterFailing();
  unregisterOther();

  assert.deepEqual(calls, ["other"]);
});

test("an unregistered task no longer runs", async () => {
  let ran = false;
  const unregister = onBeforeSessionEnd(async () => {
    ran = true;
  });
  unregister();

  await runBeforeSessionEnd();
  assert.equal(ran, false);
});
