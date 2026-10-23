/**
 * Tests for the pure quantity guards — directional availability verdicts, the
 * aggregated multi-asset check, the stock-lowering verdict, and the honest
 * cause/cure copy. Asserts the DECISIONS (ok / not-ok + shortfall), not the
 * exact prose, except where the message must name the shortfall.
 *
 * @see ./guards.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInsufficientStockMessage,
  checkQuantitiesAvailable,
  checkQuantityAvailable,
  checkQuantityNotBelowCommitted,
  describeOverCommitment,
} from "./guards";

/* ------------------------- checkQuantityAvailable ------------------------- */

test("checkQuantityAvailable: a reduction always passes (#2725 recovery)", () => {
  // Even against a negative (already over-committed) bookable, dropping the
  // request below the current quantity must be allowed.
  const verdict = checkQuantityAvailable({
    requestedQuantity: 3,
    currentQuantity: 8,
    bookable: -5,
  });
  assert.deepEqual(verdict, { ok: true });
});

test("checkQuantityAvailable: a no-op (request == current) passes", () => {
  assert.deepEqual(
    checkQuantityAvailable({
      requestedQuantity: 5,
      currentQuantity: 5,
      bookable: 0,
    }),
    { ok: true }
  );
});

test("checkQuantityAvailable: an increase within bookable passes", () => {
  assert.deepEqual(
    checkQuantityAvailable({
      requestedQuantity: 7,
      currentQuantity: 2,
      bookable: 10,
    }),
    { ok: true }
  );
});

test("checkQuantityAvailable: an increase exceeding bookable fails with shortfall", () => {
  const verdict = checkQuantityAvailable({
    requestedQuantity: 12,
    currentQuantity: 2,
    bookable: 8,
    assetTitle: "Boards",
    unitOfMeasure: "boards",
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    // requested 12 vs available max(0,8)=8 → short by 4.
    assert.equal(verdict.shortfall, 4);
    assert.match(verdict.message, /Boards/);
    assert.match(verdict.message, /8 boards/);
  }
});

test("checkQuantityAvailable: new booking (no currentQuantity) is checked absolutely", () => {
  const verdict = checkQuantityAvailable({
    requestedQuantity: 4,
    bookable: 1,
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    // available clamps negative-safe: max(0,1)=1 → short by 3.
    assert.equal(verdict.shortfall, 3);
  }
});

test("checkQuantityAvailable: negative bookable clamps available to 0 in the shortfall", () => {
  const verdict = checkQuantityAvailable({
    requestedQuantity: 2,
    currentQuantity: 0,
    bookable: -3,
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.shortfall, 2);
});

/* ------------------------ checkQuantitiesAvailable ------------------------ */

test("checkQuantitiesAvailable: all fit → ok, no message, empty shortfalls", () => {
  const result = checkQuantitiesAvailable([
    { requestedQuantity: 3, currentQuantity: 0, bookable: 5 },
    { requestedQuantity: 1, currentQuantity: 4, bookable: 0 }, // reduction
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.message, undefined);
  assert.deepEqual(result.shortfalls, []);
});

test("checkQuantitiesAvailable: aggregates only the failing items", () => {
  const result = checkQuantitiesAvailable([
    { requestedQuantity: 10, currentQuantity: 0, bookable: 4, assetTitle: "A" },
    { requestedQuantity: 2, currentQuantity: 0, bookable: 9, assetTitle: "B" },
    { requestedQuantity: 6, currentQuantity: 0, bookable: 1, assetTitle: "C" },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.shortfalls.length, 2);
  assert.deepEqual(
    result.shortfalls.map((s) => s.assetTitle),
    ["A", "C"]
  );
  // A: short by 10-4=6; C: short by 6-1=5.
  assert.deepEqual(
    result.shortfalls.map((s) => s.shortfall),
    [6, 5]
  );
  assert.match(result.message ?? "", /"A"/);
  assert.match(result.message ?? "", /"C"/);
  assert.doesNotMatch(result.message ?? "", /"B"/);
});

test("checkQuantitiesAvailable: empty input is a no-op ok", () => {
  assert.deepEqual(checkQuantitiesAvailable([]), { ok: true, shortfalls: [] });
});

/* --------------------- checkQuantityNotBelowCommitted --------------------- */

test("checkQuantityNotBelowCommitted: newTotal above committed passes", () => {
  assert.deepEqual(
    checkQuantityNotBelowCommitted({ newTotal: 10, committed: 6 }),
    { ok: true }
  );
});

test("checkQuantityNotBelowCommitted: newTotal EXACTLY committed passes", () => {
  assert.deepEqual(
    checkQuantityNotBelowCommitted({ newTotal: 6, committed: 6 }),
    { ok: true }
  );
});

test("checkQuantityNotBelowCommitted: below committed fails with shortfall", () => {
  const verdict = checkQuantityNotBelowCommitted({
    newTotal: 4,
    committed: 9,
    assetTitle: "Pens",
    unitOfMeasure: "pens",
  });
  assert.equal(verdict.ok, false);
  if (!verdict.ok) {
    assert.equal(verdict.shortfall, 5);
    assert.match(verdict.message, /Pens/);
    assert.match(verdict.message, /9 pens/);
  }
});

/* ---------------------- buildInsufficientStockMessage --------------------- */

test("buildInsufficientStockMessage: clamps negative bookable to 0", () => {
  const msg = buildInsufficientStockMessage({
    requested: 5,
    bookable: -2,
    unitOfMeasure: "kg",
  });
  assert.match(msg, /Only 0 kg available/);
  assert.match(msg, /requested 5/);
});

test("buildInsufficientStockMessage: defaults unit to 'units'", () => {
  const msg = buildInsufficientStockMessage({ requested: 3, bookable: 1 });
  assert.match(msg, /1 units available/);
});

/* -------------------------- describeOverCommitment ------------------------ */

test("describeOverCommitment: lists every non-zero driver + a cure", () => {
  const { drivers, cures, text } = describeOverCommitment({
    total: 10,
    inCustody: 4,
    inKits: 3,
    reservedPeak: 8,
    checkedOut: 2,
    assetTitle: "Drills",
    unitOfMeasure: "drills",
  });
  // bookable = 10 - 4 - 3 - 8 = -5 → over-committed by 5.
  assert.equal(drivers.length, 4);
  assert.ok(drivers.some((d) => /custody/.test(d)));
  assert.ok(drivers.some((d) => /kits/.test(d)));
  assert.ok(drivers.some((d) => /overlapping bookings/.test(d)));
  assert.ok(drivers.some((d) => /checked out/.test(d)));
  // A cure to add stock names the exact shortfall.
  assert.ok(cures.some((c) => /at least 5 drills/.test(c)));
  assert.match(text, /over-committed by 5 drills/);
});

test("describeOverCommitment: within capacity → no cures, truthful summary", () => {
  const { drivers, cures, text } = describeOverCommitment({
    total: 20,
    inCustody: 2,
    inKits: 0,
    reservedPeak: 5,
    checkedOut: 1,
  });
  // bookable = 20 - 2 - 0 - 5 = 13 (>= 0).
  assert.deepEqual(cures, []);
  assert.match(text, /within capacity/);
  assert.match(text, /13 of 20/);
  // custody + reservedPeak + checkedOut are drivers even when within capacity.
  assert.ok(drivers.length >= 1);
});
