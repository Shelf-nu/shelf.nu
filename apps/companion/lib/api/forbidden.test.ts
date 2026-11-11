/** Tests for the refused-response listeners the workspace context uses. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { notifyForbidden, onForbidden } from "./forbidden";

test("calls each listener once per refusal until it unsubscribes", () => {
  const calls: string[] = [];
  const offA = onForbidden(() => calls.push("a"));
  const offB = onForbidden(() => calls.push("b"));

  notifyForbidden();
  offA();
  notifyForbidden();
  offB();
  notifyForbidden();

  assert.deepEqual(calls, ["a", "b", "b"]);
});
