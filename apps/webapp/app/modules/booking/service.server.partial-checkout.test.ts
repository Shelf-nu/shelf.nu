import { BookingStatus, AssetStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import * as activityEventService from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";
import { partialCheckoutBooking } from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Setup timezone for consistent test behavior across environments
const originalTZ = process.env.TZ;

beforeAll(() => {
  // Force tests to run in UTC for consistent behavior across environments
  process.env.TZ = "UTC";
});

afterAll(() => {
  if (originalTZ !== undefined) {
    process.env.TZ = originalTZ;
  } else {
    delete process.env.TZ;
  }
});

// why: exercise the booking service business logic without hitting a real DB.
// The $transaction mock runs the callback synchronously against the same `db`
// mock so the in-transaction `tx` calls resolve through the per-model mocks.
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray) =>
        typeof callbackOrArray === "function"
          ? callbackOrArray(db)
          : Promise.all(callbackOrArray)
      ),
    booking: {
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
    },
    asset: {
      // why: scanned-batch conflict/custody lookup + the in-tx kit-info read both
      // call db.asset.findMany. Default to echoing the requested ids with no
      // conflicts/custody so the happy path passes; individual tests override.
      findMany: vitest.fn().mockImplementation((args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({
                id,
                title: `Asset ${id}`,
                status: AssetStatus.AVAILABLE,
                bookings: [],
                kit: null,
              }))
            : []
        );
      }),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    kit: {
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: per-booking source of truth for what's already been checked out.
    // Default to no prior partial check-outs; tests override to simulate
    // re-scans / multi-session flows.
    partialBookingCheckout: {
      create: vitest.fn().mockResolvedValue({}),
      findMany: vitest.fn().mockResolvedValue([]),
    },
  },
}));

// why: prevent real user lookups; the service only needs name fields for notes.
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    displayName: "Test User",
  }),
}));

// why: testing the service without writing real asset notes.
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue(undefined),
}));

// why: testing the service without writing real booking notes.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createStatusTransitionNote: vitest.fn().mockResolvedValue({}),
}));

// why: assert on the activity events emitted without persisting them.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: org-validation guard used by the full checkout delegate; pass it.
vitest.mock("~/utils/org-validation.server", () => ({
  assertAssetsBelongToOrg: vitest.fn().mockResolvedValue(undefined),
}));

// why: prevent real email sends from the full-checkout delegate path.
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: prevent real notification-recipient DB lookups during scheduling.
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
}));

// why: prevent real job scheduling / queue operations during tests.
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    cancel: vitest.fn(),
    schedule: vitest.fn(),
    sendAfter: vitest.fn(),
  },
  QueueNames: {
    BOOKING_UPDATES: "booking-updates",
    bookingQueue: "booking-queue",
  },
}));

const HOURS = 8;
const futureFrom = new Date();
futureFrom.setDate(futureFrom.getDate() + 30);
const futureTo = new Date(futureFrom.getTime() + HOURS * 60 * 60 * 1000);

const mockHints = {
  timeZone: "America/New_York",
  locale: "en-US",
};

/** RESERVED booking with 3 standalone assets, all still Booked. */
const reservedBooking = {
  id: "booking-1",
  name: "Test Booking",
  status: BookingStatus.RESERVED,
  organizationId: "org-1",
  custodianUserId: "user-1",
  custodianTeamMemberId: null,
  from: futureFrom,
  to: futureTo,
  // why: checkoutBooking (the full-op delegate) reads `_count.assets` for the
  // reminder email; the email-include re-fetch returns the same shape.
  _count: { assets: 3 },
  assets: [
    { id: "asset-1", kitId: null, status: AssetStatus.AVAILABLE },
    { id: "asset-2", kitId: null, status: AssetStatus.AVAILABLE },
    { id: "asset-3", kitId: null, status: AssetStatus.AVAILABLE },
  ],
};

const baseParams = {
  id: "booking-1",
  organizationId: "org-1",
  userId: "user-1",
  hints: mockHints,
};

