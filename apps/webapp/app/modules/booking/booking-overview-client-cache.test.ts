import { describe, it, expect, beforeEach } from "vitest";
import {
  readBookingOverviewCache,
  primeBookingOverviewCache,
  __resetBookingOverviewCache,
} from "./booking-overview-client-cache";

const url = (search = "") =>
  new URL(`https://app.test/bookings/b1/overview${search}`);

describe("booking-overview-client-cache", () => {
  beforeEach(() => __resetBookingOverviewCache());

  it("misses on first load (nothing primed yet)", () => {
    expect(readBookingOverviewCache("b1", url("?page=1")).hit).toBe(false);
  });

  it("hits when only a view param changed after priming", () => {
    primeBookingOverviewCache("b1", url("?page=1"), { tag: "server" });
    const res = readBookingOverviewCache("b1", url("?s=cam&page=1"));
    expect(res).toEqual({ hit: true, data: { tag: "server" } });
  });

  it("misses on a same-URL revalidation (e.g. after a mutation)", () => {
    primeBookingOverviewCache("b1", url("?page=1"), { tag: "server" });
    // identical URL → not a view change → must refetch
    expect(readBookingOverviewCache("b1", url("?page=1")).hit).toBe(false);
  });

  it("misses when a non-view param changed", () => {
    primeBookingOverviewCache("b1", url("?page=1"), { tag: "server" });
    expect(readBookingOverviewCache("b1", url("?page=1&foo=bar")).hit).toBe(
      false
    );
  });

  it("misses for a different booking id", () => {
    primeBookingOverviewCache("b1", url("?page=1"), { tag: "server" });
    expect(readBookingOverviewCache("b2", url("?page=1")).hit).toBe(false);
  });

  it("misses when per_page changes (page-size is a server refetch boundary)", () => {
    primeBookingOverviewCache("b1", url("?page=1&per_page=10"), {
      tag: "server",
    });
    expect(readBookingOverviewCache("b1", url("?page=1&per_page=20")).hit).toBe(
      false
    );
  });

  it("advances the baseline so consecutive view changes keep hitting", () => {
    primeBookingOverviewCache("b1", url("?page=1"), { tag: "server" });
    expect(readBookingOverviewCache("b1", url("?s=a")).hit).toBe(true);
    expect(readBookingOverviewCache("b1", url("?s=ab")).hit).toBe(true);
  });
});
