/** Tests for the refused-response listeners the workspace context uses. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { notifyForbidden, onForbidden, recheckAfterRefusal } from "./forbidden";

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

test("a refusal of /me itself never sets off the re-check that reads /me", () => {
  assert.equal(recheckAfterRefusal("/api/mobile/me"), false);
  assert.equal(recheckAfterRefusal("/api/mobile/me?x=1"), false);
  assert.equal(recheckAfterRefusal("/api/mobile/dashboard?orgId=o"), true);
  // Only the exact path: a longer one is another route.
  assert.equal(recheckAfterRefusal("/api/mobile/me-something"), true);
});
