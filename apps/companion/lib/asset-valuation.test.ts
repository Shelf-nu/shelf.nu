import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { valuationFromInput, valuationToInput } from "./asset-valuation";

describe("valuationToInput", () => {
  it("shows a stored zero", () => {
    assert.equal(valuationToInput(0), "0");
  });

  it("shows a stored negative", () => {
    assert.equal(valuationToInput(-50), "-50");
  });

  it("shows an ordinary valuation", () => {
    assert.equal(valuationToInput(1250.5), "1250.5");
  });

  it("shows nothing when the asset has no valuation", () => {
    assert.equal(valuationToInput(null), "");
    assert.equal(valuationToInput(undefined), "");
  });
});

describe("valuationFromInput", () => {
  it("stores a typed zero rather than clearing the valuation", () => {
    assert.equal(valuationFromInput("0"), 0);
  });

  it("reads a blank field as no answer", () => {
    assert.equal(valuationFromInput(""), null);
  });

  it("reads a field holding only spaces as no answer, not as zero", () => {
    assert.equal(valuationFromInput("   "), null);
  });

  it("ignores surrounding whitespace", () => {
    assert.equal(valuationFromInput("  5 "), 5);
  });

  it("keeps negatives", () => {
    assert.equal(valuationFromInput("-50"), -50);
  });

  it("never yields NaN for text that is not a number", () => {
    assert.equal(valuationFromInput("abc"), null);
  });
});

describe("the two directions agree", () => {
  // A valuation that survives a round trip is one the edit screen cannot lose.
  for (const stored of [0, -50, 1250.5, 7]) {
    it(`round-trips ${stored}`, () => {
      assert.equal(valuationFromInput(valuationToInput(stored)), stored);
    });
  }

  it("round-trips no valuation as no valuation", () => {
    assert.equal(valuationFromInput(valuationToInput(null)), null);
  });
});
