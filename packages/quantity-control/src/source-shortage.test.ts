/**
 * Tests for the short-slice sweep: units out are granted once, then pending
 * units by booking priority, per source, over time.
 *
 * @see ./source-shortage.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { computeShortSlices, type SourceHold } from "./source-shortage";

const d = (day: number) => new Date(Date.UTC(2026, 0, day));
const KEY = "LOCATION:A";

function hold(over: Partial<SourceHold> & { sliceId: string }): SourceHold {
  return {
    sourceKey: KEY,
    bookingId: over.sliceId,
    bookingFrom: d(1),
    bookingCreatedAt: d(1),
    from: d(1),
    to: d(10),
    out: 0,
    pending: 0,
    ...over,
  };
}

const cap = (n: number) => new Map([[KEY, n]]);
const none = new Map<string, number>();

test("section 11 example 1: out is granted first, nobody short", () => {
  const out = computeShortSlices({
    capacityBySource: cap(10),
    holds: [
      hold({ sliceId: "X", out: 4, pending: 2 }),
      hold({ sliceId: "Y", pending: 4, bookingFrom: d(2), from: d(2) }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, []);
});

test("section 11 example 2: only the later booking is short", () => {
  const out = computeShortSlices({
    capacityBySource: cap(10),
    holds: [
      hold({ sliceId: "late", pending: 6, bookingFrom: d(3), from: d(3) }),
      hold({ sliceId: "early", pending: 6 }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, [{ sliceId: "late", sourceKey: KEY, shortBy: 2 }]);
});

test("out is granted once across a window with several instants", () => {
  const out = computeShortSlices({
    capacityBySource: cap(10),
    holds: [
      hold({ sliceId: "X", out: 6, from: d(1), to: d(10) }),
      hold({
        sliceId: "Z",
        pending: 2,
        from: d(4),
        to: d(6),
        bookingFrom: d(4),
      }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, []);
});

test("ties on from break by createdAt then id", () => {
  const out = computeShortSlices({
    capacityBySource: cap(5),
    holds: [
      hold({
        sliceId: "b",
        bookingId: "b",
        pending: 4,
        bookingCreatedAt: d(2),
      }),
      hold({
        sliceId: "a",
        bookingId: "a",
        pending: 4,
        bookingCreatedAt: d(2),
      }),
      hold({
        sliceId: "c",
        bookingId: "c",
        pending: 4,
        bookingCreatedAt: d(1),
      }),
    ],
    unassignedPendingBySlice: none,
  });
  // c wins (oldest), a gets 1 (short 3), b gets 0 (short 4).
  assert.deepEqual(out, [
    { sliceId: "a", sourceKey: KEY, shortBy: 3 },
    { sliceId: "b", sourceKey: KEY, shortBy: 4 },
  ]);
});

test("UNASSIGNED pending is always short", () => {
  const out = computeShortSlices({
    capacityBySource: cap(100),
    holds: [],
    unassignedPendingBySlice: new Map([
      ["S1", 3],
      ["S2", 0],
    ]),
  });
  assert.deepEqual(out, [
    { sliceId: "S1", sourceKey: "UNASSIGNED:", shortBy: 3 },
  ]);
});

test("non-overlapping holds at capacity are not short", () => {
  const out = computeShortSlices({
    capacityBySource: cap(10),
    holds: [
      hold({ sliceId: "a", pending: 10, from: d(1), to: d(5) }),
      hold({
        sliceId: "b",
        pending: 10,
        from: d(6),
        to: d(9),
        bookingFrom: d(6),
      }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, []);
});

test("touching windows (to == from) do not overlap", () => {
  const out = computeShortSlices({
    capacityBySource: cap(10),
    holds: [
      hold({ sliceId: "a", pending: 10, from: d(1), to: d(5) }),
      hold({
        sliceId: "b",
        pending: 10,
        from: d(5),
        to: d(9),
        bookingFrom: d(5),
      }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, []);
});

test("shortBy is the max shortfall over time; sources are independent", () => {
  const out = computeShortSlices({
    capacityBySource: new Map([
      [KEY, 4],
      ["UNPLACED:", 1],
    ]),
    holds: [
      hold({ sliceId: "a", pending: 4, from: d(1), to: d(10) }),
      hold({
        sliceId: "b",
        pending: 1,
        from: d(2),
        to: d(4),
        bookingFrom: d(2),
      }),
      hold({
        sliceId: "b",
        sourceKey: "UNPLACED:",
        pending: 3,
        bookingFrom: d(2),
        from: d(2),
        to: d(4),
      }),
      hold({
        sliceId: "c",
        pending: 3,
        from: d(3),
        to: d(5),
        bookingFrom: d(3),
      }),
    ],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, [
    { sliceId: "b", sourceKey: KEY, shortBy: 1 },
    { sliceId: "b", sourceKey: "UNPLACED:", shortBy: 2 },
    { sliceId: "c", sourceKey: KEY, shortBy: 3 },
  ]);
});

test("a source with no capacity entry has capacity 0", () => {
  const out = computeShortSlices({
    capacityBySource: none,
    holds: [hold({ sliceId: "a", pending: 2 })],
    unassignedPendingBySlice: none,
  });
  assert.deepEqual(out, [{ sliceId: "a", sourceKey: KEY, shortBy: 2 }]);
});
