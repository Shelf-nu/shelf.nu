/**
 * Tests for where the scanner's closed "Enter code" pill sits: its usual
 * offset, lower on a short screen, or the top strip when it cannot fit.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MANUAL_ENTRY_BOTTOM,
  closedManualEntryBottom,
} from "./scanner-manual-entry";

describe("closedManualEntryBottom", () => {
  it("keeps the usual offset before the controls are measured", () => {
    assert.equal(closedManualEntryBottom(null, 0), MANUAL_ENTRY_BOTTOM);
  });

  it("keeps the usual offset when the strip has room under the controls", () => {
    // An upright phone: about 150 pt below the controls.
    assert.equal(closedManualEntryBottom(150, 0), MANUAL_ENTRY_BOTTOM);
  });

  it("drops lower so it never overlaps the controls on a short screen", () => {
    // iPhone Duo opened sideways: about 107 pt below the controls.
    assert.equal(closedManualEntryBottom(107, 20), 75);
  });

  it("leaves room for a taller pill at a larger text size", () => {
    // The same short screen with the pill at 40 pt instead of 24.
    assert.equal(closedManualEntryBottom(107, 20, 40), 59);
  });

  it("moves to the top strip when no offset clears both the controls and the edge", () => {
    assert.equal(closedManualEntryBottom(50, 20), null);
  });

  it("stays in the bottom strip down to the home-indicator cut-off", () => {
    // Bottom inset 20: the lowest allowed offset is 20 + 8 = 28.
    // 60 pt under the controls: 60 - 8 - 24 = 28, just allowed.
    assert.equal(closedManualEntryBottom(60, 20), 28);
    // One point less and the pill would sit in the 8 pt above the inset.
    assert.equal(closedManualEntryBottom(59, 20), null);
  });

  it("is given the pill's measured height by the scanner", () => {
    const scannerSource = readFileSync(
      path.resolve(__dirname, "../app/(tabs)/scanner.tsx"),
      "utf8"
    );
    const call = scannerSource.match(/closedManualEntryBottom\(([\s\S]*?)\);/);
    assert.ok(call, "scanner.tsx calls closedManualEntryBottom");
    assert.match(call[1], /closedPillHeight/);
  });
});
