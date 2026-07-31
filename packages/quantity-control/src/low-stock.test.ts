/**
 * Tests for the low-stock threshold predicates — the "no threshold set"
 * short-circuit and, crucially, the above→below-only debounce that keeps the
 * alert from re-firing on every decrement while already low.
 *
 * @see ./low-stock.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { crossedLowStockThreshold, isLowStock } from "./low-stock.js";

/* -------------------------------- isLowStock ------------------------------ */

test("isLowStock: available at or below threshold is low", () => {
  assert.equal(isLowStock({ available: 5, minQuantity: 5 }), true);
  assert.equal(isLowStock({ available: 3, minQuantity: 5 }), true);
});

test("isLowStock: available above threshold is not low", () => {
  assert.equal(isLowStock({ available: 6, minQuantity: 5 }), false);
});

test("isLowStock: no threshold (null or <= 0) is never low", () => {
  assert.equal(isLowStock({ available: 0, minQuantity: null }), false);
  assert.equal(isLowStock({ available: 0, minQuantity: 0 }), false);
  assert.equal(isLowStock({ available: -1, minQuantity: -3 }), false);
});

/* ------------------------- crossedLowStockThreshold ----------------------- */

test("crossedLowStockThreshold: fires only on above→below crossing", () => {
  assert.equal(
    crossedLowStockThreshold({ before: 6, after: 5, minQuantity: 5 }),
    true
  );
  assert.equal(
    crossedLowStockThreshold({ before: 10, after: 2, minQuantity: 5 }),
    true
  );
});

test("crossedLowStockThreshold: does NOT re-fire while already below (debounce)", () => {
  // Was already at/below threshold before the change → no fresh crossing.
  assert.equal(
    crossedLowStockThreshold({ before: 5, after: 3, minQuantity: 5 }),
    false
  );
  assert.equal(
    crossedLowStockThreshold({ before: 4, after: 4, minQuantity: 5 }),
    false
  );
});

test("crossedLowStockThreshold: does NOT fire on a recovery (below→above)", () => {
  assert.equal(
    crossedLowStockThreshold({ before: 2, after: 8, minQuantity: 5 }),
    false
  );
});

test("crossedLowStockThreshold: does NOT fire when staying above", () => {
  assert.equal(
    crossedLowStockThreshold({ before: 10, after: 8, minQuantity: 5 }),
    false
  );
});

test("crossedLowStockThreshold: no threshold (null or <= 0) never fires", () => {
  assert.equal(
    crossedLowStockThreshold({ before: 10, after: 0, minQuantity: null }),
    false
  );
  assert.equal(
    crossedLowStockThreshold({ before: 10, after: 0, minQuantity: 0 }),
    false
  );
});
