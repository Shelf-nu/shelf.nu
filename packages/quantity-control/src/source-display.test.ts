/**
 * Tests for the booking source display parts and the one-line summary.
 *
 * @see ./source-display.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { describeBookingSources, formatSourceSummary } from "./source-display";

const r = (
  kind: "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED" | "KIT",
  locationId: string | null,
  quantity: number,
  outQuantity = 0,
  releasedQuantity = 0
) => ({ kind, locationId, quantity, outQuantity, releasedQuantity });

const names = new Map([
  ["A", "Demo Warehouse"],
  ["B", "Annex"],
]);

test("KIT rows and rows with nothing planned or out are hidden", () => {
  const parts = describeBookingSources({
    rows: [
      r("KIT", null, 5),
      r("UNKNOWN", null, 0),
      r("LOCATION", "B", 4, 0, 4),
      r("LOCATION", "A", 8),
    ],
    locationNames: names,
    shortSourceKeys: new Set(),
  });
  assert.deepEqual(
    parts.map((p) => p.key),
    ["LOCATION:A"]
  );
});

test("labels, planned = quantity - released, out, order", () => {
  const parts = describeBookingSources({
    rows: [
      r("UNASSIGNED", null, 2),
      r("UNKNOWN", null, 3, 3),
      r("UNPLACED", null, 7, 2, 1),
      r("LOCATION", "B", 1),
      r("LOCATION", "A", 8),
    ],
    locationNames: names,
    shortSourceKeys: new Set(),
  });
  assert.deepEqual(
    parts.map((p) => [p.label, p.planned, p.out]),
    [
      ["Annex", 1, 0],
      ["Demo Warehouse", 8, 0],
      ["Unplaced", 6, 2],
      ["Unknown", 3, 3],
      ["Needs a location", 2, 0],
    ]
  );
  assert.equal(parts[0].locationId, "B");
  assert.equal(parts[2].kind, "UNPLACED");
});

test("unknown location name falls back", () => {
  const [p] = describeBookingSources({
    rows: [r("LOCATION", "Z", 1)],
    locationNames: names,
    shortSourceKeys: new Set(),
  });
  assert.equal(p.label, "Unknown location");
});

test("short comes from shortSourceKeys; UNASSIGNED pending is always short", () => {
  const parts = describeBookingSources({
    rows: [
      r("LOCATION", "A", 8),
      r("UNPLACED", null, 7),
      r("UNASSIGNED", null, 2),
      r("UNASSIGNED", null, 2, 0, 2),
    ],
    locationNames: names,
    shortSourceKeys: new Set(["LOCATION:A"]),
  });
  assert.deepEqual(
    parts.map((p) => [p.key, p.short]),
    [
      ["LOCATION:A", true],
      ["UNPLACED:", false],
      ["UNASSIGNED:", true],
    ]
  );
});

test("summary joins parts with a middle dot", () => {
  const parts = describeBookingSources({
    rows: [r("LOCATION", "A", 8), r("UNPLACED", null, 7)],
    locationNames: names,
    shortSourceKeys: new Set(),
  });
  assert.equal(formatSourceSummary(parts), "Demo Warehouse 8 · Unplaced 7");
  assert.equal(formatSourceSummary([]), "");
});
