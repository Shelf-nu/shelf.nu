/**
 * Tests for the native update attempt queue.
 *
 * `run` is a fake whose attempts the test resolves by hand, so an answer can
 * be made to arrive exactly while an attempt is in flight.
 *
 * @see ./native-update-scheduler.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { NativeUpdateOutcome, NativeUpdateResult } from "./native-update";
import {
  createNativeUpdateScheduler,
  type UpdateAnswer,
} from "./native-update-scheduler";

/** One attempt the fake `run` was asked for, held open until resolved. */
type Attempt = {
  isCurrent: () => boolean;
  iosShownStoreVersion: string | null;
  resolve: (result: NativeUpdateResult) => void;
};

/** Builds a scheduler whose attempts and outcomes the test can inspect. */
function setup({
  platform = "android",
  appVersion = "1.6.0",
  shown = null as string | null,
} = {}) {
  const attempts: Attempt[] = [];
  const outcomes: NativeUpdateOutcome[] = [];
  let storageReads = 0;
  const scheduler = createNativeUpdateScheduler({
    platform,
    getAppVersion: () => appVersion,
    readIosShownStoreVersion: async () => {
      storageReads++;
      return shown;
    },
    run: ({ isCurrent, iosShownStoreVersion }) =>
      new Promise((resolve) =>
        attempts.push({ isCurrent, iosShownStoreVersion, resolve })
      ),
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  return { scheduler, attempts, outcomes, storageReads: () => storageReads };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

const answer = (version: string | null): UpdateAnswer => ({ version });

test("an advertised newer version starts one attempt and reports its outcome", async () => {
  const { scheduler, attempts, outcomes } = setup();
  const idle = scheduler.submit(answer("1.7.0"));
  await flush();
  assert.equal(attempts.length, 1);
  attempts[0].resolve("unavailable");
  await idle;
  assert.deepEqual(outcomes, ["unavailable"]);
});

test("no newer version means no attempt", async () => {
  const { scheduler, attempts, outcomes } = setup();
  await scheduler.submit(answer(null));
  await scheduler.submit(answer("1.6.0"));
  assert.equal(attempts.length, 0);
  assert.deepEqual(outcomes, []);
});

test("an answer that lands mid-attempt is evaluated after it", async () => {
  const { scheduler, attempts, outcomes } = setup();
  scheduler.submit(answer("1.7.0"));
  await flush();
  const idle = scheduler.submit(answer("1.8.0"));
  // The first attempt now belongs to an old answer.
  assert.equal(attempts[0].isCurrent(), false);
  attempts[0].resolve("no-store-update");
  await flush();
  assert.equal(attempts.length, 2, "the newer answer gets its own attempt");
  assert.equal(attempts[1].isCurrent(), true);
  attempts[1].resolve("unavailable");
  await idle;
  // The stale result was dropped, not reported.
  assert.deepEqual(outcomes, ["unavailable"]);
});

test("a superseded attempt reports nothing and the newer answer runs", async () => {
  const { scheduler, attempts, outcomes } = setup();
  scheduler.submit(answer("1.7.0"));
  await flush();
  const idle = scheduler.submit(answer("1.8.0"));
  attempts[0].resolve("superseded");
  await flush();
  attempts[1].resolve("started");
  await idle;
  assert.deepEqual(outcomes, ["started"]);
});

test("native UI already on screen is reported even after a newer answer", async () => {
  const { scheduler, attempts, outcomes } = setup();
  scheduler.submit(answer("1.7.0"));
  await flush();
  const idle = scheduler.submit(answer("1.8.0"));
  attempts[0].resolve("started");
  await idle;
  assert.deepEqual(outcomes, ["started"]);
  // `started` settled the launch, so the newer answer started nothing.
  assert.equal(attempts.length, 1);
});

test("a settled launch makes no further attempts", async () => {
  const { scheduler, attempts } = setup();
  const idle = scheduler.submit(answer("1.7.0"));
  await flush();
  attempts[0].resolve("unavailable");
  await idle;
  await scheduler.submit(answer("1.8.0"));
  assert.equal(attempts.length, 1);
});

test("no store update leaves the launch open for a later re-check", async () => {
  const { scheduler, attempts } = setup();
  let idle = scheduler.submit(answer("1.7.0"));
  await flush();
  attempts[0].resolve("no-store-update");
  await idle;
  idle = scheduler.submit(answer("1.7.0"));
  await flush();
  assert.equal(attempts.length, 2);
  attempts[1].resolve("started");
  await idle;
});

test("a reported download settles the launch", async () => {
  const { scheduler, attempts, outcomes } = setup();
  scheduler.report("downloaded");
  await scheduler.submit(answer("1.7.0"));
  assert.deepEqual(outcomes, ["downloaded"]);
  assert.equal(attempts.length, 0);
});

test("iOS reads the shown version once per attempt and hands it on", async () => {
  const { scheduler, attempts, storageReads } = setup({
    platform: "ios",
    shown: "1.6.5",
  });
  const idle = scheduler.submit(answer("1.7.0"));
  await flush();
  assert.equal(storageReads(), 1);
  assert.equal(attempts[0].iosShownStoreVersion, "1.6.5");
  attempts[0].resolve("started");
  await idle;
});

test("iOS skips the attempt for a version the sheet was already shown for", async () => {
  const { scheduler, attempts } = setup({ platform: "ios", shown: "1.7.0" });
  await scheduler.submit(answer("1.7.0"));
  assert.equal(attempts.length, 0);
});

test("Android never reads the iOS storage key", async () => {
  const { scheduler, attempts, storageReads } = setup();
  const idle = scheduler.submit(answer("1.7.0"));
  await flush();
  assert.equal(storageReads(), 0);
  attempts[0].resolve("started");
  await idle;
});
