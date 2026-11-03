/**
 * Tests for the safe-area maths in `safe-edges.ts`: which insets a tab screen
 * meets beside the tab bar or sidebar, the overlay top offset, sheet centring
 * between asymmetric side insets, and the scanner's camera and list split.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  centredSheetSpan,
  overlayTopOffset,
  scanSplit,
  tabScreenInsets,
} from "./safe-edges";

/** iPhone Duo inner display open sideways, status-bar rail on the left. */
const DUO_RAIL_LEFT = { top: 0, right: 0, bottom: 20, left: 84 };
/** The same with the rail on the right. */
const DUO_RAIL_RIGHT = { top: 0, right: 84, bottom: 20, left: 0 };

describe("tabScreenInsets", () => {
  it("leaves the left rail to the sidebar on a wide window", () => {
    assert.deepEqual(tabScreenInsets(DUO_RAIL_LEFT, 951), {
      top: 0,
      right: 0,
      bottom: 20,
      left: 0,
    });
  });

  it("keeps a right rail, which the sidebar does not reach", () => {
    assert.deepEqual(tabScreenInsets(DUO_RAIL_RIGHT, 951), {
      top: 0,
      right: 84,
      bottom: 20,
      left: 0,
    });
  });

  it("keeps both side insets above a bottom tab bar, which takes the bottom", () => {
    // Duo Split View: a 469-wide window with the rail on its left edge.
    assert.deepEqual(tabScreenInsets(DUO_RAIL_LEFT, 469), {
      top: 0,
      right: 0,
      bottom: 0,
      left: 84,
    });
  });

  it("never swaps one side's inset for the other's", () => {
    const fold = { top: 24, right: 0, bottom: 0, left: 31 };
    assert.equal(tabScreenInsets(fold, 883).left, 31);
    assert.equal(tabScreenInsets(fold, 883).right, 0);
  });
});

describe("overlayTopOffset", () => {
  it("keeps the phone offset when the status bar is shorter", () => {
    assert.equal(overlayTopOffset(0, 60), 60);
    assert.equal(overlayTopOffset(24, 40), 40);
  });

  it("moves below a status bar or camera cutout taller than the offset", () => {
    assert.equal(overlayTopOffset(62, 60), 62);
    assert.equal(overlayTopOffset(48, 40), 48);
  });
});

describe("centredSheetSpan", () => {
  it("fills a phone edge to edge", () => {
    assert.deepEqual(centredSheetSpan(390, 720, { left: 0, right: 0 }), {
      width: 390,
      marginLeft: 0,
    });
  });

  it("centres a capped sheet on a wide window", () => {
    assert.deepEqual(centredSheetSpan(1180, 720, { left: 0, right: 0 }), {
      width: 720,
      marginLeft: 230,
    });
  });

  it("keeps a narrow sheet clear of a rail on its left", () => {
    // Duo Split View: a 469-wide window with the rail on its left edge.
    assert.deepEqual(centredSheetSpan(469, 720, { left: 84, right: 0 }), {
      width: 385,
      marginLeft: 84,
    });
  });

  it("centres between the insets, not the window edges", () => {
    const span = centredSheetSpan(951, 720, { left: 0, right: 84 });
    assert.equal(span.width, 720);
    assert.equal(span.marginLeft, 73);
    assert.ok(span.marginLeft + span.width <= 951 - 84);
  });
});

describe("scanSplit", () => {
  const rails = { top: 24, right: 84, bottom: 0, left: 31 };

  it("stacks camera over list on an upright screen, both clearing both sides", () => {
    const split = scanSplit({ width: 390, height: 761 }, rails);
    assert.equal(split.sideBySide, false);
    assert.deepEqual(split.camera, { top: 24, right: 84, bottom: 0, left: 31 });
    assert.deepEqual(split.panel, { top: 0, right: 84, bottom: 0, left: 31 });
  });

  it("puts the list beside the camera on a screen wider than tall", () => {
    // Pixel Fold inner screen turned sideways, bottom tab bar below.
    const split = scanSplit({ width: 883, height: 716 }, rails);
    assert.equal(split.sideBySide, true);
    // The camera keeps the left edge and the top; the panel the right edge.
    assert.deepEqual(split.camera, { top: 24, right: 0, bottom: 0, left: 31 });
    assert.deepEqual(split.panel, { top: 24, right: 84, bottom: 0, left: 0 });
  });

  it("keeps a square or upright screen stacked", () => {
    assert.equal(
      scanSplit({ width: 669, height: 669 }, rails).sideBySide,
      false
    );
    // Duo open sideways, beside the 360-wide tab sidebar.
    assert.equal(
      scanSplit({ width: 591, height: 669 }, rails).sideBySide,
      false
    );
  });
});
