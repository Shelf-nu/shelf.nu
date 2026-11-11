import { describe, expect, it } from "vitest";
import {
  canAssignModelUnits,
  canCancelModelReservation,
  canEditModelReservations,
  countReservedModelUnits,
  countUnassignedModelUnits,
  getReservationCeiling,
  getModelRequestQuantityIssue,
  getOutstandingModelRequests,
  isReservationOverCommitted,
  MODEL_TAB_PAGE_PARAM,
  MODEL_TAB_SEARCH_PARAM,
  MODEL_TAB_SHOW_EMPTY_PARAM,
  readModelTabParams,
  summarizeUnassignedUnits,
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

describe("canCancelModelReservation", () => {
  it("allows cancelling a reservation nothing has been assigned to", () => {
    expect(canCancelModelReservation({ fulfilledQuantity: 0 })).toBe(true);
  });

  it("refuses once a single unit is on the booking", () => {
    // Deleting the row would strip that asset's provenance via the FK's
    // ON DELETE SET NULL, so the server refuses. Reducing the quantity to the
    // assigned count is the route that releases the rest.
    expect(canCancelModelReservation({ fulfilledQuantity: 1 })).toBe(false);
  });

  it("refuses a fully assigned reservation", () => {
    expect(canCancelModelReservation({ fulfilledQuantity: 5 })).toBe(false);
  });
});

describe("canEditModelReservations", () => {
  it("allows adjusting the reservation while the booking is live", () => {
    // A booking that is already out is exactly when an operator learns a unit
    // is damaged or was never collected, and the reservation still holds that
    // unit against every other booking in the window.
    for (const status of ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"]) {
      expect(canEditModelReservations(status)).toBe(true);
    }
  });

  it("refuses once the booking is finished, cancelled or archived", () => {
    for (const status of ["COMPLETE", "CANCELLED", "ARCHIVED"]) {
      expect(canEditModelReservations(status)).toBe(false);
    }
  });

  it("answers the same statuses as assigning units", () => {
    // The two questions have to move together: a reservation an operator can
    // still fulfil is one they must also be able to correct, and the reverse.
    for (const status of [
      "DRAFT",
      "RESERVED",
      "ONGOING",
      "OVERDUE",
      "COMPLETE",
      "CANCELLED",
      "ARCHIVED",
      "SOME_FUTURE_STATUS",
    ]) {
      expect(canEditModelReservations(status)).toBe(
        canAssignModelUnits(status)
      );
    }
  });
});

describe("summarizeUnassignedUnits", () => {
  it("names a single model with its unit count", () => {
    expect(
      summarizeUnassignedUnits([{ name: "Dell Latitude", count: 2 }])
    ).toBe("2 × Dell Latitude");
  });

  it("joins the last two models with 'and'", () => {
    expect(
      summarizeUnassignedUnits([
        { name: "Dell Latitude", count: 2 },
        { name: "HP LaserJet", count: 1 },
        { name: "Pelican case", count: 3 },
      ])
    ).toBe("2 × Dell Latitude, 1 × HP LaserJet and 3 × Pelican case");
  });

  it("names a long list up to the limit and counts the rest", () => {
    // A confirmation that lists forty models is one nobody reads.
    const units = Array.from({ length: 8 }, (_, i) => ({
      name: `Model ${i + 1}`,
      count: 1,
    }));

    expect(summarizeUnassignedUnits(units, 3)).toBe(
      "1 × Model 1, 1 × Model 2, 1 × Model 3 and 5 more models"
    );
  });

  it("says 'model' when exactly one is left over the limit", () => {
    const units = Array.from({ length: 4 }, (_, i) => ({
      name: `Model ${i + 1}`,
      count: 1,
    }));

    expect(summarizeUnassignedUnits(units, 3)).toBe(
      "1 × Model 1, 1 × Model 2, 1 × Model 3 and 1 more model"
    );
  });

  it("leaves out models with nothing unassigned", () => {
    expect(
      summarizeUnassignedUnits([
        { name: "Dell Latitude", count: 0 },
        { name: "HP LaserJet", count: 1 },
      ])
    ).toBe("1 × HP LaserJet");
  });
});

describe("getReservationCeiling", () => {
  it("is the free units when the booking holds nothing by name", () => {
    expect(
      getReservationCeiling({ available: 4, namedNotInCustody: 0 }, 0)
    ).toBe(4);
  });

  it("takes off units the booking already holds by name", () => {
    // Two named units of four free leave room for a reservation of two.
    expect(
      getReservationCeiling({ available: 4, namedNotInCustody: 2 }, 0)
    ).toBe(2);
  });

  it("adds back units the reservation has already been fulfilled with", () => {
    // Those two named units ARE the reservation's assigned units, so the
    // reservation may still total four.
    expect(
      getReservationCeiling({ available: 4, namedNotInCustody: 2 }, 2)
    ).toBe(4);
  });

  it("does not take off a fulfilled unit a custodian holds", () => {
    // The pool already deducted the custody unit, so it is not named here.
    expect(
      getReservationCeiling({ available: 3, namedNotInCustody: 0 }, 1)
    ).toBe(4);
  });
});

describe("isReservationOverCommitted", () => {
  const pool = { available: 3, namedNotInCustody: 0 };

  it("is false when the reservation fits", () => {
    expect(
      isReservationOverCommitted(pool, { quantity: 2, fulfilled: 0 })
    ).toBe(false);
  });

  it("is false when the reservation takes exactly what is left", () => {
    // The boundary matters: a full pool is not over-committed.
    expect(
      isReservationOverCommitted(pool, { quantity: 3, fulfilled: 0 })
    ).toBe(false);
  });

  it("is true when the reservation asks for more than is left", () => {
    expect(
      isReservationOverCommitted(pool, { quantity: 4, fulfilled: 0 })
    ).toBe(true);
  });

  it("counts units held by name against the same pool", () => {
    expect(
      isReservationOverCommitted(
        { available: 3, namedNotInCustody: 2 },
        { quantity: 2, fulfilled: 0 }
      )
    ).toBe(true);
  });
});

describe("getModelRequestQuantityIssue", () => {
  /** An over-committed pool: 5 units exist, 10 are claimed over this window. */
  const overCommitted = {
    floor: 1,
    capacity: 0,
    current: 5,
    total: 5,
  };

  it("allows a reduction when the pool is over-committed", () => {
    expect.assertions(1);
    // The remediation the "Over-reserved" badge asks for. Capping it would
    // leave no legal quantity at all: Remove is hidden once a unit is assigned.
    expect(getModelRequestQuantityIssue(1, overCommitted)).toBeNull();
  });

  it("allows a reduction when the capacity is negative", () => {
    expect.assertions(1);
    expect(
      getModelRequestQuantityIssue(3, {
        floor: 0,
        capacity: -2,
        current: 5,
        total: 5,
      })
    ).toBeNull();
  });

  it("allows holding at the current quantity when over-committed", () => {
    expect.assertions(1);
    expect(getModelRequestQuantityIssue(5, overCommitted)).toBeNull();
  });

  it("rejects an increase past the capacity", () => {
    expect.assertions(1);
    expect(
      getModelRequestQuantityIssue(8, {
        floor: 0,
        capacity: 6,
        current: 4,
        total: 10,
      })
    ).toBe(
      "Only 6 of 10 available in this window — reduce the quantity to continue."
    );
  });

  it("allows an increase up to the capacity", () => {
    expect.assertions(1);
    expect(
      getModelRequestQuantityIssue(6, {
        floor: 0,
        capacity: 6,
        current: 4,
        total: 10,
      })
    ).toBeNull();
  });

  it("never quotes a negative number of available units", () => {
    expect.assertions(1);
    // Over-committed AND an increase — the only path that both reports a
    // capacity and has a negative one to report.
    expect(
      getModelRequestQuantityIssue(6, {
        floor: 0,
        capacity: -2,
        current: 5,
        total: 5,
      })
    ).toBe(
      "Only 0 of 5 available in this window — reduce the quantity to continue."
    );
  });

  it("rejects going below the already-assigned floor", () => {
    expect.assertions(1);
    expect(
      getModelRequestQuantityIssue(1, { ...overCommitted, floor: 3 })
    ).toBe("3 units are already assigned — 3 is the lowest this can go.");
  });

  it("uses the singular when one unit is assigned", () => {
    expect.assertions(1);
    expect(
      getModelRequestQuantityIssue(0, { ...overCommitted, floor: 1 })
    ).toBe("1 unit is already assigned — 1 is the lowest this can go.");
  });

  it("still enforces the floor when pool availability is unknown", () => {
    expect.assertions(2);
    const unknownPool = { floor: 2, capacity: null, current: 4, total: null };
    expect(getModelRequestQuantityIssue(1, unknownPool)).toBe(
      "2 units are already assigned — 2 is the lowest this can go."
    );
    // No capacity to judge against, so any quantity above the floor passes.
    expect(getModelRequestQuantityIssue(99, unknownPool)).toBeNull();
  });
});

describe("readModelTabParams", () => {
  /** Builds the URL params the Models tab writes. */
  const params = (search?: string, page?: string) => {
    const p = new URLSearchParams({ s: "asset search" });
    if (search !== undefined) p.set(MODEL_TAB_SEARCH_PARAM, search);
    if (page !== undefined) p.set(MODEL_TAB_PAGE_PARAM, page);
    return p;
  };

  it("reads the trimmed model search and page", () => {
    expect(readModelTabParams(params("  dell ", "3"))).toEqual({
      search: "dell",
      page: 3,
      showModelsWithoutAssets: false,
    });
  });

  it("ignores the asset list's own search", () => {
    expect(readModelTabParams(params())).toEqual({
      showModelsWithoutAssets: false,
    });
  });

  it("omits a blank search and any page that is not a whole number above 1", () => {
    const none = { showModelsWithoutAssets: false };
    expect(readModelTabParams(params("   ", "1"))).toEqual(none);
    expect(readModelTabParams(params(undefined, "0"))).toEqual(none);
    expect(readModelTabParams(params(undefined, "2.5"))).toEqual(none);
    expect(readModelTabParams(params(undefined, "abc"))).toEqual(none);
  });

  it("hides models without assets unless the toggle is exactly on", () => {
    const withToggle = (value: string) => {
      const p = params();
      p.set(MODEL_TAB_SHOW_EMPTY_PARAM, value);
      return readModelTabParams(p).showModelsWithoutAssets;
    };
    expect(withToggle("true")).toBe(true);
    expect(withToggle("false")).toBe(false);
    expect(withToggle("1")).toBe(false);
  });
});
