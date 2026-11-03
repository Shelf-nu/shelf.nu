/**
 * Tests for where the scanner's closed "Enter code" pill sits: its usual
 * offset, lower on a short screen, or the top strip when it cannot fit.
 */
import assert from "node:assert/strict";
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
});
