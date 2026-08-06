import { describe, expect, it } from "vitest";
import {
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
