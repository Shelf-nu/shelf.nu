import { describe, expect, it } from "vitest";
import { pinBookingAvailabilityWindow } from "./picker-availability-window.server";

// @vitest-environment node

const PICKER = "http://localhost/bookings/b1/overview/manage-assets";
const booking = {
  from: new Date("2026-11-02T09:00:00.000Z"),
  to: new Date("2026-11-04T17:00:00.000Z"),
};

/** The search params of the request the picker reads its list from. */
function paramsOf(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams);
}

describe("pinBookingAvailabilityWindow", () => {
  it("fills in the booking's dates when the URL has none", () => {
    const request = new Request(`${PICKER}?hideUnavailable=true&per_page=50`);

    expect(paramsOf(pinBookingAvailabilityWindow(request, booking))).toEqual({
      hideUnavailable: "true",
      per_page: "50",
      bookingFrom: "2026-11-02T09:00:00.000Z",
      bookingTo: "2026-11-04T17:00:00.000Z",
    });
  });

  it("measures against the booking, not dates the URL carries", () => {
    const request = new Request(
      `${PICKER}?hideUnavailable=true&bookingFrom=2020-01-01T00:00:00.000Z&bookingTo=2020-01-02T00:00:00.000Z`
    );

    expect(paramsOf(pinBookingAvailabilityWindow(request, booking))).toEqual({
      hideUnavailable: "true",
      bookingFrom: "2026-11-02T09:00:00.000Z",
      bookingTo: "2026-11-04T17:00:00.000Z",
    });
  });

  it("lists every asset when the booking has no dates to hide by", () => {
    const request = new Request(`${PICKER}?hideUnavailable=true&per_page=50`);

    expect(
      paramsOf(pinBookingAvailabilityWindow(request, { from: null, to: null }))
    ).toEqual({ per_page: "50" });
  });

  it("leaves a request that shows every asset untouched", () => {
    const request = new Request(`${PICKER}?per_page=50`);

    expect(pinBookingAvailabilityWindow(request, booking)).toBe(request);
  });

  it("keeps the headers the per-page cookie is read from", () => {
    const request = new Request(`${PICKER}?hideUnavailable=true`, {
      headers: { Cookie: "perPage=50" },
    });

    expect(
      pinBookingAvailabilityWindow(request, booking).headers.get("Cookie")
    ).toBe("perPage=50");
  });
});
