/**
 * Tests for submitting a change from a sheet that stays open until the server
 * accepts it.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract under test is the order of events. The sheet may close only
 * after the server accepted the change: a sheet that closed before a refusal
 * would lose everything the user entered, because it re-seeds from the
 * unchanged record when it reopens, or its multi-step queue starts over.
 *
 * @see ./sheet-submit.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SHEET_SUBMIT_FALLBACK_ERROR,
  submitFromSheet,
  type SheetSubmit,
} from "./sheet-submit";

/**
 * A submit whose callbacks log, in order, what the screen would do.
 *
 * @param server.respond - How the server answers; defaults to accepting.
 * @returns The submit, and the log its callbacks write to.
 */
function loggedSubmit({
  respond = async () => ({ error: null }),
}: {
  respond?: SheetSubmit["request"];
} = {}) {
  const log: string[] = [];
  const submit: SheetSubmit = {
    lock: { current: false },
    request: () => {
      log.push("request");
      return respond();
    },
    onAccepted: () => log.push("close sheet"),
    refresh: async () => {
      log.push("refresh");
    },
    setSubmitting: (submitting) =>
      log.push(submitting ? "submitting" : "settled"),
    showError: (message) => log.push(`alert: ${message}`),
  };
  return { submit, log };
}

test("closes the sheet only once the server accepts, then refreshes", async () => {
  const { submit, log } = loggedSubmit();

  assert.equal(await submitFromSheet(submit), true);
  assert.deepEqual(log, [
    "submitting",
    "request",
    "close sheet",
    "refresh",
    "settled",
  ]);
});

test("keeps the sheet open and explains a refused change", async () => {
  // The server re-checks placements against the row-locked asset; a conflict
  // must leave the user's rows on screen to fix and save again.
  const refusal = "Placements add up to more than the asset's total.";
  const { submit, log } = loggedSubmit({
    respond: async () => ({ error: refusal }),
  });

  assert.equal(await submitFromSheet(submit), false);
  assert.deepEqual(log, [
    "submitting",
    "request",
    `alert: ${refusal}`,
    "settled",
  ]);
});

test("treats a request that throws as a failure, leaving the sheet open", async () => {
  const { submit, log } = loggedSubmit({
    respond: async () => {
      throw new Error("socket closed");
    },
  });

  assert.equal(await submitFromSheet(submit), false);
  assert.deepEqual(log, [
    "submitting",
    "request",
    `alert: ${SHEET_SUBMIT_FALLBACK_ERROR}`,
    "settled",
  ]);
  // Released, so the user can try again from the same sheet.
  assert.equal(submit.lock.current, false);
});

test("ignores a second submit while the first is still in flight", async () => {
  let accept: () => void = () => {};
  const { submit, log } = loggedSubmit({
    respond: () =>
      new Promise((resolve) => {
        accept = () => resolve({ error: null });
      }),
  });
  const requests = () => log.filter((entry) => entry === "request").length;

  // A double tap: the second submit arrives before the first request settles.
  const first = submitFromSheet(submit);
  assert.equal(await submitFromSheet(submit), false);

  accept();
  assert.equal(await first, true);
  assert.equal(requests(), 1);

  // Once settled, the sheet can submit again.
  const again = submitFromSheet(submit);
  accept();
  assert.equal(await again, true);
  assert.equal(requests(), 2);
});

test("still reports a save the server accepted when the reload after it throws", async () => {
  // The change went through, so it must not come back as a failure: several
  // of these requests are not safe to send twice. The lock must still be
  // released, or the next sheet's controls would stay disabled.
  const log: string[] = [];
  const submit: SheetSubmit = {
    lock: { current: false },
    request: async () => ({ error: null }),
    onAccepted: () => log.push("close sheet"),
    refresh: async () => {
      throw new Error("offline");
    },
    onRefreshFailed: () => log.push("saved, reload failed"),
    setSubmitting: (submitting) =>
      log.push(submitting ? "submitting" : "settled"),
    showError: (message) => log.push(`alert: ${message}`),
  };

  assert.equal(await submitFromSheet(submit), true);
  assert.deepEqual(log, [
    "submitting",
    "close sheet",
    "saved, reload failed",
    "settled",
  ]);
  assert.equal(submit.lock.current, false);
});

test("hands the accepted response to the caller for its own success message", async () => {
  // The booking check-in reads the response to say how many units went in.
  const received: unknown[] = [];

  const accepted = await submitFromSheet({
    lock: { current: false },
    request: async () => ({ data: { checkedInCount: 4 }, error: null }),
    onAccepted: (response) => received.push(response.data.checkedInCount),
    setSubmitting: () => {},
    showError: () => {},
  });

  assert.equal(accepted, true);
  assert.deepEqual(received, [4]);
});

test("skips the refetch when the caller reloads later", async () => {
  // The booking screen reloads only once its success alert is dismissed.
  const log: string[] = [];

  const accepted = await submitFromSheet({
    lock: { current: false },
    request: async () => ({ error: null }),
    onAccepted: () => log.push("close sheet"),
    setSubmitting: (submitting) =>
      log.push(submitting ? "submitting" : "settled"),
    showError: (message) => log.push(`alert: ${message}`),
  });

  assert.equal(accepted, true);
  assert.deepEqual(log, ["submitting", "close sheet", "settled"]);
});
