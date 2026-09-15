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
 * anything while it computes the same number — which is why the formula is
 * shared rather than written twice. The booking term itself comes from
 * `getPeakReservedUnitsByAsset`, which both callers use.
 *
 * @see {@link file://./picker-meta.server.ts}
 */

import { describe, expect, it, vi } from "vitest";

// why: `picker-meta.server.ts` imports the real db client at module level,
// but this file tests only the pure `computeKitClaimablePool`. Without the
// mock, the imported Prisma client attempts a connection against the
// placeholder DATABASE_URL from `test/setup-test-env.ts` and its async
// rejection lands after the tests finish — vitest counts it as a run-level
// error and the whole suite exits red on a clean checkout.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { computeKitClaimablePool } from "./picker-meta.server";

/** A pool with nothing claimed against it; each test moves one term. */
const UNCLAIMED = {
  totalQuantity: 100,
  currentInThisKit: 0,
  otherKitsQuantity: 0,
  operatorCustodyQuantity: 0,
  occupyingBookedQuantity: 0,
};

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
    // 100 units with 40 promised to a standalone reservation leaves 60 for
    // the kit. Offering all 100 would leave the reservation unable to check
    // out, since a kit slice holds its units for good.
    const { maxAllowedForThisKit } = computeKitClaimablePool({
      ...UNCLAIMED,
      occupyingBookedQuantity: 40,
    });

    expect(maxAllowedForThisKit).toBe(60);
  });

  it("takes the booked term as a peak, so disjoint reservations do not stack", () => {
    // Two 60-unit reservations that never overlap hold 60 at once, never 120.
    // The caller passes the peak for exactly this reason — summing them would
    // report a pool of 0 and refuse a slice that is perfectly safe.
    const { maxAllowedForThisKit } = computeKitClaimablePool({
      ...UNCLAIMED,
      occupyingBookedQuantity: 60,
    });

    expect(maxAllowedForThisKit).toBe(40);
  });
});
