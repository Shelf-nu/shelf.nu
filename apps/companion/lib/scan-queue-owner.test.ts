/**
 * Tests for audit scan queue ownership.
 *
 * @see ./scan-queue-owner.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveQueueAccess } from "./scan-queue-owner";

test("the first signed-in account becomes the owner", () => {
  assert.deepEqual(resolveQueueAccess(null, "user_a"), {
    owner: "user_a",
    maySave: true,
    mayUse: true,
  });
});

test("nothing is saved or sent while no account is known", () => {
  assert.deepEqual(resolveQueueAccess(null, undefined), {
    owner: null,
    maySave: false,
    mayUse: false,
  });
});

test("another account neither adds to nor submits the owner's queue", () => {
  assert.deepEqual(resolveQueueAccess("user_a", "user_b"), {
    owner: "user_a",
    maySave: true,
    mayUse: false,
  });
});

test("after sign-out the queue is still saved to its owner's draft", () => {
  assert.deepEqual(resolveQueueAccess("user_a", undefined), {
    owner: "user_a",
    maySave: true,
    mayUse: false,
  });
});
