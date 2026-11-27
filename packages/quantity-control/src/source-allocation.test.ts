/**
 * Tests for the source allocation rule (unplaced first when it fits alone,
 * then the oldest fitting location, then a split, else refusal).
 *
 * @see ./source-allocation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allocateSources,
  allocateSourcesOrUnassigned,
  type SourceFree,
} from "./source-allocation";

const unplaced = (free: number): SourceFree => ({
  kind: "UNPLACED",
  locationId: null,
  free,
  createdOrder: 0,
});
const loc = (id: string, free: number, createdOrder: number): SourceFree => ({
  kind: "LOCATION",
  locationId: id,
  free,
  createdOrder,
});

test("unplaced alone fits: all from unplaced", () => {
  assert.deepEqual(
    allocateSources({ quantity: 5, sources: [loc("A", 9, 1), unplaced(8)] }),
    { ok: true, parts: [{ kind: "UNPLACED", locationId: null, quantity: 5 }] }
  );
});

test("first location in creation order that fits", () => {
  assert.deepEqual(
    allocateSources({
      quantity: 5,
      sources: [loc("B", 9, 2), unplaced(2), loc("A", 6, 1)],
    }),
    { ok: true, parts: [{ kind: "LOCATION", locationId: "A", quantity: 5 }] }
  );
});

test("split: unplaced first, then most free", () => {
  assert.deepEqual(
    allocateSources({
      quantity: 12,
      sources: [unplaced(3), loc("A", 4, 1), loc("B", 6, 2)],
    }),
    {
      ok: true,
      parts: [
        { kind: "UNPLACED", locationId: null, quantity: 3 },
        { kind: "LOCATION", locationId: "B", quantity: 6 },
        { kind: "LOCATION", locationId: "A", quantity: 3 },
      ],
    }
  );
});

test("split ties on free go to the older location", () => {
  const result = allocateSources({
    quantity: 7,
    sources: [loc("B", 4, 2), loc("A", 4, 1)],
  });
  assert.deepEqual(result, {
    ok: true,
    parts: [
      { kind: "LOCATION", locationId: "A", quantity: 4 },
      { kind: "LOCATION", locationId: "B", quantity: 3 },
    ],
  });
});

test("refuses with every source's free when total is short", () => {
  const sources = [unplaced(2), loc("A", 3, 1), loc("B", 2, 2)];
  assert.deepEqual(allocateSources({ quantity: 8, sources }), {
    ok: false,
    freeBySource: sources,
  });
});

test("negative free counts as 0", () => {
  const result = allocateSources({
    quantity: 3,
    sources: [unplaced(-4), loc("A", 3, 1)],
  });
  assert.deepEqual(result, {
    ok: true,
    parts: [{ kind: "LOCATION", locationId: "A", quantity: 3 }],
  });
});

test("zero quantity allocates nothing", () => {
  assert.deepEqual(allocateSources({ quantity: 0, sources: [unplaced(1)] }), {
    ok: true,
    parts: [],
  });
});

test("involuntary: never refuses, rest goes to unassigned", () => {
  assert.deepEqual(
    allocateSourcesOrUnassigned({
      quantity: 8,
      sources: [unplaced(3), loc("A", 4, 1)],
    }),
    {
      parts: [
        { kind: "UNPLACED", locationId: null, quantity: 3 },
        { kind: "LOCATION", locationId: "A", quantity: 4 },
      ],
      unassigned: 1,
    }
  );
  assert.deepEqual(
    allocateSourcesOrUnassigned({ quantity: 2, sources: [unplaced(5)] }),
    {
      parts: [{ kind: "UNPLACED", locationId: null, quantity: 2 }],
      unassigned: 0,
    }
  );
  assert.deepEqual(allocateSourcesOrUnassigned({ quantity: 4, sources: [] }), {
    parts: [],
    unassigned: 4,
  });
});
