/**
 * Runtime twin of the booking-status parity guard: names the drifting status.
 *
 * @see {@link file://./booking-status.parity.ts}
 */
import { BookingStatus } from "@prisma/client";
import { BOOKING_STATUS_NAMES } from "./role-access";

describe("booking status parity", () => {
  it("the package lists exactly Prisma's booking statuses", () => {
    expect([...BOOKING_STATUS_NAMES].sort()).toEqual(
      Object.values(BookingStatus).sort()
    );
  });
});
