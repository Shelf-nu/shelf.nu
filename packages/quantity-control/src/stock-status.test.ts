/**
 * Tests for the stock-status vocabulary and shortfall arithmetic.
 *
 * The verdict precedence is computed in SQL and pinned in the webapp's
 * `query.server.test.ts`. `peakBooked` is an INPUT here: the sweep that
 * produces it is tested with `peakConcurrent` in availability.test.ts.
 *
 * @see ./stock-status.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  committedUnits,
  shortfallUnits,
  STOCK_STATUSES,
  STOCK_STATUS_SEVERITY,
} from "./stock-status";

/* ------------------------------ committedUnits ---------------------------- */

test("committedUnits is custody plus kits plus the booking peak", () => {
  assert.equal(committedUnits({ peakBooked: 1, inCustody: 2, inKits: 3 }), 6);
});

test("shortfallUnits is what is committed beyond what is owned", () => {
  // 12 booked at the busiest point against 10 owned: short by 2.
  assert.equal(
    shortfallUnits({ total: 10, peakBooked: 12, inCustody: 0, inKits: 0 }),
    2
  );
  // Custody and kits count too: 5 + 3 + 4 = 12 against 10.
  assert.equal(
    shortfallUnits({ total: 10, peakBooked: 4, inCustody: 5, inKits: 3 }),
    2
  );
});

test("shortfallUnits is 0 for a pool that is not short", () => {
  assert.equal(
    shortfallUnits({ total: 10, peakBooked: 10, inCustody: 0, inKits: 0 }),
    0
  );
  assert.equal(
    shortfallUnits({ total: 10, peakBooked: 1, inCustody: 0, inKits: 0 }),
    0
  );
});

/* -------------------------------- severity ------------------------------- */

test("severity ranks worst first and covers every status exactly once", () => {
  const ranks = STOCK_STATUSES.map((s) => STOCK_STATUS_SEVERITY[s]);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  assert.equal(new Set(ranks).size, STOCK_STATUSES.length);
});

test("severity puts NO_THRESHOLD last, below ENOUGH", () => {
  assert.ok(STOCK_STATUS_SEVERITY.NO_THRESHOLD > STOCK_STATUS_SEVERITY.ENOUGH);
  assert.ok(STOCK_STATUS_SEVERITY.SHORT < STOCK_STATUS_SEVERITY.NONE_FREE);
  assert.ok(STOCK_STATUS_SEVERITY.NONE_FREE < STOCK_STATUS_SEVERITY.LOW);
});
