/**
 * Tests for the list search-param reader.
 *
 * @see {@link file://./list.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { EXPIRED_BOOKINGS_FILTER } from "~/modules/booking/constants";
import { getParamsValues } from "./list";

describe("getParamsValues status", () => {
  it("reads a stored booking status in any case", () => {
    expect(getParamsValues(new URLSearchParams("status=ongoing")).status).toBe(
      BookingStatus.ONGOING
    );
  });

  it("reads the bookings list's Expired option", () => {
    expect(getParamsValues(new URLSearchParams("status=EXPIRED")).status).toBe(
      EXPIRED_BOOKINGS_FILTER
    );
    expect(getParamsValues(new URLSearchParams("status=expired")).status).toBe(
      EXPIRED_BOOKINGS_FILTER
    );
  });

  it("reads nothing for ALL or an unknown value", () => {
    expect(
      getParamsValues(new URLSearchParams("status=ALL")).status
    ).toBeNull();
    expect(
      getParamsValues(new URLSearchParams("status=whatever")).status
    ).toBeNull();
  });
});
