/**
 * Tests for the booking source display parts and the one-line summary.
 *
 * @see ./source-display.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AS_PLANNED_SOURCE,
  asPlannedSourceLabel,
  describeBookingSources,
  describeSourceLine,
  formatSourceSummary,
} from "./source-display";

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

const part = (
  label: string,
  planned: number,
  kind: "LOCATION" | "UNPLACED" | "UNKNOWN" | "UNASSIGNED" = "LOCATION",
  short = false
) => ({
  key: `${kind}:${label}`,
  kind,
  locationId: kind === "LOCATION" ? label : null,
  label,
  planned,
  out: 0,
  short,
});

test("source line: one source reads as its label, several as the summary", () => {
  assert.deepEqual(describeSourceLine([part("Demo Warehouse", 8)]), {
    text: "Demo Warehouse",
    warnings: [],
  });
  assert.deepEqual(
    describeSourceLine([
      part("Demo Warehouse", 8),
      part("Unplaced", 7, "UNPLACED"),
    ]),
    { text: "Demo Warehouse 8 · Unplaced 7", warnings: [] }
  );
  assert.equal(describeSourceLine([]), null);
});

test("source line: short sources get a warning, Needs a location speaks for itself", () => {
  const line = describeSourceLine([
    part("Demo Warehouse", 8, "LOCATION", true),
    part("Needs a location", 2, "UNASSIGNED", true),
  ]);
  assert.deepEqual(line?.warnings, ["Short at Demo Warehouse"]);
});

test("as planned: the picker value and its label", () => {
  assert.equal(AS_PLANNED_SOURCE, "__allocation__");
  assert.equal(
    asPlannedSourceLabel("Demo Warehouse 8 · Unplaced 7"),
    "As planned: Demo Warehouse 8 · Unplaced 7"
  );
  assert.equal(asPlannedSourceLabel(undefined), "As planned");
  assert.equal(asPlannedSourceLabel(""), "As planned");
});
