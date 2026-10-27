/**
 * Tests for the bookings list's status picker translation.
 *
 * @see {@link file://./constants.ts}
 */
import { BookingStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  bookingStatusFilterWhereParams,
  EXPIRED_BOOKINGS_FILTER,
} from "./constants";

describe("bookingStatusFilterWhereParams", () => {
  it("adds nothing when no status was picked, so the list's default applies", () => {
    expect(bookingStatusFilterWhereParams(null)).toEqual({});
    expect(bookingStatusFilterWhereParams(undefined)).toEqual({});
  });

  it("passes a stored status through", () => {
    expect(bookingStatusFilterWhereParams(BookingStatus.ONGOING)).toEqual({
      statuses: [BookingStatus.ONGOING],
    });
  });

  it("turns Expired into RESERVED narrowed by date", () => {
    // why: nothing in the lifecycle moves a reservation nobody checked out,
    // so "expired" is a view over RESERVED, never a stored status.
    expect(bookingStatusFilterWhereParams(EXPIRED_BOOKINGS_FILTER)).toEqual({
      statuses: [BookingStatus.RESERVED],
      expiredOnly: true,
    });
  });
});
