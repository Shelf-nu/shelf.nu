/**
 * Tests for running tasks under a time cap.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./settle-within.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { settleWithin } from "./settle-within";

test("resolves once every task has settled, without waiting for the cap", async () => {
  const done: string[] = [];
  const started = Date.now();
  await settleWithin(
    [
      async () => {
        done.push("a");
      },
      async () => {
        done.push("b");
      },
    ],
    10_000
  );
  assert.deepEqual(done.sort(), ["a", "b"]);
  assert.ok(Date.now() - started < 1_000, "did not wait for the cap");
});

test("a task that throws or rejects neither fails the batch nor stops the others", async () => {
  const done: string[] = [];
  await settleWithin(
    [
      () => {
        throw new Error("synchronous");
      },
      () => Promise.reject(new Error("asynchronous")),
      async () => {
        done.push("ran");
      },
    ],
    10_000
  );
  assert.deepEqual(done, ["ran"]);
});

test("a task that never settles holds the batch up only until the cap", async () => {
  const started = Date.now();
  await settleWithin([() => new Promise<void>(() => {})], 30);
  const waited = Date.now() - started;
  assert.ok(waited >= 25 && waited < 1_000, `waited ${waited} ms`);
});
