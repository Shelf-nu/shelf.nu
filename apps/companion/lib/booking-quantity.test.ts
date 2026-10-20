import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bookingQuantityCap,
  bookingQuantityDefault,
  canEditBookedQuantity,
} from "./booking-quantity";

describe("bookingQuantityCap", () => {
  it("is the units free for the booking's dates", () => {
    assert.equal(bookingQuantityCap({ available: 7, booked: 2, pool: 20 }), 7);
  });

  it("never cuts what the booking already holds", () => {
    // Over-committed elsewhere: only 3 free, but the booking holds 5.
    assert.equal(bookingQuantityCap({ available: 3, booked: 5 }), 5);
  });

  it("falls back to the pool on a server that sends no availability", () => {
    assert.equal(bookingQuantityCap({ pool: 12 }), 12);
  });

  it("is 0 when nothing is free and the booking holds none", () => {
    assert.equal(bookingQuantityCap({ available: 0, booked: null }), 0);
  });
});

describe("bookingQuantityDefault", () => {
  it("opens on what the booking holds, so confirming changes nothing", () => {
    assert.equal(bookingQuantityDefault({ booked: 5 }), 5);
  });

  it("opens on 1 for an asset the booking does not hold", () => {
    assert.equal(bookingQuantityDefault({ booked: null }), 1);
    assert.equal(bookingQuantityDefault({}), 1);
  });
});

describe("canEditBookedQuantity", () => {
  const standalone = {
    type: "QUANTITY_TRACKED" as const,
    kit: null,
    assetKitId: null,
    slices: [{ assetKitId: null }],
    dispatchedUnitsTotal: 0,
  };

  it("offers the editor on a standalone quantity-tracked row", () => {
    assert.equal(canEditBookedQuantity(standalone), true);
  });

  it("refuses an individual asset", () => {
    assert.equal(
      canEditBookedQuantity({ ...standalone, type: "INDIVIDUAL" }),
      false
    );
  });

  it("refuses a kit-driven slice even when its kit no longer resolves", () => {
    assert.equal(
      canEditBookedQuantity({
        ...standalone,
        assetKitId: "ak-1",
        slices: [{ assetKitId: "ak-1" }],
      }),
      false
    );
    assert.equal(
      canEditBookedQuantity({
        ...standalone,
        slices: [{ assetKitId: "ak-1" }],
      }),
      false
    );
  });

  it("refuses a row that merges several slices", () => {
    assert.equal(
      canEditBookedQuantity({
        ...standalone,
        slices: [{ assetKitId: null }, { assetKitId: "ak-1" }],
      }),
      false
    );
  });

  it("refuses a row whose units have gone out", () => {
    assert.equal(
      canEditBookedQuantity({ ...standalone, dispatchedUnitsTotal: 4 }),
      false
    );
  });

  it("offers the editor when an older server sends no slice or dispatch data", () => {
    assert.equal(
      canEditBookedQuantity({ type: "QUANTITY_TRACKED", kit: null }),
      true
    );
  });
});
