/**
 * Tests for the audit count bound and the count prompt's expectation.
 *
 * @see ./audit-count.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { countExpectation, MAX_AUDIT_COUNT } from "./audit-count";

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
