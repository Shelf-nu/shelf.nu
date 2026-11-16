/**
 * Tests for the edit asset form's leave guard.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./edit-leave-guard.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { editLeaveGuard } from "./edit-leave-guard";

test("a clean form leaves without a prompt", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: false, didSave: false, isSubmitting: false }),
    { hold: false, prompt: false }
  );
});

test("a dirty form asks before discarding", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: true, didSave: false, isSubmitting: false }),
    { hold: true, prompt: true }
  );
});

test("a dirty form with a save in flight holds without asking", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: true, didSave: false, isSubmitting: true }),
    { hold: true, prompt: false }
  );
});

test("a save in flight holds even after the edits are put back", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: false, didSave: false, isSubmitting: true }),
    { hold: true, prompt: false }
  );
});

test("a second save after a successful one still holds", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: true, didSave: true, isSubmitting: true }),
    { hold: true, prompt: false }
  );
});

test("after a save the form leaves freely although it still differs", () => {
  assert.deepEqual(
    editLeaveGuard({ isDirty: true, didSave: true, isSubmitting: false }),
    { hold: false, prompt: false }
  );
});
