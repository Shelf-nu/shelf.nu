/**
 * Tests for the batch drawer's height cap and collapsed-header feedback.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./batch-drawer-layout.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addedFlashTitle,
  addedRows,
  batchDrawerMaxHeight,
  nextAddedFlash,
} from "./batch-drawer-layout";

// Scanner geometry, copied from app/(tabs)/scanner.tsx (FRAME_SIZE and the
// control row's 16pt offset above the frame); change both together.
// iPhone Duo closed: 678pt window, ~85pt tab bar, 240pt scan frame centred in
// the space above the tab bar, camera controls ending 16pt above the frame.
const DUO_CLOSED_HEIGHT = 678;
const TAB_BAR = 85;
const FRAME = 240;
const CONTROLS_GAP = 16;

test("tall phones keep the fixed caps", () => {
  assert.equal(batchDrawerMaxHeight(874, false), 280);
  assert.equal(batchDrawerMaxHeight(956, true), 400);
});

test("short windows cap the drawer at 45% of the height", () => {
  assert.equal(batchDrawerMaxHeight(DUO_CLOSED_HEIGHT, false), 280);
  assert.equal(batchDrawerMaxHeight(DUO_CLOSED_HEIGHT, true), 305);
  assert.equal(batchDrawerMaxHeight(568, false), 255);
});

/** Points between the camera controls' bottom and the tallest drawer's top. */
function clearance(windowHeight: number, cap: number) {
  const content = windowHeight - TAB_BAR;
  const controlsBottom = (content - FRAME) / 2 - CONTROLS_GAP;
  return content - cap - controlsBottom;
}

test("on the Duo closed the tallest drawer stops below the camera controls", () => {
  assert.ok(clearance(DUO_CLOSED_HEIGHT, batchDrawerMaxHeight(678, true)) > 0);
});

test("on a 568pt window only the window share keeps the controls clear", () => {
  // The fixed 400pt blocker cap alone would cover the controls here.
  assert.ok(clearance(568, 400) < 0);
  assert.ok(clearance(568, batchDrawerMaxHeight(568, true)) > 0);
});

test("addedRows returns only rows whose key is new, newest first", () => {
  const before = new Set(["a", "b"]);
  const next = [
    { key: "c", title: "Camera C" },
    { key: "a", title: "Camera A" },
    { key: "b", title: "Camera B" },
  ];
  assert.deepEqual(addedRows(before, next), [{ key: "c", title: "Camera C" }]);
});

test("a removal or a quantity edit adds nothing", () => {
  const before = new Set(["a", "b"]);
  assert.deepEqual(addedRows(before, [{ key: "a", title: "A" }]), []);
  // Same keys with changed values, as after a quantity edit.
  assert.deepEqual(
    addedRows(before, [
      { key: "a", title: "A (3 pcs)" },
      { key: "b", title: "B" },
    ]),
    []
  );
});

test("the flash names one added row, or counts a kit's rows", () => {
  assert.equal(
    addedFlashTitle("4 items scanned", [{ key: "q", title: "ZZX Fixture 14" }]),
    "4 items scanned · ZZX Fixture 14 added"
  );
  assert.equal(
    addedFlashTitle("6 units scanned", [
      { key: "1", title: "Lens 1" },
      { key: "2", title: "Lens 2" },
    ]),
    "6 units scanned · 2 items added"
  );
  assert.equal(addedFlashTitle("3 items scanned", []), "3 items scanned");
});

test("a scan while collapsed flashes and remembers the new key", () => {
  const next = nextAddedFlash({
    previousKeys: new Set(["a"]),
    rows: [
      { key: "z", title: "ZZX Fixture 14" },
      { key: "a", title: "A" },
    ],
    collapsed: true,
    title: "2 items scanned",
  });
  assert.equal(next.flash, "2 items scanned \u00b7 ZZX Fixture 14 added");
  assert.deepEqual([...next.keys].sort(), ["a", "z"]);
});

test("a scan while expanded does not flash, but its key moves on", () => {
  const next = nextAddedFlash({
    previousKeys: new Set(["a"]),
    rows: [
      { key: "z", title: "Z" },
      { key: "a", title: "A" },
    ],
    collapsed: false,
    title: "2 items scanned",
  });
  assert.equal(next.flash, null);
  // Collapsing later finds nothing new to announce.
  const later = nextAddedFlash({
    previousKeys: next.keys,
    rows: [
      { key: "z", title: "Z" },
      { key: "a", title: "A" },
    ],
    collapsed: true,
    title: "2 items scanned",
  });
  assert.equal(later.flash, null);
});

test("a removal while collapsed does not flash", () => {
  const next = nextAddedFlash({
    previousKeys: new Set(["a", "b"]),
    rows: [{ key: "a", title: "A" }],
    collapsed: true,
    title: "1 item scanned",
  });
  assert.equal(next.flash, null);
});
