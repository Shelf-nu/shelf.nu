import { describe, expect, it } from "vitest";
import {
  canAssignModelUnits,
  countReservedModelUnits,
  countUnassignedModelUnits,
  getOutstandingModelRequests,
} from "./booking-model-requests";

/**
 * Behaviour pinned here: the operator-facing "how much work is left" number.
 *
 * The regression this guards is the one that produced the customer report —
 * two surfaces deriving this independently and disagreeing. Any surface that
 * shows outstanding reservations counts through these helpers, so these tests
 * cover all of them.
 */
describe("getOutstandingModelRequests", () => {
  it("keeps only requests that are not yet fully fulfilled", () => {
    const outstanding = getOutstandingModelRequests([
      { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
      { quantity: 2, fulfilledQuantity: 2, fulfilledAt: new Date() },
      { quantity: 5, fulfilledQuantity: 1, fulfilledAt: null },
    ]);

    expect(outstanding).toHaveLength(2);
    expect(outstanding.map((r) => r.quantity)).toEqual([3, 5]);
  });

  it("treats a serialised (string) fulfilledAt as fulfilled", () => {
    // why: loader payloads cross the wire as JSON, so Date becomes a string.
    // A truthy-string check that accidentally became a `instanceof Date` check
    // would silently resurrect fulfilled rows on the client.
    expect(
      getOutstandingModelRequests([
        {
          quantity: 1,
          fulfilledQuantity: 1,
          fulfilledAt: "2026-08-06T10:00:00Z",
        },
      ])
    ).toHaveLength(0);
  });

  it("tolerates a missing relation", () => {
    expect(getOutstandingModelRequests(undefined)).toEqual([]);
    expect(getOutstandingModelRequests(null)).toEqual([]);
  });

  it("excludes a request with no remaining units even if unstamped", () => {
    // Shouldn't be reachable, but trusting `fulfilledAt` alone would render a
    // "0 units to assign" row and count a model with no outstanding work.
    expect(
      getOutstandingModelRequests([
        { quantity: 3, fulfilledQuantity: 3, fulfilledAt: null },
        { quantity: 2, fulfilledQuantity: 5, fulfilledAt: null },
      ])
    ).toEqual([]);
  });
});

describe("countUnassignedModelUnits", () => {
  it("counts units still to find, not request rows", () => {
    // Four requests, but twelve physical things somebody has to go and get.
    // Counting rows here would under-report the work by 8.
    expect(
      countUnassignedModelUnits([
        { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
        { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
        { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
        { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
      ])
    ).toBe(12);
  });

  it("counts only the remainder of a partially fulfilled request", () => {
    expect(
      countUnassignedModelUnits([
        { quantity: 5, fulfilledQuantity: 2, fulfilledAt: null },
      ])
    ).toBe(3);
  });

  it("ignores fulfilled requests entirely", () => {
    expect(
      countUnassignedModelUnits([
        { quantity: 4, fulfilledQuantity: 4, fulfilledAt: new Date() },
        { quantity: 2, fulfilledQuantity: 0, fulfilledAt: null },
      ])
    ).toBe(2);
  });

  it("clamps an over-fulfilled request instead of subtracting from siblings", () => {
    // why: a negative remainder from a data anomaly would silently eat another
    // request's outstanding units and under-report the pill.
    expect(
      countUnassignedModelUnits([
        { quantity: 1, fulfilledQuantity: 4, fulfilledAt: null },
        { quantity: 6, fulfilledQuantity: 0, fulfilledAt: null },
      ])
    ).toBe(6);
  });

  it("returns 0 when there is no outstanding work", () => {
    expect(countUnassignedModelUnits([])).toBe(0);
    expect(countUnassignedModelUnits(undefined)).toBe(0);
  });

  it("pairs with the reserved total to form the displayed X of Y", () => {
    // The section renders "4 of 5 units still to assign". Both halves come
    // from the same outstanding set, so they can never describe different
    // populations.
    const requests = [
      { quantity: 3, fulfilledQuantity: 0, fulfilledAt: null },
      { quantity: 2, fulfilledQuantity: 1, fulfilledAt: null },
      // Fulfilled: contributes to NEITHER half.
      { quantity: 9, fulfilledQuantity: 9, fulfilledAt: new Date() },
    ];

    expect(countUnassignedModelUnits(requests)).toBe(4);
    expect(countReservedModelUnits(requests)).toBe(5);
  });

  it("re-counts a reservation that was fulfilled and then re-opened", () => {
    // `upsertBookingModelRequest` clears `fulfilledAt` back to null whenever
    // the new quantity exceeds `fulfilledQuantity`, so raising a fully
    // fulfilled 3-unit reservation to 5 re-opens it with 2 units outstanding.
    // The operator must see those 2 again — a predicate that treated
    // `fulfilledQuantity > 0` as "done" would hide them forever.
    expect(
      countUnassignedModelUnits([
        { quantity: 5, fulfilledQuantity: 3, fulfilledAt: null },
      ])
    ).toBe(2);
    expect(
      getOutstandingModelRequests([
        { quantity: 5, fulfilledQuantity: 3, fulfilledAt: null },
      ])
    ).toHaveLength(1);
  });
});

describe("canAssignModelUnits", () => {
  it("allows assigning while the booking is live", () => {
    for (const status of ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"]) {
      expect(canAssignModelUnits(status)).toBe(true);
    }
  });

  it("refuses once the booking is finished, cancelled or archived", () => {
    // A cancelled booking was showing an amber "4 units unassigned" flag in the
    // bookings list and "still to assign" on its page. Nothing will ever be
    // assigned there, so both invite action nobody can take and the flag is
    // noise in the list operators use to decide what needs work.
    for (const status of ["COMPLETE", "CANCELLED", "ARCHIVED"]) {
      expect(canAssignModelUnits(status)).toBe(false);
    }
  });

  it("treats an unrecognised status as not assignable", () => {
    // Fail closed: a status added later shouldn't silently start advertising
    // work on a booking whose lifecycle nobody has reviewed here.
    expect(canAssignModelUnits("SOME_FUTURE_STATUS")).toBe(false);
  });
});
