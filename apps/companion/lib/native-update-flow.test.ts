/**
 * Tests for the native update flows.
 *
 * The library calls are fakes that record what they were asked, so these
 * tests pin the call order and arguments a device would see.
 *
 * @see ./native-update-flow.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  runAppStoreFlow,
  runPlayFlow,
  type AppStoreApi,
  type PlayApi,
  type PlayUpdateCheck,
} from "./native-update-flow";

const always = () => true;
const never = () => false;

// ── runPlayFlow ──────────────────────────────────────────

/** A fake Play that answers checks in order and records each start. */
function fakePlay(checks: PlayUpdateCheck[], startResult = true) {
  const starts: boolean[] = [];
  let i = 0;
  const api: PlayApi = {
    checkForUpdate: async () => checks[Math.min(i++, checks.length - 1)],
    startUpdate: async (isImmediate) => {
      starts.push(isImmediate);
      return startResult;
    },
  };
  return { api, starts };
}

const offered: PlayUpdateCheck = {
  updateAvailable: true,
  flexibleAllowed: true,
};

test("Play: starts the flexible flow, never the immediate one", async () => {
  const { api, starts } = fakePlay([offered]);
  assert.equal(await runPlayFlow(api, always), "started");
  assert.deepEqual(starts, [false]);
});

test("Play: no update, or one still downloading, starts nothing", async () => {
  for (const check of [
    { updateAvailable: false },
    { updateAvailable: true, updateInProgress: true },
  ]) {
    const { api, starts } = fakePlay([check]);
    assert.equal(await runPlayFlow(api, always), "no-store-update");
    assert.deepEqual(starts, []);
  }
});

test("Play: a finished download is reported without starting anything", async () => {
  const { api, starts } = fakePlay([
    { updateAvailable: true, downloaded: true },
  ]);
  assert.equal(await runPlayFlow(api, always), "downloaded");
  assert.deepEqual(starts, []);
});

test("Play: an update that is not flexible falls back to the banner", async () => {
  const { api, starts } = fakePlay([
    { updateAvailable: true, flexibleAllowed: false },
  ]);
  assert.equal(await runPlayFlow(api, always), "unavailable");
  assert.deepEqual(starts, []);
});

test("Play: a newer server answer stops the attempt before the UI opens", async () => {
  const { api, starts } = fakePlay([offered]);
  assert.equal(await runPlayFlow(api, never), "superseded");
  assert.deepEqual(starts, []);
});

test("Play: a refused start asks again and reports what changed", async () => {
  const retry = async (second: PlayUpdateCheck) =>
    runPlayFlow(fakePlay([offered, second], false).api, always);
  assert.equal(
    await retry({ updateAvailable: true, flexibleAllowed: false }),
    "unavailable"
  );
  assert.equal(
    await retry({ updateAvailable: true, downloaded: true }),
    "downloaded"
  );
  assert.equal(await retry({ updateAvailable: false }), "no-store-update");
});

// ── runAppStoreFlow ──────────────────────────────────────

/** A fake App Store that records every start and remembered version. */
function fakeStore(
  lookup: { updateAvailable: boolean; storeVersion?: string | null },
  { startResult = true, rememberFails = false } = {}
) {
  const calls: string[] = [];
  const api: AppStoreApi = {
    checkForUpdate: async () => lookup,
    startUpdate: async () => {
      calls.push("start");
      return startResult;
    },
    rememberShown: async (version) => {
      calls.push(`remember ${version}`);
      if (rememberFails) throw new Error("storage full");
    },
  };
  return { api, calls };
}

const run = (
  api: AppStoreApi,
  { isCurrent = always, shownStoreVersion = null as string | null } = {}
) => runAppStoreFlow(api, { isCurrent, shownStoreVersion });

test("App Store: shows the sheet, then remembers its version", async () => {
  const { api, calls } = fakeStore({
    updateAvailable: true,
    storeVersion: "1.7.0",
  });
  assert.equal(await run(api), "started");
  assert.deepEqual(calls, ["start", "remember 1.7.0"]);
});

test("App Store: a sheet that did not open is not remembered", async () => {
  const { api, calls } = fakeStore(
    { updateAvailable: true, storeVersion: "1.7.0" },
    { startResult: false }
  );
  assert.equal(await run(api), "unavailable");
  assert.deepEqual(calls, ["start"]);
});

test("App Store: a lookup without a store version falls back to the banner", async () => {
  for (const storeVersion of [undefined, null, ""]) {
    const { api, calls } = fakeStore({ updateAvailable: false, storeVersion });
    assert.equal(await run(api), "unavailable");
    assert.deepEqual(calls, []);
  }
});

test("App Store: nothing newer in the store, or already shown, opens nothing", async () => {
  const notNewer = fakeStore({ updateAvailable: false, storeVersion: "1.6.0" });
  assert.equal(await run(notNewer.api), "no-store-update");
  assert.deepEqual(notNewer.calls, []);

  const shown = fakeStore({ updateAvailable: true, storeVersion: "1.7.0" });
  assert.equal(
    await run(shown.api, { shownStoreVersion: "1.7.0" }),
    "no-store-update"
  );
  assert.deepEqual(shown.calls, []);
});

test("App Store: a newer server answer stops the attempt before the sheet", async () => {
  const { api, calls } = fakeStore({
    updateAvailable: true,
    storeVersion: "1.7.0",
  });
  assert.equal(await run(api, { isCurrent: never }), "superseded");
  assert.deepEqual(calls, []);
});

test("App Store: a storage failure still counts the sheet as shown", async () => {
  const { api } = fakeStore(
    { updateAvailable: true, storeVersion: "1.7.0" },
    { rememberFails: true }
  );
  assert.equal(await run(api), "started");
});
