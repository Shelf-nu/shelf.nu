/**
 * Tests for the availability primitives — the interval sweep, over-committed
 * window detection, OVERDUE sentinel resolution, and the signed availability
 * formula. Focuses on the end-exclusive ("bb1/bb2") convention that is the
 * whole reason these live in one shared primitive.
 *
 * @see ./availability.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTIVE_BOOKING_STATUSES,
  computeAvailability,
  FAR_FUTURE_SENTINEL,
  overCommittedWindows,
  peakConcurrent,
  RESERVATION_REDUCING_CATEGORIES,
  resolveIntervalTo,
} from "./availability";
import type { AvailabilityInterval } from "./types";

/** Terse Date builder — days from a fixed epoch, so intervals read clearly. */
const EPOCH = Date.UTC(2026, 0, 1);
const day = (n: number): Date => new Date(EPOCH + n * 86_400_000);
const iv = (from: number, to: number, qty: number): AvailabilityInterval => ({
  from: day(from),
  to: day(to),
  qty,
});

/* -------------------------------- constants ------------------------------- */

test("ACTIVE_BOOKING_STATUSES is exactly RESERVED/ONGOING/OVERDUE", () => {
  assert.deepEqual(
    [...ACTIVE_BOOKING_STATUSES],
    ["RESERVED", "ONGOING", "OVERDUE"]
  );
});

test("RESERVATION_REDUCING_CATEGORIES excludes CHECKOUT", () => {
  assert.deepEqual(
    [...RESERVATION_REDUCING_CATEGORIES],
    ["RETURN", "CONSUME", "LOSS", "DAMAGE"]
  );
  assert.ok(!RESERVATION_REDUCING_CATEGORIES.includes("CHECKOUT" as never));
});

/* ------------------------------ peakConcurrent ---------------------------- */

test("peakConcurrent: empty input is 0", () => {
  assert.equal(peakConcurrent([]), 0);
});

test("peakConcurrent: single interval is its own qty", () => {
  assert.equal(peakConcurrent([iv(0, 5, 3)]), 3);
});

test("peakConcurrent: bb1/bb2 non-overlapping bookings do NOT stack", () => {
  // Two bookings of 3 on disjoint date ranges — a naive sum would report 6,
  // but they never coexist, so the peak is 3.
  const peak = peakConcurrent([iv(0, 5, 3), iv(10, 15, 3)]);
  assert.equal(peak, 3);
});

test("peakConcurrent: back-to-back is end-exclusive (no phantom overlap)", () => {
  // Booking A ends exactly when B begins → they never overlap → peak 4, not 9.
  const peak = peakConcurrent([iv(0, 5, 4), iv(5, 10, 5)]);
  assert.equal(peak, 5);
});

test("peakConcurrent: genuinely overlapping bookings stack", () => {
  const peak = peakConcurrent([iv(0, 10, 3), iv(5, 15, 4)]);
  assert.equal(peak, 7);
});

test("peakConcurrent: triple overlap picks the max concurrent slice", () => {
  const peak = peakConcurrent([iv(0, 10, 2), iv(2, 8, 3), iv(4, 6, 5)]);
  // At [4,6): 2 + 3 + 5 = 10.
  assert.equal(peak, 10);
});

/* --------------------------- overCommittedWindows ------------------------- */

test("overCommittedWindows: none when demand never exceeds total", () => {
  assert.deepEqual(overCommittedWindows([iv(0, 5, 3), iv(10, 15, 3)], 3), []);
});

test("overCommittedWindows: reports the over range with its peak", () => {
  // Overlap [5,10) reaches 7 > total 5.
  const windows = overCommittedWindows([iv(0, 10, 3), iv(5, 15, 4)], 5);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].from.getTime(), day(5).getTime());
  assert.equal(windows[0].to.getTime(), day(10).getTime());
  assert.equal(windows[0].peak, 7);
});

test("overCommittedWindows: back-to-back over-committed spans merge", () => {
  // Each interval alone (qty 6) exceeds total 5; they touch at day 5, so the
  // level never dips back to <= total between them → one merged window.
  const windows = overCommittedWindows([iv(0, 5, 6), iv(5, 10, 6)], 5);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].from.getTime(), day(0).getTime());
  assert.equal(windows[0].to.getTime(), day(10).getTime());
  assert.equal(windows[0].peak, 6);
});

test("overCommittedWindows: 'at capacity' (== total) is NOT over-committed", () => {
  assert.deepEqual(overCommittedWindows([iv(0, 5, 5)], 5), []);
});

/* ----------------------------- resolveIntervalTo -------------------------- */

test("resolveIntervalTo: OVERDUE → far-future sentinel", () => {
  assert.equal(
    resolveIntervalTo("OVERDUE", day(3), day(10)).getTime(),
    FAR_FUTURE_SENTINEL.getTime()
  );
});

test("resolveIntervalTo: RESERVED/ONGOING keep their real `to`", () => {
  assert.equal(
    resolveIntervalTo("RESERVED", day(3), day(10)).getTime(),
    day(3).getTime()
  );
  assert.equal(
    resolveIntervalTo("ONGOING", day(4), day(10)).getTime(),
    day(4).getTime()
  );
});

test("resolveIntervalTo: falls back to windowTo when `to` is missing", () => {
  assert.equal(
    resolveIntervalTo("RESERVED", undefined, day(10)).getTime(),
    day(10).getTime()
  );
});

/* ---------------------------- computeAvailability ------------------------- */

test("computeAvailability: subtracts the right term for each headline", () => {
  const { physicalAvailable, bookable } = computeAvailability({
    total: 100,
    inCustody: 10,
    inKits: 5,
    reservedPeak: 20,
    checkedOut: 8,
  });
  // physicalAvailable = 100 - 10 - 5 - 8 = 77
  assert.equal(physicalAvailable, 77);
  // bookable = 100 - 10 - 5 - 20 = 65 (NOT double-subtracting checkedOut)
  assert.equal(bookable, 65);
});

test("computeAvailability: results are SIGNED (never clamped)", () => {
  const { physicalAvailable, bookable } = computeAvailability({
    total: 5,
    inCustody: 3,
    inKits: 2,
    reservedPeak: 6,
    checkedOut: 4,
  });
  // physicalAvailable = 5 - 3 - 2 - 4 = -4 (over-committed physically)
  assert.equal(physicalAvailable, -4);
  // bookable = 5 - 3 - 2 - 6 = -6 (over-committed for booking)
  assert.equal(bookable, -6);
});

test("computeAvailability: zero commitments → full total is bookable", () => {
  const { physicalAvailable, bookable } = computeAvailability({
    total: 42,
    inCustody: 0,
    inKits: 0,
    reservedPeak: 0,
    checkedOut: 0,
  });
  assert.equal(physicalAvailable, 42);
  assert.equal(bookable, 42);
});
