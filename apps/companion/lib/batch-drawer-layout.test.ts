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
} from "./batch-drawer-layout";

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

test("on the Duo closed the tallest drawer stops below the camera controls", () => {
  const content = DUO_CLOSED_HEIGHT - TAB_BAR;
  const controlsBottom = (content - FRAME) / 2 - CONTROLS_GAP;
  const drawerTop = content - batchDrawerMaxHeight(DUO_CLOSED_HEIGHT, true);
  assert.ok(
    drawerTop > controlsBottom,
    `drawer top ${drawerTop} must sit below controls bottom ${controlsBottom}`
  );
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
