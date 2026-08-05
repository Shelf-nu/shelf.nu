/**
 * Tests for the check-in disposition arithmetic — the ONE_WAY/TWO_WAY default
 * split, the claimed-sum vs pool-decrement distinction (returns stay in the
 * pool), and the over-claim cap.
 *
 * @see ./dispositions.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  capExceeded,
  defaultDisposition,
  poolDecrement,
  releaseCategory,
  sumDisposition,
} from "./dispositions";

/* ----------------------------- defaultDisposition ------------------------- */

test("defaultDisposition: ONE_WAY consumes the whole cap", () => {
  assert.deepEqual(defaultDisposition("ONE_WAY", 7), { consumed: 7 });
});

test("defaultDisposition: TWO_WAY returns the whole cap", () => {
  assert.deepEqual(defaultDisposition("TWO_WAY", 7), { returned: 7 });
});

/* ------------------------------ sumDisposition ---------------------------- */

test("sumDisposition: adds every category, treating missing as 0", () => {
  assert.equal(
    sumDisposition({ returned: 2, consumed: 3, lost: 1, damaged: 4 }),
    10
  );
  assert.equal(sumDisposition({ returned: 5 }), 5);
  assert.equal(sumDisposition({}), 0);
});

/* ------------------------------ poolDecrement ----------------------------- */

test("poolDecrement: excludes returns (they go back to the pool)", () => {
  // consumed + lost + damaged = 3 + 1 + 4 = 8; the 2 returned units don't count.
  assert.equal(
    poolDecrement({ returned: 2, consumed: 3, lost: 1, damaged: 4 }),
    8
  );
});

test("poolDecrement: a pure return decrements the pool by 0", () => {
  assert.equal(poolDecrement({ returned: 9 }), 0);
});

/* ------------------------------- capExceeded ------------------------------ */

test("capExceeded: true only when the claimed sum exceeds cap", () => {
  assert.equal(capExceeded({ consumed: 6 }, 5), true);
  assert.equal(capExceeded({ consumed: 5 }, 5), false); // exactly at cap
  assert.equal(capExceeded({ returned: 2, consumed: 2 }, 5), false);
});

test("capExceeded: the default disposition never exceeds its own cap", () => {
  assert.equal(capExceeded(defaultDisposition("ONE_WAY", 5), 5), false);
  assert.equal(capExceeded(defaultDisposition("TWO_WAY", 5), 5), false);
});

/* ----------------------------- releaseCategory ---------------------------- */

test("releaseCategory: a ONE_WAY consumable's units are used up", () => {
  assert.equal(releaseCategory("ONE_WAY"), "CONSUME");
});

test("releaseCategory: a TWO_WAY asset's units return to the pool", () => {
  assert.equal(releaseCategory("TWO_WAY"), "RETURN");
});

test("releaseCategory: legacy rows without a consumptionType are returnable", () => {
  // Rows created before the column existed must keep the pre-consumable
  // behaviour — silently consuming their stock would be a data-loss bug.
  assert.equal(releaseCategory(null), "RETURN");
  assert.equal(releaseCategory(undefined), "RETURN");
});

test("defaultDisposition agrees with releaseCategory for every consumption type", () => {
  // The two must never diverge: defaultDisposition is built on the predicate.
  assert.deepEqual(defaultDisposition("ONE_WAY", 3), { consumed: 3 });
  assert.equal(releaseCategory("ONE_WAY"), "CONSUME");
  assert.deepEqual(defaultDisposition("TWO_WAY", 3), { returned: 3 });
  assert.equal(releaseCategory("TWO_WAY"), "RETURN");
});
