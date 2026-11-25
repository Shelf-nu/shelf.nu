/**
 * The location page's pool line and its "reserved next" peak.
 *
 * @see {@link file://./location-holds.ts}
 */

import { describe, expect, it } from "vitest";

import {
  formatLocationPoolLine,
  reservedNextAtLocation,
  unitsHereNow,
} from "./location-holds";

const NOW = new Date("2026-12-01T09:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("formatLocationPoolLine", () => {
  it("reads 8 here · 2 out on bookings · 1 in custody · 3 reserved next", () => {
    expect(
      formatLocationPoolLine({
        placed: 11,
        outOnBookings: 2,
        inCustody: 1,
        reservedNext: 3,
      })
    ).toBe("8 here · 2 out on bookings · 1 in custody · 3 reserved next");
  });

  it("drops the parts that are 0 and keeps here", () => {
    expect(
      formatLocationPoolLine({
        placed: 5,
        outOnBookings: 0,
        inCustody: 0,
        reservedNext: 0,
      })
    ).toBe("5 here");
  });

  it("still renders a placement reduced to 0 with pending units held there", () => {
    expect(
      formatLocationPoolLine({
        placed: 0,
        outOnBookings: 0,
        inCustody: 0,
        reservedNext: 4,
      })
    ).toBe("0 here · 4 reserved next");
  });
});

describe("unitsHereNow", () => {
  it("is a now-figure: reservations never lower it", () => {
    // 3 reserved next stays on the shelf until it leaves.
    expect(unitsHereNow({ placed: 10, outOnBookings: 2, inCustody: 1 })).toBe(
      7
    );
  });

  it("never goes below 0", () => {
    expect(unitsHereNow({ placed: 1, outOnBookings: 2, inCustody: 1 })).toBe(0);
  });
});

describe("reservedNextAtLocation", () => {
  it("takes the peak over the next booking window, never a sum", () => {
    // Two bookings a week apart, 3 each: the next window holds 3.
    expect(
      reservedNextAtLocation(
        [
          { from: day(1), to: day(3), pending: 3 },
          { from: day(8), to: day(10), pending: 3 },
        ],
        NOW
      )
    ).toBe(3);
  });

  it("adds holds that overlap inside the next window", () => {
    expect(
      reservedNextAtLocation(
        [
          { from: day(1), to: day(5), pending: 3 },
          { from: day(2), to: day(4), pending: 2 },
          { from: day(6), to: day(7), pending: 9 },
        ],
        NOW
      )
    ).toBe(5);
  });

  it("treats a running booking as starting now", () => {
    expect(
      reservedNextAtLocation(
        [
          { from: day(-2), to: day(1), pending: 2 },
          { from: day(3), to: day(4), pending: 6 },
        ],
        NOW
      )
    ).toBe(2);
  });

  it("ignores bookings already over and holds with nothing pending", () => {
    expect(
      reservedNextAtLocation(
        [
          { from: day(-5), to: day(-1), pending: 4 },
          { from: day(1), to: day(2), pending: 0 },
        ],
        NOW
      )
    ).toBe(0);
  });

  it("lets back-to-back bookings not overlap", () => {
    expect(
      reservedNextAtLocation(
        [
          { from: day(1), to: day(2), pending: 3 },
          { from: day(2), to: day(3), pending: 4 },
        ],
        NOW
      )
    ).toBe(3);
  });
});
