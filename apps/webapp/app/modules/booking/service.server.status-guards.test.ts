// @vitest-environment node
/**
 * State-transition guards on the FULL checkout/checkin services. Both are
 * called directly by the web action and the mobile endpoints, so a direct
 * POST must not be able to check out a DRAFT booking or force a RESERVED
 * booking to COMPLETE. (The partial/progressive paths carry their own
 * guards — see service.server.partial-checkout.test.ts.)
 */
import { BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { checkinBooking, checkoutBooking } from "./service.server";

// why: guard tests only need the initial booking fetch — the functions must
// throw BEFORE any other db call, so everything else can be inert stubs
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findUniqueOrThrow: vitest.fn(),
      update: vitest.fn(),
    },
    bookingSettings: { findUnique: vitest.fn(), upsert: vitest.fn() },
    $transaction: vitest.fn(),
  },
}));

// why: the scheduler must never be touched by a rejected transition
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: { work: vitest.fn(), cancel: vitest.fn(), sendAfter: vitest.fn() },
  QueueNames: { bookingQueue: "booking-queue" },
}));

const HINTS = { timeZone: "UTC", locale: "en-US" };

function mockBooking(status: BookingStatus) {
  (db.booking.findUniqueOrThrow as any).mockResolvedValue({
    id: "booking-1",
    status,
    from: new Date("2026-07-01T09:00:00Z"),
    to: new Date("2026-07-02T09:00:00Z"),
    bookingAssets: [],
  });
}

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("checkoutBooking status guard", () => {
  it.each([
    BookingStatus.DRAFT,
    BookingStatus.ONGOING,
    BookingStatus.OVERDUE,
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("rejects a %s booking before any mutation", async (status) => {
    mockBooking(status);

    await expect(
      checkoutBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: HINTS,
        userId: "user-1",
      })
    ).rejects.toThrow("can't be checked out in its current status");

    expect(db.booking.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("checkinBooking status guard", () => {
  it.each([
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.ARCHIVED,
  ])("rejects a %s booking before any mutation", async (status) => {
    mockBooking(status);

    await expect(
      checkinBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: HINTS,
        userId: "user-1",
      })
    ).rejects.toThrow("can't be checked in in its current status");

    expect(db.booking.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
