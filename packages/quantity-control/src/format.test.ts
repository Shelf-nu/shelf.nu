/**
 * Tests for the unit-count formatter — the unit label and its "units" default.
 *
 * @see ./format.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formatUnitCount } from "./format";

test("formatUnitCount: uses the supplied unit of measure", () => {
  assert.equal(formatUnitCount(10, "boxes"), "10 boxes");
});

test("formatUnitCount: defaults to 'units' when unit is missing/blank", () => {
  assert.equal(formatUnitCount(10), "10 units");
  assert.equal(formatUnitCount(10, null), "10 units");
  assert.equal(formatUnitCount(10, ""), "10 units");
  assert.equal(formatUnitCount(10, "   "), "10 units");
});

test("formatUnitCount: renders zero and singular counts verbatim", () => {
  assert.equal(formatUnitCount(0, "kg"), "0 kg");
  assert.equal(formatUnitCount(1, "pcs"), "1 pcs");
});
