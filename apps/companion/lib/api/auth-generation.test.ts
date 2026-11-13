/**
 * Tests for the auth generation counter.
 *
 * @see ./auth-generation.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createAuthGeneration } from "./auth-generation";

test("a token refresh for the same user keeps the generation", () => {
  const generation = createAuthGeneration();
  generation.observe("user_a");
  const before = generation.current();

  assert.equal(generation.observe("user_a"), false);
  assert.equal(generation.current(), before);
});

test("sign-out and a different user move the generation", () => {
  const generation = createAuthGeneration();
  generation.observe("user_a");

  assert.equal(generation.observe(null), true);
  assert.equal(generation.observe("user_b"), true);
  assert.equal(generation.current(), 2);
});

test("the first event is not a change", () => {
  const generation = createAuthGeneration();

  assert.equal(generation.observe("user_a"), false);
  assert.equal(generation.current(), 0);
});

test("bump moves it, and forgetUser makes the next event a first one", () => {
  const generation = createAuthGeneration();
  generation.observe("user_a");
  generation.bump();
  generation.forgetUser();

  assert.equal(generation.current(), 1);
  assert.equal(generation.observe("user_b"), false);
});
