/**
 * Tests for the stock-status classifier.
 *
 * The precedence order is the whole design, so most of these assert BOUNDARIES
 * and PRIORITY rather than happy paths: an over-committed pool is also empty, a
 * pool at exactly its floor is low, and a pool with no floor must never claim to
 * be fine. Two cases are pinned to real customer rows read from the live app on
 * 2026-08-17 — those are the regressions that matter, because they are the ones
 * a human already looked at and disagreed with.
 *
 * @see ./stock-status.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyStockStatus,
  committedUnits,
  isActionableStockStatus,
  STOCK_STATUSES,
  STOCK_STATUS_SEVERITY,
  type StockStatusInputs,
} from "./stock-status";

/** A pool with nothing claimed and no floor — override one field per case. */
function pool(over: Partial<StockStatusInputs> = {}): StockStatusInputs {
  return {
    total: 10,
    available: 10,
    largestUpcomingBooking: 0,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    minQuantity: null,
    ...over,
  };
}

/* ------------------------------ real rows -------------------------------- */

test("Valve Head - 48k System: 4 available against a floor of 5 is LOW", () => {
  // why: the live row that started this work. It renders a green "Available"
  // badge in the index today while sitting under its own reorder point.
  assert.equal(
    classifyStockStatus(pool({ total: 4, available: 4, minQuantity: 5 })),
    "LOW"
  );
});

test("48k Grain Softener tank: 14 available of 15, one in custody, floor 5 is ENOUGH", () => {
  // why: the row a customer read as "15" in the list and "14" on the asset
  // page. Custody must not drag a healthy pool into a warning.
  assert.equal(
    classifyStockStatus(
      pool({ total: 15, available: 14, inCustody: 1, minQuantity: 5 })
    ),
    "ENOUGH"
  );
});

/* ------------------------------- precedence ------------------------------ */

test("SHORT wins over NONE_FREE when commitments exceed the pool", () => {
  // 6 owned, 8 promised: available is also 0, but "you promised more than you
  // own" is the actionable half.
  const s = classifyStockStatus(
    pool({ total: 6, available: 0, largestUpcomingBooking: 8 })
  );
  assert.equal(s, "SHORT");
});

test("SHORT fires with no threshold set — it is an integrity problem, not a level", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 5, available: 5, checkedOut: 6, minQuantity: null })
    ),
    "SHORT"
  );
});

test("SHORT counts every kind of claim, not just reservations", () => {
  assert.equal(
    classifyStockStatus(
      pool({
        total: 10,
        available: 0,
        inCustody: 4,
        inKits: 3,
        checkedOut: 2,
        largestUpcomingBooking: 2,
      })
    ),
    "SHORT"
  );
});

test("commitments equal to the total are NOT short", () => {
  // Boundary: fully allocated is at capacity, not over it.
  assert.equal(
    classifyStockStatus(pool({ total: 10, available: 0, checkedOut: 10 })),
    "NONE_FREE"
  );
});

test("NONE_FREE wins over LOW when nothing is free", () => {
  assert.equal(
    classifyStockStatus(
      pool({ total: 10, available: 0, checkedOut: 10, minQuantity: 3 })
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
  // Mirrors isLowStock: only null disables the threshold.
  assert.equal(
    classifyStockStatus(pool({ available: 4, minQuantity: 0 })),
    "ENOUGH"
  );
});

test("no floor set is NO_THRESHOLD, never ENOUGH", () => {
  // why: this is the majority state in real workspaces. Reporting "fine" here
  // would be a confident claim about a line nobody drew.
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
  // Absence of a threshold must not suppress a fact we can state without one.
  assert.equal(
    classifyStockStatus(
      pool({ total: 4, available: 0, checkedOut: 4, minQuantity: null })
    ),
    "NONE_FREE"
  );
});

/* ------------------------------ committedUnits ---------------------------- */

test("committedUnits sums every claim on the pool", () => {
  assert.equal(
    committedUnits({
      largestUpcomingBooking: 1,
      inCustody: 2,
      inKits: 3,
      checkedOut: 4,
    }),
    10
  );
});

/* -------------------------------- severity ------------------------------- */

test("severity ranks worst first and covers every status exactly once", () => {
  const ranks = STOCK_STATUSES.map((s) => STOCK_STATUS_SEVERITY[s]);
  assert.deepEqual(ranks, [0, 1, 2, 3, 4]);
  assert.equal(new Set(ranks).size, STOCK_STATUSES.length);
});

test("severity puts NO_THRESHOLD last, below ENOUGH", () => {
  // why: absence of an opinion is not a healthy reading, and a stock account
  // sorting worst-first should not see its unconfigured rows above its fine ones.
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
  // why: for an equipment rental workspace this is the correct and permanent
  // state. Treating it as a problem would nag that whole cohort forever.
  assert.equal(isActionableStockStatus("NO_THRESHOLD"), false);
});

/* --------------------- the non-overlap false alarm --------------------- */

test("two non-overlapping bookings do not make a returnable pool SHORT", () => {
  // why: this is the regression the input rename exists for. Eight tripods on
  // Monday and eight on Friday, from a pool of ten, SUM to sixteen — the naive
  // figure would report SHORT even though peak demand is only eight. Passing
  // the largest single booking instead can never raise that false alarm.
  assert.equal(
    classifyStockStatus(
      pool({ total: 10, available: 10, largestUpcomingBooking: 8 })
    ),
    "NO_THRESHOLD"
  );
});

test("one booking asking for more than the pool is still SHORT", () => {
  // why: the conservative stand-in must keep catching the case that matters —
  // otherwise it trades a false alarm for a missed one.
  assert.equal(
    classifyStockStatus(
      pool({ total: 10, available: 10, largestUpcomingBooking: 12 })
    ),
    "SHORT"
  );
});
