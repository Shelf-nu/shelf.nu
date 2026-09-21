/**
 * Tests for the bounds on editing a booking's model-level reservation.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract pinned here: assigned units are headroom rather than a claim on
 * the free pool, and they are also the floor — setting the quantity to exactly
 * that number is what releases everything still unassigned.
 *
 * @see ./booking-model-reservation.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canCancelModelReservation,
  modelReservationBounds,
} from "./booking-model-reservation";

test("an untouched reservation may use the whole free pool", () => {
  assert.deepEqual(modelReservationBounds({ available: 4 }), {
    min: 1,
    max: 4,
  });
});

test("assigned units are headroom the pool need not supply", () => {
  // Eight are already on the booking and two more are free, so ten is the most
  // this reservation can promise.
  assert.deepEqual(
    modelReservationBounds({ available: 2, fulfilledQuantity: 8 }),
    { min: 8, max: 10 }
  );
});

test("the floor is the units already assigned", () => {
  // The point of the floor: reducing to exactly 8 releases whatever is still
  // unassigned, and nothing below 8 is reachable.
  assert.equal(
    modelReservationBounds({ available: 0, fulfilledQuantity: 8 }).min,
    8
  );
});

test("the floor never drops below one unit", () => {
  assert.equal(
    modelReservationBounds({ available: 3, fulfilledQuantity: 0 }).min,
    1
  );
});

test("a pool reported as negative counts as empty", () => {
  assert.deepEqual(
    modelReservationBounds({ available: -2, fulfilledQuantity: 1 }),
    { min: 1, max: 1 }
  );
});

test("a reservation nothing has been assigned to can be cancelled", () => {
  assert.equal(canCancelModelReservation(0), true);
  assert.equal(canCancelModelReservation(), true);
});

test("one assigned unit takes cancellation off the table", () => {
  // The server refuses it, so a trash control here would always fail —
  // reducing to the assigned count is what releases the rest.
  assert.equal(canCancelModelReservation(1), false);
});
