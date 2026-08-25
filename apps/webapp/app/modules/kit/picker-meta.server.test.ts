/**
 * The pool of units a kit may claim from a quantity-tracked asset.
 *
 * A kit slice holds units indefinitely, so anything else already holding or
 * promised those units has to come off the pool first. Getting the set of
 * "anything else" wrong fails in both directions: too little subtracted and a
 * kit swallows units a booking has promised, leaving that booking unable to
 * check out; too much and the picker refuses an allocation that would have
 * been fine.
 *
 * The picker and the write guard both compute this, and the guard only means
 * anything while it computes the same number — which is why the formula and
 * the query filter are shared rather than written twice.
 *
 * @see {@link file://./picker-meta.server.ts}
 */

import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  computeKitClaimablePool,
  KIT_POOL_OCCUPYING_BOOKINGS,
} from "./picker-meta.server";

/** A pool with nothing claimed against it; each test moves one term. */
const UNCLAIMED = {
  totalQuantity: 100,
  currentInThisKit: 0,
  otherKitsQuantity: 0,
  operatorCustodyQuantity: 0,
  occupyingBookedQuantity: 0,
};

describe("KIT_POOL_OCCUPYING_BOOKINGS", () => {
  it("counts reserved bookings, not only what is out right now", () => {
    // A reservation has promised units for a future window, and a kit slice
    // holds units indefinitely. Counting only ONGOING/OVERDUE answers "what is
    // physically out today", which lets a kit claim units a reservation is
    // relying on — that booking then cannot be checked out.
    expect(KIT_POOL_OCCUPYING_BOOKINGS.booking.status.in).toEqual([
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ]);
  });

  it("ignores booked units that belong to a kit", () => {
    // A `BookingAsset` carrying an `assetKitId` is some kit's own slice being
    // booked. That kit is already subtracted through its `AssetKit` row, so
    // counting the booking too removes the same units twice and the picker
    // under-reports what is free.
    expect(KIT_POOL_OCCUPYING_BOOKINGS.assetKitId).toBeNull();
  });
});

describe("computeKitClaimablePool", () => {
  it("offers the whole pool when nothing else holds any of it", () => {
    expect(computeKitClaimablePool(UNCLAIMED)).toEqual({
      spaceWithoutMe: 100,
      maxAllowedForThisKit: 100,
    });
  });

  it("subtracts other kits, operator custody and booked units", () => {
    const { spaceWithoutMe } = computeKitClaimablePool({
      ...UNCLAIMED,
      otherKitsQuantity: 30,
      operatorCustodyQuantity: 10,
      occupyingBookedQuantity: 25,
    });

    expect(spaceWithoutMe).toBe(35);
  });

  it("counts this kit's own units as still claimable by it", () => {
    // `spaceWithoutMe` deliberately excludes this kit, so a kit holding 40 of
    // a pool with 20 free may keep all 40 — the ceiling is not 20.
    const { spaceWithoutMe, maxAllowedForThisKit } = computeKitClaimablePool({
      ...UNCLAIMED,
      currentInThisKit: 40,
      otherKitsQuantity: 80,
    });

    expect(spaceWithoutMe).toBe(20);
    expect(maxAllowedForThisKit).toBe(40);
  });

  it("lets an over-committed kit reduce its slice rather than locking it", () => {
    // Growth elsewhere can push the pool below what this kit already holds.
    // Offering the smaller number would leave the user unable to submit the
    // form at all, including to fix it.
    const { spaceWithoutMe, maxAllowedForThisKit } = computeKitClaimablePool({
      ...UNCLAIMED,
      currentInThisKit: 60,
      otherKitsQuantity: 90,
      operatorCustodyQuantity: 20,
    });

    expect(spaceWithoutMe).toBe(0);
    expect(maxAllowedForThisKit).toBe(60);
  });

  it("never reports a negative pool", () => {
    const { spaceWithoutMe } = computeKitClaimablePool({
      ...UNCLAIMED,
      otherKitsQuantity: 200,
    });

    expect(spaceWithoutMe).toBe(0);
  });

  it("leaves a reservation checkable after a kit takes the rest", () => {
    // The reported failure, as arithmetic: 100 units, 40 promised to a
    // standalone reservation. The kit may take 60. Ignoring the reservation
    // would have offered 100 and left the booking unable to check out.
    const { maxAllowedForThisKit } = computeKitClaimablePool({
      ...UNCLAIMED,
      occupyingBookedQuantity: 40,
    });

    expect(maxAllowedForThisKit).toBe(60);
  });
});