describe("partialCheckoutBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    // why: clearAllMocks resets call history but not mockResolvedValue overrides
    // set by a prior test. Restore the default "echo requested ids, no conflicts"
    // implementation so each test starts from a clean happy-path baseline.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({
                id,
                title: `Asset ${id}`,
                status: AssetStatus.AVAILABLE,
                bookings: [],
                kit: null,
              }))
            : []
        );
      }
    );
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
  });

  it("flips a RESERVED booking to ONGOING and scanned assets to CHECKED_OUT on the first partial scan", async () => {
    expect.assertions(4);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    const result = await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1", "asset-2"],
    });

    // Scanned assets flipped to CHECKED_OUT, org-scoped.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    // First scan transitions the booking RESERVED -> ONGOING.
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: BookingStatus.ONGOING },
      })
    );

    // A partial check-out record is created for the scanned batch.
    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedOutById: "user-1",
        assetIds: ["asset-1", "asset-2"],
        checkoutCount: 2,
      },
    });

    expect(result).toEqual({
      booking: reservedBooking,
      checkedOutAssetCount: 2,
      remainingAssetCount: 1,
      isComplete: false,
    });
  });

  it("records one BOOKING_PARTIAL_CHECKOUT event per scanned asset", async () => {
    expect.assertions(1);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1", "asset-2"],
    });

    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-1",
          bookingId: "booking-1",
        }),
        expect.objectContaining({
          action: "BOOKING_PARTIAL_CHECKOUT",
          assetId: "asset-2",
          bookingId: "booking-1",
        }),
      ],
      expect.anything()
    );
  });

  it("delegates to the full checkout (isComplete=true) when the batch covers every still-Booked asset", async () => {
    expect.assertions(2);

    // Only one asset on the booking; scanning it covers everything outstanding.
    const singleAssetBooking = {
      ...reservedBooking,
      _count: { assets: 1 },
      assets: [{ id: "asset-1", kitId: null, status: AssetStatus.AVAILABLE }],
    };
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(singleAssetBooking);

    const result = await partialCheckoutBooking({
      ...baseParams,
      assetIds: ["asset-1"],
    });

    // Full checkout path does NOT record another partial check-out row.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
    expect(result.isComplete).toBe(true);
  });

  it("throws when a scanned asset is in custody", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // The scanned-batch lookup reports asset-1 in custody.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Camera",
        status: AssetStatus.IN_CUSTODY,
        bookings: [],
        kit: null,
      },
      {
        id: "asset-2",
        title: "Tripod",
        status: AssetStatus.AVAILABLE,
        bookings: [],
        kit: null,
      },
    ]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-2"],
      })
    ).rejects.toThrow(ShelfError);

    // No partial record written when validation rejects.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("throws when a scanned asset is booked/checked-out elsewhere (overlapping conflict)", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // why: the scanned-batch conflict lookup returns asset-1 with a conflicting
    // overlapping booking (a different RESERVED booking), which makes
    // hasAssetBookingConflicts() return true. This guard is unique to
    // partial check-OUT (check-in has no conflict validation), so it needs its
    // own coverage.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Camera",
        status: AssetStatus.AVAILABLE,
        bookings: [{ id: "other-booking", status: BookingStatus.RESERVED }],
        kit: null,
      },
      {
        id: "asset-2",
        title: "Tripod",
        status: AssetStatus.AVAILABLE,
        bookings: [],
        kit: null,
      },
    ]);

    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-2"],
      })
    ).rejects.toThrow(ShelfError);

    // No partial record written when conflict validation rejects.
    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("rejects (and writes nothing) when a scanned asset is not part of the booking", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // The outer try/catch re-wraps the inner 400 ShelfError, preserving its
    // user-facing message (mirrors partial check-in error handling).
    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1", "asset-unrelated"],
      })
    ).rejects.toThrow("Some assets are not part of this booking");

    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });

  it("rejects and writes no duplicate record when re-scanning an already-checked-out asset", async () => {
    expect.assertions(2);

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(reservedBooking);

    // asset-1 was already checked out for this booking in a prior session.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-1"] }]);

    // Re-scan only asset-1 (already recorded) → nothing left to check out, so
    // the idempotency guard rejects before creating any new record.
    await expect(
      partialCheckoutBooking({
        ...baseParams,
        assetIds: ["asset-1"],
      })
    ).rejects.toThrow("already checked out for this booking");

    expect(db.partialBookingCheckout.create).not.toHaveBeenCalled();
  });
});
