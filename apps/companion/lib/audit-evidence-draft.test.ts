/**
 * Tests for when the audit evidence sheet holds an unsent note or photo.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./audit-evidence-draft.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasUnsentEvidence } from "./audit-evidence-draft";

test("a typed note or a picked photo is unsent evidence", () => {
  assert.equal(hasUnsentEvidence("Scratch on lid", null), true);
  assert.equal(hasUnsentEvidence("", "file:///photo.jpg"), true);
  assert.equal(hasUnsentEvidence("Note", "file:///photo.jpg"), true);
});

test("an empty or blank note with no photo is nothing to lose", () => {
  assert.equal(hasUnsentEvidence("", null), false);
  assert.equal(hasUnsentEvidence("  \n ", null), false);
});
