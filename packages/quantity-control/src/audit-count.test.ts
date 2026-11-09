/**
 * Tests for the audit count bound, the count prompt's expectation and the
 * value it opens with.
 *
 * @see ./audit-count.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countExpectation,
  countPromptDefault,
  MAX_AUDIT_COUNT,
} from "./audit-count";

test("MAX_AUDIT_COUNT: is the Postgres INTEGER ceiling", () => {
  assert.equal(MAX_AUDIT_COUNT, 2 ** 31 - 1);
});

test("countExpectation: a listed asset with units expected can be confirmed", () => {
  assert.equal(
    countExpectation({ isExpected: true, expectedQuantity: 14 }),
    "expected"
  );
});

test("countExpectation: a listed asset with nothing expected has nothing to confirm", () => {
  assert.equal(
    countExpectation({ isExpected: true, expectedQuantity: 0 }),
    "none-expected"
  );
});

test("countExpectation: an asset not on the list has no expectation", () => {
  assert.equal(
    countExpectation({ isExpected: false, expectedQuantity: 50 }),
    "unlisted"
  );
});

test("countPromptDefault: a recorded count wins, zero included", () => {
  assert.equal(
    countPromptDefault({
      isExpected: true,
      expectedQuantity: 14,
      foundQuantity: 0,
    }),
    0
  );
});

test("countPromptDefault: a listed pool with units expected opens at them", () => {
  assert.equal(
    countPromptDefault({
      isExpected: true,
      expectedQuantity: 14,
      foundQuantity: null,
    }),
    14
  );
});

test("countPromptDefault: nothing expected or not on the list opens blank", () => {
  assert.equal(
    countPromptDefault({
      isExpected: true,
      expectedQuantity: 0,
      foundQuantity: null,
    }),
    null
  );
  assert.equal(
    countPromptDefault({
      isExpected: false,
      expectedQuantity: 9,
      foundQuantity: null,
    }),
    null
  );
});
