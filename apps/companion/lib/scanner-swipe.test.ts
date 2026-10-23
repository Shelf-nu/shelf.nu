import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextScannerActionIndex } from "./scanner-swipe";

describe("nextScannerActionIndex", () => {
  it("steps forward", () => {
    assert.equal(
      nextScannerActionIndex({
        actionCount: 4,
        currentIndex: 1,
        direction: "next",
      }),
      2
    );
  });

  it("steps back", () => {
    assert.equal(
      nextScannerActionIndex({
        actionCount: 4,
        currentIndex: 1,
        direction: "previous",
      }),
      0
    );
  });

  it("wraps forward off the end", () => {
    assert.equal(
      nextScannerActionIndex({
        actionCount: 4,
        currentIndex: 3,
        direction: "next",
      }),
      0
    );
  });

  it("wraps back off the start", () => {
    assert.equal(
      nextScannerActionIndex({
        actionCount: 4,
        currentIndex: 0,
        direction: "previous",
      }),
      3
    );
  });

  // The crash: an operator whose role allows nothing, or any operator swiping
  // before the org's roles have loaded. `% 0` is NaN, so the caller used to
  // index the list with NaN and read `.key` off undefined.
  for (const direction of ["next", "previous"] as const) {
    it(`refuses an empty action list (${direction})`, () => {
      assert.equal(
        nextScannerActionIndex({ actionCount: 0, currentIndex: 0, direction }),
        null
      );
    });

    it(`refuses a single action (${direction})`, () => {
      assert.equal(
        nextScannerActionIndex({ actionCount: 1, currentIndex: 0, direction }),
        null
      );
    });
  }

  it("never answers with an index outside the list", () => {
    for (const actionCount of [2, 3, 4]) {
      for (let currentIndex = 0; currentIndex < actionCount; currentIndex++) {
        for (const direction of ["next", "previous"] as const) {
          const next = nextScannerActionIndex({
            actionCount,
            currentIndex,
            direction,
          });
          assert.ok(next !== null, "a list of 2+ always has somewhere to go");
          assert.ok(next >= 0 && next < actionCount, `${next} out of range`);
          assert.notEqual(next, currentIndex);
        }
      }
    }
  });

  it("recovers from an index the list no longer has", () => {
    // The showing action's index is tracked separately and can outlive a
    // shrinking list, e.g. after a workspace switch drops a permission.
    assert.equal(
      nextScannerActionIndex({
        actionCount: 2,
        currentIndex: 7,
        direction: "next",
      }),
      0
    );
  });
});
