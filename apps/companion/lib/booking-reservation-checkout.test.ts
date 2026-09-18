/**
 * Tests for the check-out rules on bookings with book-by-model reservations.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract pinned here: unassigned reservations never refuse a check-out.
 * The only minimum is that one item goes out, counted over scans alone under
 * the explicit check-out requirement, and the confirm step names exactly the
 * reserved units a check-out leaves unassigned.
 *
 * @see ./booking-reservation-checkout.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canFulfilCheckOut,
  formatUnassignedReservations,
  hasAssetsLeftToCheckOut,
  matchScansToReservations,
  unassignedCheckoutConfirm,
  type OutstandingReservation,
  type ReservationScan,
} from "./booking-reservation-checkout";

const dell: OutstandingReservation = {
  assetModelId: "m-dell",
  assetModelName: "Dell Latitude",
  outstandingQuantity: 2,
};
const hp: OutstandingReservation = {
  assetModelId: "m-hp",
  assetModelName: "HP",
  outstandingQuantity: 1,
};

function scan(targetId: string, assetModelId: string | null): ReservationScan {
  return { type: "asset", targetId, assetModelId };
}

// ── matchScansToReservations ────────────────────────────

test("a scan covering every reserved unit leaves nothing unassigned", () => {
  const match = matchScansToReservations(
    [scan("a1", "m-dell"), scan("a2", "m-dell"), scan("a3", "m-hp")],
    [dell, hp]
  );
  assert.equal(match.matched, 3);
  assert.equal(match.required, 3);
  assert.equal(match.isComplete, true);
  assert.deepEqual(match.unassigned, []);
});

test("lists only the models a partial scan leaves short, with what each still needs", () => {
  const lenovo: OutstandingReservation = {
    assetModelId: "m-lenovo",
    assetModelName: "Lenovo",
    outstandingQuantity: 1,
  };
  const match = matchScansToReservations(
    [scan("a1", "m-lenovo")],
    [dell, hp, lenovo]
  );
  assert.equal(match.isComplete, false);
  assert.deepEqual(match.unassigned, [
    { assetModelName: "Dell Latitude", outstandingQuantity: 2 },
    { assetModelName: "HP", outstandingQuantity: 1 },
  ]);
});

test("reduces a model's outstanding count by the units scanned for it", () => {
  const match = matchScansToReservations([scan("a1", "m-dell")], [dell, hp]);
  assert.deepEqual(match.unassigned, [
    { assetModelName: "Dell Latitude", outstandingQuantity: 1 },
    { assetModelName: "HP", outstandingQuantity: 1 },
  ]);
});

test("units beyond a model's reservation and assets with no reservation are extras", () => {
  const match = matchScansToReservations(
    [scan("a1", "m-hp"), scan("a2", "m-hp"), scan("a3", null)],
    [hp]
  );
  assert.equal(match.matched, 1);
  assert.deepEqual([...match.unmatchedIds], ["a2", "a3"]);
});

test("kits never assign a reserved unit", () => {
  const match = matchScansToReservations(
    [{ type: "kit", targetId: "k1" }],
    [hp]
  );
  assert.equal(match.matched, 0);
  assert.equal(match.unmatchedIds.size, 0);
  assert.equal(match.isComplete, false);
});

test("does not change the reservations it is given", () => {
  const outstanding = [{ ...dell }];
  matchScansToReservations([scan("a1", "m-dell")], outstanding);
  assert.equal(outstanding[0].outstandingQuantity, 2);
});

// ── canFulfilCheckOut ───────────────────────────────────

test("allows a check-out that leaves reserved units unassigned when one unit is scanned", () => {
  const match = matchScansToReservations([scan("a1", "m-dell")], [dell, hp]);
  assert.equal(match.isComplete, false);
  assert.equal(
    canFulfilCheckOut({
      scannedAssetCount: 1,
      hasBookedAssetsLeftToCheckOut: false,
      requireExplicitCheckout: false,
    }),
    true
  );
  assert.equal(
    canFulfilCheckOut({
      scannedAssetCount: 1,
      hasBookedAssetsLeftToCheckOut: false,
      requireExplicitCheckout: true,
    }),
    true
  );
});

test("refuses a check-out that would send nothing out", () => {
  for (const requireExplicitCheckout of [false, true]) {
    assert.equal(
      canFulfilCheckOut({
        scannedAssetCount: 0,
        hasBookedAssetsLeftToCheckOut: false,
        requireExplicitCheckout,
      }),
      false
    );
  }
});

test("counts the booking's own assets only without the explicit check-out requirement", () => {
  assert.equal(
    canFulfilCheckOut({
      scannedAssetCount: 0,
      hasBookedAssetsLeftToCheckOut: true,
      requireExplicitCheckout: false,
    }),
    true
  );
  assert.equal(
    canFulfilCheckOut({
      scannedAssetCount: 0,
      hasBookedAssetsLeftToCheckOut: true,
      requireExplicitCheckout: true,
    }),
    false
  );
});

// ── hasAssetsLeftToCheckOut ─────────────────────────────

test("a quantity-tracked row answers by its remaining count, not its status", () => {
  const none = new Set<string>();
  assert.equal(
    hasAssetsLeftToCheckOut(
      [{ id: "q1", status: "CHECKED_OUT", remainingToCheckOut: 3 }],
      none
    ),
    true
  );
  assert.equal(
    hasAssetsLeftToCheckOut(
      [{ id: "q1", status: "AVAILABLE", remainingToCheckOut: 0 }],
      none
    ),
    false
  );
});

test("an individual row is left to check out while not out and not returned", () => {
  assert.equal(
    hasAssetsLeftToCheckOut([{ id: "a1", status: "AVAILABLE" }], new Set()),
    true
  );
  assert.equal(
    hasAssetsLeftToCheckOut([{ id: "a1", status: "CHECKED_OUT" }], new Set()),
    false
  );
  assert.equal(
    hasAssetsLeftToCheckOut(
      [{ id: "a1", status: "AVAILABLE" }],
      new Set(["a1"])
    ),
    false
  );
});

// ── Confirm copy ────────────────────────────────────────

test("names each unassigned model with its count", () => {
  assert.equal(
    formatUnassignedReservations([
      { assetModelName: "Dell Latitude", outstandingQuantity: 2 },
      { assetModelName: "Tripod", outstandingQuantity: 0 },
      { assetModelName: "HP", outstandingQuantity: 1 },
    ]),
    "2 × Dell Latitude and 1 × HP"
  );
});

test("names a long list up to the limit and counts the rest", () => {
  const reservations = Array.from({ length: 8 }, (_, i) => ({
    assetModelName: `Model ${i + 1}`,
    outstandingQuantity: 1,
  }));
  assert.equal(
    formatUnassignedReservations(reservations, 3),
    "1 × Model 1, 1 × Model 2, 1 × Model 3 and 5 more models"
  );
});

test("asks before a check-out that leaves several units unassigned", () => {
  const confirm = unassignedCheckoutConfirm([
    { assetModelName: "Dell Latitude", outstandingQuantity: 2 },
    { assetModelName: "HP", outstandingQuantity: 1 },
  ]);
  assert.deepEqual(confirm, {
    title: "Some reserved units aren't assigned",
    message:
      "2 × Dell Latitude and 1 × HP are not assigned yet. They stay on the booking so you can scan them later or release them.",
    confirmLabel: "Check out anyway",
  });
});

test("agrees in number when a single unit stays unassigned", () => {
  const confirm = unassignedCheckoutConfirm([
    { assetModelName: "HP", outstandingQuantity: 1 },
  ]);
  assert.equal(
    confirm?.message,
    "1 × HP is not assigned yet. It stays on the booking so you can scan it later or release it."
  );
});

test("asks nothing when no reserved unit stays unassigned", () => {
  assert.equal(unassignedCheckoutConfirm([]), null);
  assert.equal(
    unassignedCheckoutConfirm([
      { assetModelName: "HP", outstandingQuantity: 0 },
    ]),
    null
  );
});
