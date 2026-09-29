/**
 * Tests for the stock-status classifier.
 *
 * The precedence order is the whole design, so most of these assert BOUNDARIES
 * and PRIORITY rather than happy paths: an over-committed pool is also empty, a
 * pool at exactly its floor is low, and a pool with no floor must never claim to
 * be fine. Two cases are pinned to real customer rows read from the live app on
 * 2026-08-17, those are the regressions that matter, because they are the ones
 * a human already looked at and disagreed with.
 *
 * `peakBooked` is an INPUT here: the sweep that produces it is tested with
 * `peakConcurrent` in availability.test.ts, and the SQL twin in the webapp.
 *
 * @see ./stock-status.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyStockStatus,
  committedUnits,
  isActionableStockStatus,
  shortfallUnits,
  STOCK_STATUSES,
  STOCK_STATUS_SEVERITY,
  type StockStatusInputs,
} from "./stock-status";

/** A pool with nothing claimed and no floor, override one field per case. */
function pool(over: Partial<StockStatusInputs> = {}): StockStatusInputs {
  return {
    total: 10,
    available: 10,
    peakBooked: 0,
    inCustody: 0,
    inKits: 0,
    minQuantity: null,
    ...over,
  };
}

/* ------------------------------ real rows -------------------------------- */

test("Valve Head - 48k System: 4 available against a floor of 5 is LOW", () => {
  assert.equal(
    classifyStockStatus(pool({ total: 4, available: 4, minQuantity: 5 })),
    "LOW"
  );
});

test("48k Grain Softener tank: 14 available of 15, one in custody, floor 5 is ENOUGH", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 15, available: 14, inCustody: 1, minQuantity: 5 })
    ),
    "ENOUGH"
  );
});

/* ------------------------------- precedence ------------------------------ */

test("SHORT wins over NONE_FREE when the booking peak exceeds the pool", () => {
  const s = classifyStockStatus(
    pool({ total: 6, available: 0, peakBooked: 8 })
  );
  assert.equal(s, "SHORT");
});

test("SHORT fires with no threshold set, it is an integrity problem, not a level", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 5, available: 5, peakBooked: 6, minQuantity: null })
    ),
    "SHORT"
  );
});

test("SHORT counts custody and kits alongside the booking peak", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 10, available: 1, inCustody: 4, inKits: 3, peakBooked: 4 })
    ),
    "SHORT"
  );
});

test("commitments equal to the total are NOT short", () => {
  assert.equal(
    classifyStockStatus(pool({ total: 10, available: 0, peakBooked: 10 })),
    "NONE_FREE"
  );
});

test("NONE_FREE wins over LOW when nothing is free", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 10, available: 0, peakBooked: 10, minQuantity: 3 })
    ),
    "NONE_FREE"
  );
});

test("negative available is NONE_FREE, not a crash or a low reading", () => {
  assert.equal(
    classifyStockStatus(pool({ total: 10, available: -2, minQuantity: 3 })),
    "NONE_FREE"
  );
});

/* -------------------------------- threshold ------------------------------ */

test("available exactly at the floor is LOW", () => {
  assert.equal(
    classifyStockStatus(pool({ available: 5, minQuantity: 5 })),
    "LOW"
  );
});

test("one unit above the floor is ENOUGH", () => {
  assert.equal(
    classifyStockStatus(pool({ available: 6, minQuantity: 5 })),
    "ENOUGH"
  );
});

test("a floor of 0 is valid and does not make a stocked pool low", () => {
  assert.equal(
    classifyStockStatus(pool({ available: 4, minQuantity: 0 })),
    "ENOUGH"
  );
});

test("no floor set is NO_THRESHOLD, never ENOUGH", () => {
  assert.equal(
    classifyStockStatus(pool({ available: 10, minQuantity: null })),
    "NO_THRESHOLD"
  );
  assert.equal(
    classifyStockStatus(
      pool({ available: 1, minQuantity: undefined as never })
    ),
    "NO_THRESHOLD"
  );
});

test("no floor still yields NONE_FREE when the pool is empty", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 4, available: 0, peakBooked: 4, minQuantity: null })
    ),
    "NONE_FREE"
  );
});

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

/* ------------------------------- actionable ------------------------------ */

test("only SHORT, NONE_FREE and LOW are actionable", () => {
  assert.equal(isActionableStockStatus("SHORT"), true);
  assert.equal(isActionableStockStatus("NONE_FREE"), true);
  assert.equal(isActionableStockStatus("LOW"), true);
  assert.equal(isActionableStockStatus("ENOUGH"), false);
  assert.equal(isActionableStockStatus(null), false);
});

test("NO_THRESHOLD is not actionable", () => {
  assert.equal(isActionableStockStatus("NO_THRESHOLD"), false);
});

/* ----------------------- the time-frame false alarms ---------------------- */

test("a pool that is out today and booked again after it returns is not SHORT", () => {
  // 8 of 10 out this week (available 2), 5 reserved next month. The two
  // bookings never overlap, so the peak is 8, not 13: the booking engine
  // accepts the second booking, and so must this verdict.
  assert.equal(
    classifyStockStatus(pool({ total: 10, available: 2, peakBooked: 8 })),
    "NO_THRESHOLD"
  );
});

test("two overlapping bookings that only exceed the pool together are SHORT", () => {
  // Two bookings of 6 on the same dates peak at 12 from a pool of 10. The
  // largest-booking reading (6) would have said nothing was wrong.
  assert.equal(
    classifyStockStatus(pool({ total: 10, available: 10, peakBooked: 12 })),
    "SHORT"
  );
});

test("a kit's units count once, under inKits, never again as custody or bookings", () => {
  // 10 units in a kit, the kit reserved for 10: the caller passes inKits 10
  // and peakBooked 0 (kit slices are excluded from the sweep). Not short.
  assert.equal(
    classifyStockStatus(pool({ total: 29, available: 19, inKits: 10 })),
    "NO_THRESHOLD"
  );
});
