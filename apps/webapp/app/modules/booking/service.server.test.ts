import {
  BookingStatus,
  AssetStatus,
  AssetType,
  KitStatus,
  OrganizationRoles,
  ConsumptionType,
} from "@prisma/client";

import { db } from "~/database/db.server";
import * as quantityLock from "~/modules/consumption-log/quantity-lock.server";
import * as consumptionLogService from "~/modules/consumption-log/service.server";
import * as noteService from "~/modules/note/service.server";
import { ShelfError } from "~/utils/error";
import { wrapBookingStatusForNote } from "~/utils/markdoc-wrappers";
import { scheduler } from "~/utils/scheduler.server";
import { sendBookingUpdatedEmail } from "./email-helpers";
import {
  createBooking,
  partialCheckinBooking,
  hasPartialCheckins,
  getPartialCheckinHistory,
  getTotalPartialCheckinCount,
  getPartiallyCheckedInAssetIds,
  getKitIdsByAssets,
  updateBasicBooking,
  updateBookingAssets,
  reserveBooking,
  checkoutBooking,
  fulfilModelRequestsAndCheckout,
  checkinBooking,
  archiveBooking,
  cancelBooking,
  deleteBooking,
  getBooking,
  duplicateBooking,
  revertBookingToDraft,
  extendBooking,
  removeAssets,
  getOngoingBookingForAsset,
  // Phase 3c helpers
  computeBookingAssetRemaining,
  isBookingFullyCheckedIn,
  // Test helper functions
  getActionTextFromTransition,
  getSystemActionText,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Setup timezone for consistent test behavior across environments
const originalTZ = process.env.TZ;

beforeAll(() => {
  // Force tests to run in UTC for consistent behavior across environments
  process.env.TZ = "UTC";
});

afterAll(() => {
  // Restore original timezone
  if (originalTZ !== undefined) {
    process.env.TZ = originalTZ;
  } else {
    delete process.env.TZ;
  }
});

// Mock dependencies
// why: testing booking service business logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    // why: handles both callback-style and array-style $transaction
    $transaction: vitest
      .fn()
      .mockImplementation((callbackOrArray) =>
        typeof callbackOrArray === "function"
          ? callbackOrArray(db)
          : Promise.all(callbackOrArray)
      ),
    $executeRaw: vitest.fn().mockResolvedValue(0),
    booking: {
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      findFirstOrThrow: vitest.fn().mockResolvedValue({}),
      findUnique: vitest.fn().mockResolvedValue(null),
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      delete: vitest.fn().mockResolvedValue({}),
      count: vitest.fn().mockResolvedValue(0),
    },
    asset: {
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      update: vitest.fn().mockResolvedValue({}),
    },
    kit: {
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    partialBookingCheckin: {
      create: vitest.fn().mockResolvedValue({}),
      count: vitest.fn().mockResolvedValue(0),
      findMany: vitest.fn().mockResolvedValue([]),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { checkinCount: 0 } }),
    },
    user: {
      findUniqueOrThrow: vitest.fn().mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
      }),
    },
    bookingNote: {
      create: vitest.fn().mockResolvedValue({}),
      findMany: vitest.fn().mockResolvedValue([]),
      deleteMany: vitest.fn().mockResolvedValue({ count: 1 }),
    },
    tag: {
      findMany: vitest
        .fn()
        .mockResolvedValue([{ name: "Tag 1" }, { name: "Tag 2" }]),
    },
    teamMember: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    bookingAsset: {
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      groupBy: vitest.fn().mockResolvedValue([]),
      // why: Phase 3c qty-tracked flows call tx.bookingAsset.count when
      // deciding whether a shared pool can flip back to AVAILABLE.
      count: vitest.fn().mockResolvedValue(0),
    },
    // why: Phase 3d checkoutBooking queries tx.bookingModelRequest.findMany
    // to block RESERVED → ONGOING when model-level reservations haven't
    // been materialised into concrete BookingAsset rows yet.
    bookingModelRequest: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    consumptionLog: {
      create: vitest.fn().mockResolvedValue({}),
      findMany: vitest.fn().mockResolvedValue([]),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    // why: Phase 3c pool-drain guard aggregates and counts custody rows
    // to refuse decrements that would leave team members uncovered.
    custody: {
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      count: vitest.fn().mockResolvedValue(0),
    },
    bookingSettings: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: ensuring predictable ID generation for consistent test assertions
vitest.mock("~/utils/id/id.server", () => ({
  id: vitest.fn(() => "mock-id"),
}));

// why: avoiding QR code generation during booking service tests
vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

// why: testing booking workflows without creating actual asset notes
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn(),
}));

// why: avoiding actual booking note creation during service tests
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
}));

// why: preventing database lookups for user data during booking tests
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
  }),
}));

// why: quantity-lock relies on $queryRaw (FOR UPDATE) which the db mock
// can't express cleanly — stub the helper to return a minimal asset
// stub. Tests override the return per-asset as needed.
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn().mockResolvedValue({
    id: "asset-qty-default",
    title: "Default Asset",
    quantity: 0,
  }),
}));

// why: partial-mock so real helpers (computeBookingAvailableQuantity and
// friends) keep their behavior, but ConsumptionLog writes are stubbed so
// we can assert on calls without running real Prisma writes.
vitest.mock(
  "~/modules/consumption-log/service.server",
  async (importOriginal) => {
    const actual = await importOriginal<typeof consumptionLogService>();
    return {
      ...actual,
      createConsumptionLog: vitest.fn().mockResolvedValue({}),
    };
  }
);

// why: preventing actual email sending during tests
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: `fulfilModelRequestsAndCheckout` calls `materializeModelRequestForAsset`
// per scanned asset inside its transaction. The real helper issues writes to
// `tx.bookingModelRequest.update/delete` + `tx.bookingNote.create` that aren't
// the unit under test here — we care that the service composes the scan-drain
// + checkout writes atomically, not that the helper itself works (it has its
// own tests in booking-model-request/service.server.test.ts). Tests below
// override `mockResolvedValueOnce` per scenario when they need to assert on
// specific match/no-match behaviour.
vitest.mock("~/modules/booking-model-request/service.server", () => ({
  materializeModelRequestForAsset: vitest
    .fn()
    .mockResolvedValue({ matched: true, remaining: 0 }),
}));

// why: spying on booking update email calls without executing
// actual DB lookups or email sends
vitest.mock("./email-helpers", async () => {
  const actual = await vitest.importActual("./email-helpers");
  return {
    ...actual,
    sendBookingUpdatedEmail: vitest.fn().mockResolvedValue(undefined),
  };
});

// why: avoiding organization admin lookups during booking notification tests
vitest.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdminsEmails: vitest
    .fn()
    .mockResolvedValue(["admin@example.com"]),
  getOrganizationAdminsForNotification: vitest.fn().mockResolvedValue([
    {
      id: "admin-1",
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
    },
  ]),
}));

// why: preventing actual job scheduling and queue operations during tests
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

const HOURS_BETWEEN_FROM_AND_TO = 8;
const futureFromDate = new Date();
futureFromDate.setDate(futureFromDate.getDate() + 30);
const futureToDate = new Date(
  futureFromDate.getTime() + HOURS_BETWEEN_FROM_AND_TO * 60 * 60 * 1000
);
const futureCreatedAt = new Date(futureFromDate.getTime() - 60 * 60 * 1000);

const mockBookingData = {
  id: "booking-1",
  name: "Test Booking",
  description: "Test Description",
  status: BookingStatus.DRAFT,
  creatorId: "user-1",
  organizationId: "org-1",
  custodianUserId: "user-1",
  custodianTeamMemberId: null,
  from: futureFromDate,
  to: futureToDate,
  createdAt: futureCreatedAt,
  updatedAt: futureCreatedAt,
  bookingAssets: [
    {
      asset: { id: "asset-1", kitId: null },
      assetId: "asset-1",
      quantity: 1,
      id: "ba-1",
    },
    {
      asset: { id: "asset-2", kitId: null },
      assetId: "asset-2",
      quantity: 1,
      id: "ba-2",
    },
    {
      asset: { id: "asset-3", kitId: "kit-1" },
      assetId: "asset-3",
      quantity: 1,
      id: "ba-3",
    },
  ],
  tags: [{ id: "tag-1", name: "Tag 1", color: "#123456" }],
};

const mockClientHints = {
  timeZone: "America/New_York",
  locale: "en-US",
};

const mockCreateBookingParams = {
  booking: {
    name: "Test Booking",
    description: "Test Description",
    custodianUserId: "user-1",
    custodianTeamMemberId: "team-member-1",
    organizationId: "org-1",
    creatorId: "user-1",
    from: futureFromDate,
    to: futureToDate,
    tags: [],
  },
  assetIds: ["asset-1", "asset-2"],
  hints: mockClientHints,
};

describe("createBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should create a booking successfully", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(mockBookingData);

    const result = await createBooking(mockCreateBookingParams);

    expect(db.booking.create).toHaveBeenCalledWith({
      data: {
        name: "Test Booking",
        description: "Test Description",
        custodianUser: { connect: { id: "user-1" } },
        custodianTeamMember: { connect: { id: "team-member-1" } },
        organization: { connect: { id: "org-1" } },
        creator: { connect: { id: "user-1" } },
        from: futureFromDate,
        to: futureToDate,
        originalFrom: futureFromDate,
        originalTo: futureToDate,
        status: "DRAFT",
        bookingAssets: {
          create: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
        },
      },
      include: {
        custodianUser: true,
        custodianTeamMember: true,
        organization: true,
        tags: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });
    expect(result).toEqual(mockBookingData);
  });

  it("should create a booking without custodian when custodianUserId is null", async () => {
    expect.assertions(1);
    const paramsWithoutCustodian = {
      ...mockCreateBookingParams,
      booking: {
        ...mockCreateBookingParams.booking,
        custodianUserId: null,
        custodianTeamMemberId: "team-member-1",
        tags: [],
      },
    };
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(mockBookingData);

    await createBooking(paramsWithoutCustodian);

    expect(db.booking.create).toHaveBeenCalledWith({
      data: {
        name: "Test Booking",
        description: "Test Description",
        organization: { connect: { id: "org-1" } },
        creator: { connect: { id: "user-1" } },
        custodianTeamMember: { connect: { id: "team-member-1" } },
        from: futureFromDate,
        to: futureToDate,
        originalFrom: futureFromDate,
        originalTo: futureToDate,
        status: "DRAFT",
        bookingAssets: {
          create: [{ assetId: "asset-1" }, { assetId: "asset-2" }],
        },
      },
      include: {
        custodianUser: true,
        custodianTeamMember: true,
        organization: true,
        tags: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
    });
  });

  it("should throw ShelfError when creation fails", async () => {
    expect.assertions(1);
    const error = new Error("Database error");
    //@ts-expect-error missing vitest type
    db.booking.create.mockRejectedValue(error);

    await expect(createBooking(mockCreateBookingParams)).rejects.toThrow(
      ShelfError
    );
  });
});

describe("partialCheckinBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockPartialCheckinParams = {
    id: "booking-1",
    organizationId: "org-1",
    assetIds: ["asset-1", "asset-2"],
    userId: "user-1",
    hints: mockClientHints,
  };

  it("should perform partial check-in successfully", async () => {
    expect.assertions(4);

    // Mock booking with assets for initial validation
    const bookingWithAssets = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-1", kitId: null, type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
        },
        {
          asset: { id: "asset-2", kitId: null, type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
        },
        {
          asset: { id: "asset-3", kitId: null, type: AssetType.INDIVIDUAL },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-3",
        },
      ],
    };

    // Mock booking after transaction (assets remain in booking)
    // const updatedBooking = {
    //   ...mockBookingData,
    //   assets: [
    //     { id: "asset-1", kitId: null },
    //     { id: "asset-2", kitId: null },
    //     { id: "asset-3", kitId: null },
    //   ],
    // };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(bookingWithAssets);

    // why: isBookingFullyCheckedIn reads tx.bookingAsset.findMany to decide
    // the ONGOING→COMPLETE transition. Returning the 3 booking assets keeps
    // the booking in the partial (non-complete) branch so txResult.booking
    // resolves to bookingWithAssets (with name set) and the note block
    // succeeds. Also feeds the post-tx "outstanding" count.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      { assetId: "asset-1", asset: { type: AssetType.INDIVIDUAL } },
      { assetId: "asset-2", asset: { type: AssetType.INDIVIDUAL } },
      { assetId: "asset-3", asset: { type: AssetType.INDIVIDUAL } },
    ]);

    // why: so isBookingFullyCheckedIn sees asset-1 and asset-2 as reconciled
    // (and asset-3 as still outstanding) — keeps the booking at "partial"
    // and makes remainingAssetCount resolve to 1.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1", "asset-2"] },
    ]);

    const result = await partialCheckinBooking(mockPartialCheckinParams);

    // Verify assets status updated (only INDIVIDUAL assets get status reset).
    // The service filters by type in JS now (Phase 3c), so the where clause
    // just has the individual asset IDs.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] } },
      data: { status: AssetStatus.AVAILABLE },
    });

    // Verify partial check-in record created
    expect(db.partialBookingCheckin.create).toHaveBeenCalledWith({
      data: {
        bookingId: "booking-1",
        checkedInById: "user-1",
        assetIds: ["asset-1", "asset-2"],
        checkinCount: 2,
      },
    });

    // Verify notes created — individual-asset note includes a markdoc
    // link back to the booking (post-Phase 3c wording).
    expect(noteService.createNotes).toHaveBeenCalledWith({
      content:
        '{% link to="/settings/team/users/user-1" text="Test User" /%} checked in via partial check-in on {% link to="/bookings/booking-1" text="Test Booking" /%}.',
      type: "UPDATE",
      userId: "user-1",
      assetIds: ["asset-1", "asset-2"],
    });

    expect(result).toEqual({
      booking: bookingWithAssets, // Assets remain in booking with new approach
      checkedInAssetCount: 2,
      remainingAssetCount: 1, // 3 total - 2 checked in = 1 remaining
      isComplete: false,
    });
  });

  it("should redirect to complete check-in when all assets are being checked in", async () => {
    expect.assertions(1);

    // Mock booking with same assets as being checked in
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-1", kitId: null },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
        },
        {
          asset: { id: "asset-2", kitId: null },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
        },
      ],
    });

    // Mock asset statuses - both assets are CHECKED_OUT
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", status: AssetStatus.CHECKED_OUT },
      { id: "asset-2", status: AssetStatus.CHECKED_OUT },
    ]);

    // Mock complete checkin function
    const mockCheckinBooking = vitest
      .fn()
      .mockResolvedValue({ booking: mockBookingData });
    vitest.doMock("./service.server", async () => ({
      ...(await vitest.importActual("./service.server")),
      checkinBooking: mockCheckinBooking,
    }));

    await partialCheckinBooking(mockPartialCheckinParams);

    // Should not create partial check-in record when doing complete check-in
    expect(db.partialBookingCheckin.create).not.toHaveBeenCalled();
  });

  it("should throw error when asset is not in booking", async () => {
    expect.assertions(1);

    // Mock booking with different assets
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-3", kitId: null },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t1",
        },
      ],
    });

    // Mock asset statuses for the booking's actual assets
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-3", status: AssetStatus.CHECKED_OUT },
    ]);

    await expect(
      partialCheckinBooking(mockPartialCheckinParams)
    ).rejects.toThrow(ShelfError);
  });

  it("should handle kit check-in when all kit assets are scanned", async () => {
    expect.assertions(2);

    const paramsWithKit = {
      ...mockPartialCheckinParams,
      assetIds: ["asset-1", "asset-2"], // Both belong to same kit
    };

    const bookingWithKitAssets = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-1", kitId: "kit-1", type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t2",
        },
        {
          asset: { id: "asset-2", kitId: "kit-1", type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t3",
        },
        {
          asset: { id: "asset-3", kitId: null, type: AssetType.INDIVIDUAL },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t4",
        },
      ],
    };

    const updatedBookingWithRemainingAsset = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-3", kitId: null },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t5",
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(bookingWithKitAssets);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", status: AssetStatus.CHECKED_OUT },
      { id: "asset-2", status: AssetStatus.CHECKED_OUT },
      { id: "asset-3", status: AssetStatus.CHECKED_OUT },
    ]);

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(updatedBookingWithRemainingAsset);

    // Mock hasPartialCheckins to return true to ensure PartialBookingCheckin record is created
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.count.mockResolvedValue(1);

    await partialCheckinBooking(paramsWithKit);

    // Verify kit status updated when all assets checked in
    expect(db.kit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1"] } },
      data: { status: KitStatus.AVAILABLE },
    });

    expect(db.partialBookingCheckin.create).toHaveBeenCalled();
  });
});

describe("hasPartialCheckins", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return true when booking has partial check-ins", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.count.mockResolvedValue(3);

    const result = await hasPartialCheckins("booking-1");

    expect(db.partialBookingCheckin.count).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
    });
    expect(result).toBe(true);
  });

  it("should return false when booking has no partial check-ins", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.count.mockResolvedValue(0);

    const result = await hasPartialCheckins("booking-1");

    expect(db.partialBookingCheckin.count).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
    });
    expect(result).toBe(false);
  });
});

describe("getPartialCheckinHistory", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return partial check-in history", () => {
    expect.assertions(2);
    const mockHistory = [
      {
        id: "partial-1",
        bookingId: "booking-1",
        assetIds: ["asset-1", "asset-2"],
        checkinCount: 2,
        checkinTimestamp: new Date(),
        checkedInBy: {
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
        },
      },
    ];
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockReturnValue(mockHistory);

    const result = getPartialCheckinHistory("booking-1");

    expect(db.partialBookingCheckin.findMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
      include: {
        checkedInBy: {
          select: {
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: { checkinTimestamp: "desc" },
    });
    expect(result).toEqual(mockHistory);
  });
});

describe("getTotalPartialCheckinCount", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return total count of checked-in assets", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.aggregate.mockResolvedValue({
      _sum: { checkinCount: 15 },
    });

    const result = await getTotalPartialCheckinCount("booking-1");

    expect(db.partialBookingCheckin.aggregate).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
      _sum: { checkinCount: true },
    });
    expect(result).toBe(15);
  });

  it("should return 0 when no partial check-ins exist", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.aggregate.mockResolvedValue({
      _sum: { checkinCount: null },
    });

    const result = await getTotalPartialCheckinCount("booking-1");

    expect(result).toBe(0);
  });
});

describe("getPartiallyCheckedInAssetIds", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return unique asset IDs from partial check-ins", async () => {
    expect.assertions(2);
    const mockPartialCheckins = [
      { assetIds: ["asset-1", "asset-2"] },
      { assetIds: ["asset-2", "asset-3"] },
      { assetIds: ["asset-4"] },
    ];
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue(mockPartialCheckins);

    const result = await getPartiallyCheckedInAssetIds("booking-1");

    expect(db.partialBookingCheckin.findMany).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
      select: { assetIds: true },
    });
    expect(result).toEqual(["asset-1", "asset-2", "asset-3", "asset-4"]);
  });

  it("should return empty array when no partial check-ins exist", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);

    const result = await getPartiallyCheckedInAssetIds("booking-1");

    expect(result).toEqual([]);
  });
});

describe("getKitIdsByAssets", () => {
  it("should return unique kit IDs from assets", () => {
    const assets = [
      { id: "asset-1", kitId: "kit-1" },
      { id: "asset-2", kitId: "kit-1" },
      { id: "asset-3", kitId: "kit-2" },
      { id: "asset-4", kitId: null },
    ];

    const result = getKitIdsByAssets(assets);

    expect(result).toEqual(["kit-1", "kit-2"]);
  });

  it("should return empty array when no kits present", () => {
    const assets = [
      { id: "asset-1", kitId: null },
      { id: "asset-2", kitId: null },
    ];

    const result = getKitIdsByAssets(assets);

    expect(result).toEqual([]);
  });
});

describe("updateBasicBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockUpdateBookingParams = {
    id: "booking-1",
    organizationId: "org-1",
    name: "Updated Booking Name",
    description: "Updated Description",
    from: new Date("2024-02-01T09:00:00Z"),
    to: new Date("2024-02-01T17:00:00Z"),
    custodianUserId: "user-2",
    custodianTeamMemberId: "team-member-2",
    tags: [{ id: "tag-1" }, { id: "tag-2" }],
  };

  it("should update booking successfully when status is DRAFT", async () => {
    expect.assertions(2);

    // Mock finding booking with DRAFT status
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "user-1",
      tags: [{ id: "tag-3", name: "Old Tag" }], // Add existing tags
    });

    const updatedBooking = { ...mockBookingData, ...mockUpdateBookingParams };
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(updatedBooking);

    const result = await updateBasicBooking(mockUpdateBookingParams);

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: {
        name: "Updated Booking Name",
        description: "Updated Description",
        from: new Date("2024-02-01T09:00:00Z"),
        to: new Date("2024-02-01T17:00:00Z"),
        originalFrom: new Date("2024-02-01T09:00:00Z"),
        originalTo: new Date("2024-02-01T17:00:00Z"),
        custodianUser: { connect: { id: "user-2" } },
        custodianTeamMember: { connect: { id: "team-member-2" } },
        tags: {
          set: [],
          connect: [{ id: "tag-1" }, { id: "tag-2" }],
        },
      },
    });
    expect(result).toEqual(updatedBooking);
  });

  it("should update only name and description when status is not DRAFT", async () => {
    expect.assertions(2);

    // Mock finding booking with ONGOING status
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.ONGOING,
      custodianUserId: "user-1",
      tags: [{ id: "tag-3", name: "Old Tag" }], // Add existing tags
    });

    const updatedBooking = { ...mockBookingData, name: "Updated Booking Name" };
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(updatedBooking);

    const result = await updateBasicBooking(mockUpdateBookingParams);

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: {
        name: "Updated Booking Name",
        description: "Updated Description",
        tags: {
          set: [],
          connect: [{ id: "tag-1" }, { id: "tag-2" }],
        },
      },
    });
    expect(result).toEqual(updatedBooking);
  });

  it("should throw ShelfError when booking status is COMPLETE", async () => {
    expect.assertions(1);

    // Mock finding booking with COMPLETE status
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.COMPLETE,
      custodianUserId: "user-1",
    });

    await expect(updateBasicBooking(mockUpdateBookingParams)).rejects.toThrow(
      ShelfError
    );
  });

  it("should throw ShelfError when booking status is ARCHIVED", async () => {
    expect.assertions(1);

    // Mock finding booking with ARCHIVED status
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.ARCHIVED,
      custodianUserId: "user-1",
    });

    await expect(updateBasicBooking(mockUpdateBookingParams)).rejects.toThrow(
      ShelfError
    );
  });

  it("should throw ShelfError when booking status is CANCELLED", async () => {
    expect.assertions(1);

    // Mock finding booking with CANCELLED status
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.CANCELLED,
      custodianUserId: "user-1",
    });

    await expect(updateBasicBooking(mockUpdateBookingParams)).rejects.toThrow(
      ShelfError
    );
  });

  it("should throw ShelfError when booking is not found", async () => {
    expect.assertions(1);

    // Mock booking not found
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockRejectedValue(
      new Error("Booking not found")
    );

    await expect(updateBasicBooking(mockUpdateBookingParams)).rejects.toThrow(
      ShelfError
    );
  });

  it("should send email when changes are detected and hints are provided", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "custodian-1",
      custodianTeamMemberId: "team-member-1",
      name: "Old Name",
      description: "Old Description",
      from: futureFromDate,
      to: futureToDate,
      custodianUser: {
        id: "custodian-1",
        email: "custodian@example.com",
        firstName: "Custodian",
        lastName: "User",
      },
      custodianTeamMember: null,
      tags: [],
    });

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      id: "booking-1",
      name: "New Name",
    });

    await updateBasicBooking({
      ...mockUpdateBookingParams,
      name: "New Name",
      userId: "editor-1",
      hints: mockClientHints,
    });

    expect(sendBookingUpdatedEmail).toHaveBeenCalledTimes(1);
    expect(sendBookingUpdatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "editor-1",
        changes: expect.arrayContaining([
          expect.stringContaining("Booking name changed"),
        ]),
      })
    );
  });

  it("should not send email when no hints are provided", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "custodian-1",
      custodianTeamMemberId: "team-member-1",
      name: "Old Name",
      description: null,
      from: futureFromDate,
      to: futureToDate,
      custodianUser: {
        id: "custodian-1",
        email: "custodian@example.com",
        firstName: "Custodian",
        lastName: "User",
      },
      custodianTeamMember: null,
      tags: [],
    });

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    await updateBasicBooking({
      ...mockUpdateBookingParams,
      name: "New Name",
      userId: "editor-1",
      // no hints
    });

    expect(sendBookingUpdatedEmail).not.toHaveBeenCalled();
  });

  it("should not send email when no changes are detected", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "user-2",
      custodianTeamMemberId: "team-member-2",
      name: "Updated Booking Name",
      description: "Updated Description",
      from: new Date("2024-02-01T09:00:00Z"),
      to: new Date("2024-02-01T17:00:00Z"),
      custodianUser: {
        id: "user-2",
        email: "custodian@example.com",
        firstName: "Custodian",
        lastName: "User",
      },
      custodianTeamMember: { id: "team-member-2", name: "TM" },
      tags: [
        { id: "tag-1", name: "Tag 1" },
        { id: "tag-2", name: "Tag 2" },
      ],
    });

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    await updateBasicBooking({
      ...mockUpdateBookingParams,
      userId: "editor-1",
      hints: mockClientHints,
    });

    expect(sendBookingUpdatedEmail).not.toHaveBeenCalled();
  });

  it("should pass old custodian email when custodian changes", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "old-custodian-1",
      custodianTeamMemberId: "old-team-member-1",
      name: "Updated Booking Name",
      description: "Updated Description",
      from: new Date("2024-02-01T09:00:00Z"),
      to: new Date("2024-02-01T17:00:00Z"),
      custodianUser: {
        id: "old-custodian-1",
        email: "old-custodian@example.com",
        firstName: "Old",
        lastName: "Custodian",
      },
      custodianTeamMember: {
        id: "old-team-member-1",
        name: "Old TM",
        user: {
          id: "old-custodian-1",
          firstName: "Old",
          lastName: "Custodian",
        },
      },
      tags: [
        { id: "tag-1", name: "Tag 1" },
        { id: "tag-2", name: "Tag 2" },
      ],
    });

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    //@ts-expect-error missing vitest type
    db.teamMember.findUnique.mockResolvedValue({
      id: "team-member-2",
      name: "New TM",
      user: { id: "user-2", firstName: "New", lastName: "Custodian" },
    });

    await updateBasicBooking({
      ...mockUpdateBookingParams,
      userId: "editor-1",
      hints: mockClientHints,
    });

    expect(sendBookingUpdatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        oldCustodianEmail: "old-custodian@example.com",
      })
    );
  });
});

describe("updateBookingAssets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockUpdateBookingAssetsParams = {
    id: "booking-1",
    organizationId: "org-1",
    assetIds: ["asset-1", "asset-2"],
  };

  it("should update booking assets successfully for DRAFT booking", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    const result = await updateBookingAssets(mockUpdateBookingAssetsParams);

    expect(db.booking.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "booking-1", organizationId: "org-1" },
      select: { id: true, name: true, status: true },
    });
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(result).toEqual(mockBooking);
  });

  it("should update asset status to CHECKED_OUT for ONGOING booking", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    const result = await updateBookingAssets(mockUpdateBookingAssetsParams);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(result).toEqual(mockBooking);
  });

  it("should update asset status to CHECKED_OUT for OVERDUE booking", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.OVERDUE,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    const result = await updateBookingAssets(mockUpdateBookingAssetsParams);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(result).toEqual(mockBooking);
  });

  it("should update kit status to CHECKED_OUT when kitIds provided for ONGOING booking", async () => {
    expect.assertions(4);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    const params = {
      ...mockUpdateBookingAssetsParams,
      kitIds: ["kit-1", "kit-2"],
    };

    const result = await updateBookingAssets(params);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(db.kit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
      data: { status: KitStatus.CHECKED_OUT },
    });
    expect(result).toEqual(mockBooking);
  });

  it("should not update kit status when no kitIds provided", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    await updateBookingAssets(mockUpdateBookingAssetsParams);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalled();
    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  it("should not update kit status when empty kitIds array provided", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    const params = {
      ...mockUpdateBookingAssetsParams,
      kitIds: [],
    };

    await updateBookingAssets(params);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).toHaveBeenCalled();
    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  it("should not update asset or kit status for RESERVED booking", async () => {
    expect.assertions(3);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.RESERVED,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    const params = {
      ...mockUpdateBookingAssetsParams,
      kitIds: ["kit-1"],
    };

    await updateBookingAssets(params);

    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  it("should throw ShelfError when booking lookup fails", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockRejectedValue(new Error("Database error"));

    await expect(
      updateBookingAssets(mockUpdateBookingAssetsParams)
    ).rejects.toThrow(ShelfError);
  });

  it("should throw 400 ShelfError when all assets have been deleted", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    // why: simulate all requested assets being deleted from DB
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([]);

    await expect(
      updateBookingAssets(mockUpdateBookingAssetsParams)
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          "None of the selected assets exist. They may have been deleted.",
        status: 400,
      })
    );

    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("should throw 400 ShelfError when some assets have been deleted", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    // why: simulate one of two requested assets being deleted from DB
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1" }]);

    await expect(
      updateBookingAssets(mockUpdateBookingAssetsParams)
    ).rejects.toThrow(
      expect.objectContaining({
        message:
          "Some of the selected assets no longer exist. Please reload and try again.",
        status: 400,
      })
    );

    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it("should handle duplicate asset IDs without false validation failures", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    // why: simulate both unique assets existing — duplicates should be deduped
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    const params = {
      ...mockUpdateBookingAssetsParams,
      assetIds: ["asset-1", "asset-2", "asset-1"], // duplicate
    };

    const result = await updateBookingAssets(params);

    expect(result).toEqual(mockBooking);
    expect(db.$executeRaw).toHaveBeenCalled();
  });
});

describe("reserveBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockReserveParams = {
    id: "booking-1",
    name: "Reserved Booking",
    organizationId: "org-1",
    custodianUserId: "user-1",
    custodianTeamMemberId: "team-1",
    from: futureFromDate,
    to: futureToDate,
    description: "Reserved booking description",
    hints: mockClientHints,
    isSelfServiceOrBase: false,
    tags: [],
  };

  it("should reserve booking successfully with no conflicts", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.DRAFT,
      from: mockReserveParams.from,
      to: mockReserveParams.to,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            title: "Asset 1",
            status: "AVAILABLE",
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t101",
        },
        {
          asset: {
            id: "asset-2",
            title: "Asset 2",
            status: "AVAILABLE",
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t102",
        },
      ],
    };
    const reservedBooking = { ...mockBooking, status: BookingStatus.RESERVED };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(reservedBooking);

    const result = await reserveBooking(mockReserveParams);

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1" },
        data: expect.objectContaining({
          status: BookingStatus.RESERVED,
          name: "Reserved Booking",
          custodianUser: { connect: { id: "user-1" } },
          custodianTeamMember: { connect: { id: "team-1" } },
          from: futureFromDate,
          to: futureToDate,
          description: "Reserved booking description",
        }),
      })
    );
    expect(result).toEqual(reservedBooking);
  });

  it("should throw error when assets have booking conflicts", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.DRAFT,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            title: "Asset 1",
            status: "CHECKED_OUT",
            bookingAssets: [
              {
                booking: {
                  id: "other-booking",
                  status: "ONGOING",
                  name: "Conflicting Booking",
                },
              },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t103",
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(reserveBooking(mockReserveParams)).rejects.toThrow(
      "Cannot reserve booking. Some assets are already booked or checked out: Asset 1. Please remove conflicted assets and try again."
    );
  });

  it("should refuse to reserve a booking that isn't DRAFT", async () => {
    expect.assertions(2);

    // Previously the service happily ran on any status — that let a
    // stale tab write a spurious `Reserved → Reserved` transition note
    // (and re-send the reservation email). The guard now refuses any
    // non-DRAFT source status.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      from: mockReserveParams.from,
      to: mockReserveParams.to,
      bookingAssets: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(reserveBooking(mockReserveParams)).rejects.toThrow(
      /only DRAFT bookings can be reserved/i
    );
    // The guard fires before any write happens — no status flip, no
    // booking.update call.
    expect(db.booking.update).not.toHaveBeenCalled();
  });
});

describe("checkoutBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockCheckoutParams = {
    id: "booking-1",
    organizationId: "org-1",
    hints: mockClientHints,
    from: futureFromDate,
    to: futureToDate,
  };

  it("should checkout booking successfully with no conflicts", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            title: "Asset 1",
            status: "AVAILABLE",
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t104",
        },
        {
          asset: {
            id: "asset-2",
            kitId: "kit-1",
            title: "Asset 2",
            status: "AVAILABLE",
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t105",
        },
      ],
    };
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    /** findUniqueOrThrow is called twice: first for the pre-checkout
     * lookup, then for the post-commit hydration of the return payload. */
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce(hydratedBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    const result = await checkoutBooking(mockCheckoutParams);

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] } },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    /** Assert observable behavior: the result is the fully hydrated
     * booking returned by the post-commit findUniqueOrThrow. */
    expect(result).toEqual(hydratedBooking);
  });

  it("should throw error when assets have booking conflicts", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            title: "Asset 1",
            status: "CHECKED_OUT",
            bookingAssets: [
              {
                booking: {
                  id: "other-booking",
                  status: "ONGOING",
                  name: "Conflicting Booking",
                },
              },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t106",
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(checkoutBooking(mockCheckoutParams)).rejects.toThrow(
      "Cannot check out booking. Some assets are already booked or checked out: Asset 1. Please remove conflicted assets and try again."
    );
  });

  it("should handle checkout for non-reserved booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.DRAFT,
      bookingAssets: [], // No assets to conflict
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.ONGOING,
    });

    const result = await checkoutBooking(mockCheckoutParams);
    expect(result).toBeDefined();
  });

  /**
   * Phase 3d (Book-by-Model) — checkout guard for outstanding
   * BookingModelRequest rows. The guard must block RESERVED → ONGOING
   * whenever the booking still has model-level reservations that
   * haven't been materialised to concrete BookingAsset rows, and it
   * must let checkout proceed when every request has been drained.
   */
  it("should refuse checkout when model requests still have outstanding quantity", async () => {
    expect.assertions(4);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [], // No concrete assets; reservation is model-only
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // why: drives the new guard — two outstanding requests so we can
    // assert that both model names surface in the operator-readable msg.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        id: "mr-1",
        bookingId: "booking-1",
        assetModelId: "am-1",
        quantity: 2,
        assetModel: { name: "Dell Latitude 5550" },
      },
      {
        id: "mr-2",
        bookingId: "booking-1",
        assetModelId: "am-2",
        quantity: 3,
        assetModel: { name: "HP MX-500" },
      },
    ]);

    await expect(checkoutBooking(mockCheckoutParams)).rejects.toThrow(
      ShelfError
    );

    // Re-run to inspect the thrown ShelfError shape.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        id: "mr-1",
        bookingId: "booking-1",
        assetModelId: "am-1",
        quantity: 2,
        assetModel: { name: "Dell Latitude 5550" },
      },
      {
        id: "mr-2",
        bookingId: "booking-1",
        assetModelId: "am-2",
        quantity: 3,
        assetModel: { name: "HP MX-500" },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    try {
      await checkoutBooking(mockCheckoutParams);
    } catch (error) {
      const shelfError = error as ShelfError;
      expect(shelfError.status).toBe(400);
      expect(shelfError.message).toContain("Dell Latitude 5550");
      // Checkout must not flip the booking status when the guard fires.
      expect(db.booking.update).not.toHaveBeenCalled();
    }
  });

  it("should allow checkout when no model requests have outstanding quantity", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            title: "Asset 1",
            status: "AVAILABLE",
            bookingAssets: [],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t900",
        },
      ],
    };
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce(hydratedBooking);
    // why: no outstanding requests — guard must let the tx proceed.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    const result = await checkoutBooking(mockCheckoutParams);

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] } },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(result).toEqual(hydratedBooking);
  });
});

/**
 * Phase 3d-Polish — `fulfilModelRequestsAndCheckout` composes
 * `addScannedAssetsToBookingWithinTx` + `checkoutBookingWritesWithinTx` in
 * one atomic transaction so scan-materialisation and the checkout status
 * flip either commit together or roll back together. These tests pin down
 * the behaviour that matters for that composition — they don't re-cover
 * ground the individual helpers already cover in their own describes.
 */
describe("fulfilModelRequestsAndCheckout", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockFulfilParams = {
    bookingId: "booking-1",
    organizationId: "org-1",
    userId: "user-1",
    hints: mockClientHints,
    from: futureFromDate,
    to: futureToDate,
  };

  /**
   * `addScannedAssetsToBookingWithinTx` always calls `tx.booking.update`
   * to append BookingAssets (with `data.bookingAssets.create`). The
   * SEPARATE checkout-transition update carries `data.status`. Tests use
   * this helper to locate the latter call when asserting on status flips
   * or date adjustments.
   */
  function findStatusUpdateCall() {
    const calls = (db.booking.update as ReturnType<typeof vitest.fn>).mock
      .calls;
    return calls
      .map((c) => c[0])
      .find(
        (arg) =>
          arg?.data?.status === BookingStatus.ONGOING ||
          arg?.data?.status === BookingStatus.OVERDUE
      );
  }

  function hasStatusUpdate() {
    return findStatusUpdateCall() !== undefined;
  }

  /**
   * Build a pre-tx booking payload matching the service's expected shape,
   * including the `_count.bookingAssets` field that `runCheckoutSideEffects`
   * reads post-commit. Callers override `bookingAssets` + `from` as needed.
   */
  function buildPreTxBooking(overrides?: {
    from?: Date;
    bookingAssets?: Array<{
      asset: {
        id: string;
        kitId: string | null;
        title: string;
        status: AssetStatus;
        bookingAssets: Array<unknown>;
      };
      assetId: string;
      quantity: number;
      id: string;
    }>;
  }) {
    return {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      from: overrides?.from ?? futureFromDate,
      bookingAssets: overrides?.bookingAssets ?? [],
      _count: { bookingAssets: overrides?.bookingAssets?.length ?? 0 },
    };
  }

  it("should create BookingAssets + drain all requests + transition to ONGOING on happy path", async () => {
    expect.assertions(2);

    const mockBooking = buildPreTxBooking({
      bookingAssets: [
        {
          asset: {
            id: "hp-1",
            kitId: null,
            title: "HP LaserJet 2020",
            status: AssetStatus.AVAILABLE,
            bookingAssets: [],
          },
          assetId: "hp-1",
          quantity: 1,
          id: "ba-hp",
        },
      ],
    });
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce(hydratedBooking);
    // why: scanned asset metadata lookup inside the tx — the service needs
    // assetModelId for each scanned asset so materialize can match against
    // outstanding requests. Return the 3 Dells with a shared model id.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      {
        id: "dell-1",
        title: "Dell #1",
        type: AssetType.INDIVIDUAL,
        assetModelId: "am-dell",
      },
      {
        id: "dell-2",
        title: "Dell #2",
        type: AssetType.INDIVIDUAL,
        assetModelId: "am-dell",
      },
      {
        id: "dell-3",
        title: "Dell #3",
        type: AssetType.INDIVIDUAL,
        assetModelId: "am-dell",
      },
    ]);
    // why: post-scan snapshot inside the tx. All 4 BookingAssets are on the
    // booking by this point (1 pre-existing HP + 3 newly materialized Dells).
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        quantity: 1,
        asset: { id: "hp-1", title: "HP", type: AssetType.INDIVIDUAL },
      },
      {
        quantity: 1,
        asset: { id: "dell-1", title: "Dell #1", type: AssetType.INDIVIDUAL },
      },
      {
        quantity: 1,
        asset: { id: "dell-2", title: "Dell #2", type: AssetType.INDIVIDUAL },
      },
      {
        quantity: 1,
        asset: { id: "dell-3", title: "Dell #3", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: outstanding-request guard inside checkoutBookingWritesWithinTx
    // — empty result means materialize drained everything, so the guard
    // passes and the tx proceeds.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    const result = await fulfilModelRequestsAndCheckout({
      ...mockFulfilParams,
      assetIds: ["dell-1", "dell-2", "dell-3"],
    });

    // Observable outcome: status transition writes include all 4 asset ids
    // (pre-existing HP + 3 newly-scanned Dells) — this proves the post-scan
    // snapshot was used for the CHECKED_OUT update rather than the pre-tx
    // asset list.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["hp-1", "dell-1", "dell-2", "dell-3"] } },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(result).toEqual(hydratedBooking);
  });

  it("should roll back the whole tx when requests remain outstanding after scanning", async () => {
    expect.assertions(3);

    const mockBooking = buildPreTxBooking();

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      {
        id: "dell-1",
        title: "Dell #1",
        type: AssetType.INDIVIDUAL,
        assetModelId: "am-dell",
      },
    ]);
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        quantity: 1,
        asset: { id: "dell-1", title: "Dell #1", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: 2 Dell units still outstanding after the operator only scanned 1
    // — the in-tx guard must refuse the status transition to ONGOING.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        id: "mr-1",
        bookingId: "booking-1",
        assetModelId: "am-dell",
        quantity: 2,
        assetModel: { name: "Dell Latitude 5550" },
      },
    ]);

    await expect(
      fulfilModelRequestsAndCheckout({
        ...mockFulfilParams,
        assetIds: ["dell-1"],
      })
    ).rejects.toThrow(ShelfError);

    // Rollback semantics: the callback-style `$transaction` mock doesn't
    // simulate rollback, so the in-tx `booking.update` that appends the
    // scanned BookingAsset DOES fire. What must NOT fire is the
    // checkout-transition: no status flip to ONGOING, and no CHECKED_OUT
    // asset update — those live downstream of the outstanding-request guard.
    expect(hasStatusUpdate()).toBe(false);
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("should rewrite booking.from and set originalFrom when checkoutIntentChoice = with-adjusted-date", async () => {
    expect.assertions(4);

    const mockBooking = buildPreTxBooking({
      bookingAssets: [
        {
          asset: {
            id: "hp-1",
            kitId: null,
            title: "HP",
            status: AssetStatus.AVAILABLE,
            bookingAssets: [],
          },
          assetId: "hp-1",
          quantity: 1,
          id: "ba-hp",
        },
      ],
    });
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce(hydratedBooking);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      []
    );
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        quantity: 1,
        asset: { id: "hp-1", title: "HP", type: AssetType.INDIVIDUAL },
      },
    ]);
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    const nowBeforeCall = Date.now();
    await fulfilModelRequestsAndCheckout({
      ...mockFulfilParams,
      assetIds: [],
      // why: explicit user choice to pull the start-date forward. The service
      // must write `originalFrom` = the old future date AND a fresh `from`
      // close to "now".
      checkoutIntentChoice: "with-adjusted-date" as never,
    });

    const updateCall = findStatusUpdateCall();
    expect(updateCall?.data?.originalFrom).toEqual(futureFromDate);

    const rewrittenFrom = updateCall?.data?.from as Date;
    // Rewritten `from` must move the start meaningfully forward from the
    // original future booking window (the whole point of "Adjust Date").
    // We don't pin to a tight "close to now" window because the service
    // round-trips the date through `DATE_TIME_FORMAT` which truncates
    // precision and can drift several seconds near minute boundaries —
    // the invariant that matters is "much earlier than the 30-day-out
    // original" and "not absurdly wrong".
    expect(rewrittenFrom.getTime()).toBeLessThan(futureFromDate.getTime());
    expect(Math.abs(rewrittenFrom.getTime() - nowBeforeCall)).toBeLessThan(
      5 * 60 * 1000
    );
    expect(updateCall?.data?.status).toBe(BookingStatus.ONGOING);
  });

  it("should NOT rewrite booking.from when checkoutIntentChoice = without-adjusted-date", async () => {
    expect.assertions(2);

    const mockBooking = buildPreTxBooking({
      bookingAssets: [
        {
          asset: {
            id: "hp-1",
            kitId: null,
            title: "HP",
            status: AssetStatus.AVAILABLE,
            bookingAssets: [],
          },
          assetId: "hp-1",
          quantity: 1,
          id: "ba-hp",
        },
      ],
    });
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce(hydratedBooking);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce(
      []
    );
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        quantity: 1,
        asset: { id: "hp-1", title: "HP", type: AssetType.INDIVIDUAL },
      },
    ]);
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    await fulfilModelRequestsAndCheckout({
      ...mockFulfilParams,
      assetIds: [],
      checkoutIntentChoice: "without-adjusted-date" as never,
    });

    const updateCall = findStatusUpdateCall();
    // "Don't Adjust Date" must leave the original `from` + `originalFrom`
    // untouched — the booking window is preserved even though checkout
    // happened early.
    expect(updateCall?.data?.originalFrom).toBeUndefined();
    expect(updateCall?.data?.from).toBeUndefined();
  });

  it("should fire the outstanding-request guard when operator scans only off-model assets", async () => {
    expect.assertions(2);

    const mockBooking = buildPreTxBooking();

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // Scanned asset is a Bomag — doesn't match the outstanding Dell request.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      {
        id: "bomag-1",
        title: "Bomag",
        type: AssetType.INDIVIDUAL,
        assetModelId: "am-bomag",
      },
    ]);
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        quantity: 1,
        asset: { id: "bomag-1", title: "Bomag", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: Dell request still at quantity 2 because the Bomag scan didn't
    // match its assetModelId — the guard must surface the Dell shortfall,
    // not the Bomag's presence.
    (
      db.bookingModelRequest.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        id: "mr-1",
        bookingId: "booking-1",
        assetModelId: "am-dell",
        quantity: 2,
        assetModel: { name: "Dell Latitude 5550" },
      },
    ]);

    try {
      await fulfilModelRequestsAndCheckout({
        ...mockFulfilParams,
        assetIds: ["bomag-1"],
      });
      throw new Error("should have thrown");
    } catch (error) {
      const shelfError = error as ShelfError;
      // Error must name the still-outstanding Dell model, not the Bomag that
      // was scanned — confirms the guard reads the request table, not the
      // scanned set.
      expect(shelfError.message).toContain("Dell Latitude 5550");
      // Checkout-transition never happened: the BookingAsset append
      // (`data.bookingAssets.create`) may land in the unrolled mock tx, but
      // the status flip must not.
      expect(hasStatusUpdate()).toBe(false);
    }
  });
});

describe("checkinBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  const mockCheckinParams = {
    id: "booking-1",
    organizationId: "org-1",
    hints: mockClientHints,
  };

  it("should checkin booking successfully", async () => {
    expect.assertions(3);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t107",
        },
        {
          asset: {
            id: "asset-2",
            kitId: "kit-1",
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t108",
        },
      ],
      partialCheckins: [],
    };
    const checkedInBooking = { ...mockBooking, status: BookingStatus.COMPLETE };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(checkedInBooking);

    const result = await checkinBooking(mockCheckinParams);

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1", "asset-2"] }, type: AssetType.INDIVIDUAL },
      data: { status: AssetStatus.AVAILABLE },
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: BookingStatus.COMPLETE },
      include: expect.any(Object),
    });

    expect(result).toEqual(checkedInBooking);
  });

  it("should reset checked out assets even when partial check-in history exists", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.OVERDUE,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t201",
        },
        {
          asset: {
            id: "asset-2",
            kitId: "kit-1",
            status: AssetStatus.AVAILABLE,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t202",
        },
      ],
      partialCheckins: [
        {
          assetIds: ["asset-1"],
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    await checkinBooking(mockCheckinParams);

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] }, type: AssetType.INDIVIDUAL },
      data: { status: AssetStatus.AVAILABLE },
    });
  });

  it("should not reset assets that are checked out in another active booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.OVERDUE,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
              { booking: { id: "booking-2", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t203",
        },
      ],
      partialCheckins: [
        {
          assetIds: ["asset-1"],
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    await checkinBooking(mockCheckinParams);

    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("should reset asset when it was partially checked in from another ongoing booking", async () => {
    // why: Mock database queries to simulate the bug scenario where an asset
    // is partially returned from one booking and then used in another booking
    expect.assertions(1);

    // Scenario:
    // - Booking A (booking-a, ONGOING) has Asset 1 and Asset 2
    // - Asset 2 was partially checked in from Booking A (now AVAILABLE)
    // - Booking B (booking-b, being checked in) has Asset 2 and Asset 3
    // - When Booking B is checked in, Asset 2 should become AVAILABLE
    // - because it's not actively being used in Booking A anymore
    const mockBooking = {
      ...mockBookingData,
      id: "booking-b",
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-2",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-b", status: BookingStatus.ONGOING } },
              { booking: { id: "booking-a", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t109",
        },
        {
          asset: {
            id: "asset-3",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-b", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t110",
        },
      ],
      partialCheckins: [], // No partial check-ins for Booking B
    };

    // Mock partial check-ins for the linked Booking A
    // Asset 2 was already checked in from Booking A
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        bookingId: "booking-a",
        assetIds: ["asset-2"],
      },
    ]);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    await checkinBooking(mockCheckinParams);

    // Both assets should be reset to AVAILABLE because:
    // - Asset 2: was already checked in from Booking A, so no conflict
    // - Asset 3: no other bookings, so no conflict
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["asset-2", "asset-3"],
        },
        type: AssetType.INDIVIDUAL,
      },
      data: { status: AssetStatus.AVAILABLE },
    });
  });

  it("should reset all assets (kit + singular) even when singular is in partial check-in history", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.OVERDUE,
      bookingAssets: [
        {
          asset: {
            id: "kit-asset-1",
            kitId: "kit-1",
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "kit-asset-1",
          quantity: 1,
          id: "ba-t111",
        },
        {
          asset: {
            id: "kit-asset-2",
            kitId: "kit-1",
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "kit-asset-2",
          quantity: 1,
          id: "ba-t112",
        },
        {
          asset: {
            id: "kit-asset-3",
            kitId: "kit-1",
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "kit-asset-3",
          quantity: 1,
          id: "ba-t113",
        },
        {
          asset: {
            id: "singular-asset",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.OVERDUE } },
            ],
          },
          assetId: "singular-asset",
          quantity: 1,
          id: "ba-t114",
        },
      ],
      partialCheckins: [
        {
          assetIds: ["singular-asset"],
        },
      ],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    await checkinBooking(mockCheckinParams);

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["kit-asset-1", "kit-asset-2", "kit-asset-3", "singular-asset"],
        },
        type: AssetType.INDIVIDUAL,
      },
      data: { status: AssetStatus.AVAILABLE },
    });
  });

  it("should handle checkin for non-ongoing booking", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.DRAFT };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    const result = await checkinBooking(mockCheckinParams);
    expect(result).toBeDefined();
  });

  it("should schedule auto-archive when enabled", async () => {
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t115",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveBookings: true,
      autoArchiveDays: 3,
    });

    await checkinBooking(mockCheckinParams);

    expect(scheduler.sendAfter).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        id: "booking-1",
        eventType: "booking-auto-archive-handler",
      }),
      expect.any(Object),
      expect.any(Date)
    );
  });

  it("should not schedule auto-archive when disabled", async () => {
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t204",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue({
      autoArchiveBookings: false,
      autoArchiveDays: 3,
    });

    await checkinBooking(mockCheckinParams);

    expect(scheduler.sendAfter).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        eventType: "booking-auto-archive-handler",
      }),
      expect.any(Object),
      expect.any(Date)
    );
  });

  it("should not schedule auto-archive when settings not found", async () => {
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t205",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });
    //@ts-expect-error missing vitest type
    db.bookingSettings.findUnique.mockResolvedValue(null);

    await checkinBooking(mockCheckinParams);

    expect(scheduler.sendAfter).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        eventType: "booking-auto-archive-handler",
      }),
      expect.any(Object),
      expect.any(Date)
    );
  });
});

describe("archiveBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should archive booking successfully", async () => {
    expect.assertions(2);

    const mockBooking = { ...mockBookingData, status: BookingStatus.COMPLETE };
    const archivedBooking = { ...mockBooking, status: BookingStatus.ARCHIVED };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(archivedBooking);

    const result = await archiveBooking({
      id: "booking-1",
      organizationId: "org-1",
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: BookingStatus.ARCHIVED },
    });
    expect(result).toEqual(archivedBooking);
  });

  it("should throw error when booking is not COMPLETE", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.ONGOING };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      archiveBooking({ id: "booking-1", organizationId: "org-1" })
    ).rejects.toThrow(ShelfError);
  });

  it("should cancel pending auto-archive job on manual archive", async () => {
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.COMPLETE,
      activeSchedulerReference: "job-123",
    };
    const archivedBooking = { ...mockBooking, status: BookingStatus.ARCHIVED };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(archivedBooking);

    await archiveBooking({ id: "booking-1", organizationId: "org-1" });

    expect(scheduler.cancel).toHaveBeenCalledWith("job-123");
  });

  it("should handle archive when no scheduler reference exists", async () => {
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.COMPLETE,
      activeSchedulerReference: null,
    };
    const archivedBooking = { ...mockBooking, status: BookingStatus.ARCHIVED };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(archivedBooking);

    await archiveBooking({ id: "booking-1", organizationId: "org-1" });

    expect(scheduler.cancel).not.toHaveBeenCalled();
  });
});

describe("cancelBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should cancel booking successfully", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: { id: "asset-1", kitId: null },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t116",
        },
      ],
    };
    const cancelledBooking = {
      ...mockBooking,
      status: BookingStatus.CANCELLED,
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(cancelledBooking);

    const result = await cancelBooking({
      id: "booking-1",
      organizationId: "org-1",
      hints: mockClientHints,
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: BookingStatus.CANCELLED },
      include: expect.any(Object),
    });
    expect(result).toEqual(cancelledBooking);
  });

  it("should throw error when booking is already COMPLETE", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.COMPLETE };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      cancelBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: mockClientHints,
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("deleteBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should delete booking successfully", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUnique.mockResolvedValue(mockBookingData);
    //@ts-expect-error missing vitest type
    db.booking.delete.mockResolvedValue(mockBookingData);

    await deleteBooking(
      { id: "booking-1", organizationId: "org-1" },
      mockClientHints,
      "user-1"
    );

    expect(db.booking.findUnique).toHaveBeenCalled();
  });
});

describe("getBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should get booking successfully", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(mockBookingData);

    const mockRequest = new Request("http://localhost/bookings/booking-1");

    const result = await getBooking({
      id: "booking-1",
      organizationId: "org-1",
      request: mockRequest,
    });

    expect(result).toEqual(mockBookingData);
  });

  it("should handle booking not found", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockRejectedValue(new Error("Not found"));

    const mockRequest = new Request("http://localhost/bookings/booking-1");

    try {
      await getBooking({
        id: "booking-1",
        organizationId: "org-1",
        request: mockRequest,
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe("duplicateBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should duplicate booking successfully", async () => {
    expect.assertions(2);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-1" },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t117",
        },
        {
          asset: { id: "asset-2" },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t118",
        },
      ],
      tags: [{ id: "tag-1" }],
    };
    const duplicatedBooking = {
      ...originalBooking,
      id: "booking-2",
      name: "Copy of Test Booking",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(duplicatedBooking);

    const result = await duplicateBooking({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
      request: new Request("https://example.com"),
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test Booking (Copy)",
          status: BookingStatus.DRAFT,
          organizationId: "org-1",
          creatorId: "user-1",
        }),
      })
    );
    expect(result).toEqual(duplicatedBooking);
  });
});

describe("revertBookingToDraft", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should revert booking to draft successfully", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: { id: "asset-1", kitId: null },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t119",
        },
      ],
    };
    const draftBooking = { ...mockBooking, status: BookingStatus.DRAFT };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(draftBooking);

    const result = await revertBookingToDraft({
      id: "booking-1",
      organizationId: "org-1",
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: BookingStatus.DRAFT },
    });
    expect(result).toEqual(draftBooking);
  });

  it("should throw error when booking cannot be reverted", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.COMPLETE };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      revertBookingToDraft({ id: "booking-1", organizationId: "org-1" })
    ).rejects.toThrow(ShelfError);
  });
});

describe("extendBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should extend booking successfully", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t120",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t121",
        },
      ],
      partialCheckins: [],
    };
    const extendedBooking = {
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(extendedBooking);

    const result = await extendBooking({
      id: "booking-1",
      organizationId: "org-1",
      newEndDate: new Date("2025-01-02T17:00:00Z"),
      hints: mockClientHints,
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "booking-1" },
        data: expect.objectContaining({
          to: expect.any(Date),
        }),
        include: expect.any(Object),
      })
    );
    expect(result).toEqual(extendedBooking);
  });

  it("should throw error when booking cannot be extended", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.COMPLETE };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should allow self service user to extend their own booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      creatorId: "user-1",
      custodianUserId: "user-1",
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t122",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    });

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).resolves.toBeDefined();
  });

  it("should prevent self service user from extending others booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      creatorId: "user-2",
      custodianUserId: "user-2",
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should prevent base user from extending any booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.BASE,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should allow owner to extend any booking", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      creatorId: "user-2", // Different user created it
      custodianUserId: "user-2", // Different user is custodian
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t123",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No conflicts
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    });

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1", // Different user (OWNER)
        role: OrganizationRoles.OWNER,
      })
    ).resolves.toBeDefined();
  });

  it("should allow self service user who is custodian (not creator) to extend", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      creatorId: "user-2", // Different creator
      custodianUserId: "user-1", // But user is custodian
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t124",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No conflicts
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    });

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).resolves.toBeDefined();
  });

  it("should allow self service user who is creator (not custodian) to extend", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      creatorId: "user-1", // User is creator
      custodianUserId: "user-2", // But different custodian
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t125",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No conflicts
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    });

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).resolves.toBeDefined();
  });

  it("should prevent extension when clashing bookings exist", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t126",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t127",
        },
      ],
      partialCheckins: [],
    };

    const clashingBooking = {
      id: "booking-2",
      name: "Conflicting Booking",
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([clashingBooking]); // Clashing booking exists

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-03T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(
      "Cannot extend booking because the extended period is overlapping"
    );
  });

  it("should allow extension when no clashing bookings exist", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t128",
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No clashing bookings
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      to: new Date("2025-01-02T17:00:00Z"),
    });

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-02T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).resolves.toBeDefined();
  });

  it("should transition OVERDUE booking to ONGOING when extended", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.OVERDUE,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t129",
        },
      ],
      partialCheckins: [],
    };

    const extendedBooking = {
      ...mockBooking,
      status: BookingStatus.ONGOING, // Should transition to ONGOING
      to: new Date("2025-01-02T17:00:00Z"),
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No conflicts
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(extendedBooking);

    const result = await extendBooking({
      id: "booking-1",
      organizationId: "org-1",
      newEndDate: new Date("2025-01-02T17:00:00Z"),
      hints: mockClientHints,
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: BookingStatus.ONGOING,
          to: expect.any(Date),
        }),
      })
    );
    expect(result.status).toBe(BookingStatus.ONGOING);
  });

  it("should extend partially returned booking when returned assets have no conflicts", async () => {
    expect.assertions(3);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.AVAILABLE },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t130",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t131",
        },
        {
          asset: { id: "asset-3", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t132",
        },
      ],
      partialCheckins: [{ assetIds: ["asset-1"] }],
    };

    const extendedBooking = {
      ...mockBooking,
      to: new Date("2025-01-03T17:00:00Z"),
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]); // No conflicts
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(extendedBooking);

    const result = await extendBooking({
      id: "booking-1",
      organizationId: "org-1",
      newEndDate: new Date("2025-01-03T17:00:00Z"),
      hints: mockClientHints,
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    // Should only check conflicts for asset-2 and asset-3 (not asset-1)
    expect(db.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingAssets: { some: { assetId: { in: ["asset-2", "asset-3"] } } },
        }),
      })
    );

    expect(db.booking.update).toHaveBeenCalled();
    expect(result).toEqual(extendedBooking);
  });

  it("should extend booking successfully when returned asset has conflict but active assets don't", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.AVAILABLE },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t133",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t134",
        },
      ],
      partialCheckins: [{ assetIds: ["asset-1"] }],
    };

    const extendedBooking = {
      ...mockBooking,
      to: new Date("2025-01-03T17:00:00Z"),
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // asset-1 is booked elsewhere, but it's returned so shouldn't block
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(extendedBooking);

    const result = await extendBooking({
      id: "booking-1",
      organizationId: "org-1",
      newEndDate: new Date("2025-01-03T17:00:00Z"),
      hints: mockClientHints,
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    // Should succeed - returned asset conflicts are ignored
    expect(db.booking.update).toHaveBeenCalled();
    expect(result).toEqual(extendedBooking);
  });

  it("should prevent extension when active (non-returned) asset has conflict", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.AVAILABLE },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t135",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t136",
        },
      ],
      partialCheckins: [{ assetIds: ["asset-1"] }],
    };

    const clashingBooking = {
      id: "booking-2",
      name: "Conflicting Booking for Asset 2",
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // asset-2 (active) has a conflict
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([clashingBooking]);

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-03T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(
      "Cannot extend booking because the extended period is overlapping"
    );
  });

  it("should prevent extension when all assets are returned", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      to: new Date("2025-01-01T17:00:00Z"),
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.AVAILABLE },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t137",
        },
        {
          asset: { id: "asset-2", status: AssetStatus.AVAILABLE },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t138",
        },
        {
          asset: { id: "asset-3", status: AssetStatus.AVAILABLE },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t139",
        },
      ],
      partialCheckins: [{ assetIds: ["asset-1", "asset-2", "asset-3"] }],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      extendBooking({
        id: "booking-1",
        organizationId: "org-1",
        newEndDate: new Date("2025-01-03T17:00:00Z"),
        hints: mockClientHints,
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(
      "Cannot extend booking. All assets have been returned. Please complete the booking instead."
    );
  });
});

describe("removeAssets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should remove assets from booking successfully", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      assetIds: ["asset-1", "asset-2"],
    };

    //@ts-expect-error missing vitest type
    db.bookingAsset.deleteMany.mockResolvedValue({ count: 2 });
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBooking,
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    });

    await removeAssets({
      booking: mockBooking,
      firstName: "Test",
      lastName: "User",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: "booking-1",
        assetId: { in: ["asset-1", "asset-2"] },
      },
    });
    expect(db.booking.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "booking-1", organizationId: "org-1" },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
  });
});

describe("wrapBookingStatusForNote", () => {
  it("should wrap booking status without custodianUserId", () => {
    const result = wrapBookingStatusForNote("DRAFT");
    expect(result).toBe('{% booking_status status="DRAFT" /%}');
  });

  it("should wrap booking status with custodianUserId", () => {
    const result = wrapBookingStatusForNote("RESERVED", "user-123");
    expect(result).toBe(
      '{% booking_status status="RESERVED" custodianUserId="user-123" /%}'
    );
  });

  it("should handle empty custodianUserId", () => {
    const result = wrapBookingStatusForNote("ONGOING", "");
    expect(result).toBe('{% booking_status status="ONGOING" /%}');
  });

  it("should handle undefined custodianUserId", () => {
    const result = wrapBookingStatusForNote("COMPLETE");
    expect(result).toBe('{% booking_status status="COMPLETE" /%}');
  });

  it("should handle all booking statuses", () => {
    const statuses = [
      "DRAFT",
      "RESERVED",
      "ONGOING",
      "OVERDUE",
      "COMPLETE",
      "CANCELLED",
      "ARCHIVED",
    ];

    statuses.forEach((status) => {
      const result = wrapBookingStatusForNote(status);
      expect(result).toBe(`{% booking_status status="${status}" /%}`);
    });
  });
});

describe("getActionTextFromTransition", () => {
  it("should return correct action text for DRAFT->RESERVED transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.DRAFT,
      BookingStatus.RESERVED
    );
    expect(result).toBe("reserved the booking");
  });

  it("should return correct action text for RESERVED->ONGOING transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.RESERVED,
      BookingStatus.ONGOING
    );
    expect(result).toBe("checked-out the booking");
  });

  it("should return correct action text for ONGOING->COMPLETE transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.ONGOING,
      BookingStatus.COMPLETE
    );
    expect(result).toBe("checked-in the booking");
  });

  it("should return correct action text for RESERVED->CANCELLED transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.RESERVED,
      BookingStatus.CANCELLED
    );
    expect(result).toBe("cancelled the booking");
  });

  it("should return correct action text for ONGOING->CANCELLED transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.ONGOING,
      BookingStatus.CANCELLED
    );
    expect(result).toBe("cancelled the booking");
  });

  it("should return correct action text for OVERDUE->CANCELLED transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.OVERDUE,
      BookingStatus.CANCELLED
    );
    expect(result).toBe("cancelled the booking");
  });

  it("should return correct action text for COMPLETE->ARCHIVED transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.COMPLETE,
      BookingStatus.ARCHIVED
    );
    expect(result).toBe("archived the booking");
  });

  it("should return correct action text for RESERVED->DRAFT transition", () => {
    const result = getActionTextFromTransition(
      BookingStatus.RESERVED,
      BookingStatus.DRAFT
    );
    expect(result).toBe("reverted booking to draft");
  });

  it("should return fallback action text for unknown transitions", () => {
    const result = getActionTextFromTransition(
      BookingStatus.DRAFT,
      BookingStatus.COMPLETE
    );
    expect(result).toBe("changed the booking status");
  });
});

describe("getSystemActionText", () => {
  it("should return correct system action text for ONGOING->OVERDUE transition", () => {
    const result = getSystemActionText(
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE
    );
    expect(result).toBe("Booking became overdue");
  });

  it("should return fallback system action text for unknown transitions", () => {
    const result = getSystemActionText(
      BookingStatus.DRAFT,
      BookingStatus.RESERVED
    );
    expect(result).toBe("Booking status changed");
  });

  it("should return correct system action text for all booking statuses", () => {
    // Test that the function handles all status combinations gracefully
    const statuses = [
      BookingStatus.DRAFT,
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.COMPLETE,
      BookingStatus.CANCELLED,
      BookingStatus.ARCHIVED,
    ];

    statuses.forEach((fromStatus) => {
      statuses.forEach((toStatus) => {
        if (fromStatus !== toStatus) {
          const result = getSystemActionText(fromStatus, toStatus);
          expect(typeof result).toBe("string");
          expect(result.length).toBeGreaterThan(0);
        }
      });
    });
  });
});

// Note: createStatusTransitionNote is well-tested through integration tests above
// The function is used by reserveBooking, checkoutBooking, checkinBooking, cancelBooking,
// archiveBooking, revertBookingToDraft, and bulkCancelBookings/bulkArchiveBookings

describe("getOngoingBookingForAsset", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return booking when asset is checked out in an ONGOING booking", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
      organizationId: "org-1",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(mockBooking);

    const result = await getOngoingBookingForAsset({
      assetId: "asset-1",
      organizationId: "org-1",
    });

    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-1" } },
        partialCheckins: { none: { assetIds: { has: "asset-1" } } },
      },
    });
    expect(result).toEqual(mockBooking);
  });

  it("should return booking when asset is checked out in an OVERDUE booking", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-2",
      name: "Overdue Booking",
      status: BookingStatus.OVERDUE,
      organizationId: "org-1",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(mockBooking);

    const result = await getOngoingBookingForAsset({
      assetId: "asset-2",
      organizationId: "org-1",
    });

    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-2" } },
        partialCheckins: { none: { assetIds: { has: "asset-2" } } },
      },
    });
    expect(result).toEqual(mockBooking);
  });

  it("should return null when asset is partially checked in", async () => {
    expect.assertions(2);

    // Mock that no booking is found because the asset is partially checked in
    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(null);

    const result = await getOngoingBookingForAsset({
      assetId: "asset-3",
      organizationId: "org-1",
    });

    // Verify the query excludes bookings where asset is in partialCheckins
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-3" } },
        partialCheckins: { none: { assetIds: { has: "asset-3" } } },
      },
    });
    expect(result).toBeNull();
  });

  it("should return null when asset is not in any ONGOING or OVERDUE booking", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(null);

    const result = await getOngoingBookingForAsset({
      assetId: "asset-4",
      organizationId: "org-1",
    });

    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-4" } },
        partialCheckins: { none: { assetIds: { has: "asset-4" } } },
      },
    });
    expect(result).toBeNull();
  });

  it("should only consider ONGOING and OVERDUE bookings, not RESERVED or DRAFT", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(null);

    await getOngoingBookingForAsset({
      assetId: "asset-5",
      organizationId: "org-1",
    });

    // Verify that only ONGOING and OVERDUE statuses are queried
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-5" } },
        partialCheckins: { none: { assetIds: { has: "asset-5" } } },
      },
    });
  });

  it("should filter by organization ID to ensure org isolation", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(null);

    await getOngoingBookingForAsset({
      assetId: "asset-6",
      organizationId: "org-2",
    });

    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-2",
        bookingAssets: { some: { assetId: "asset-6" } },
        partialCheckins: { none: { assetIds: { has: "asset-6" } } },
      },
    });
  });

  it("should throw ShelfError when database query fails", async () => {
    expect.assertions(1);

    const dbError = new Error("Database connection error");
    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockRejectedValue(dbError);

    await expect(
      getOngoingBookingForAsset({
        assetId: "asset-7",
        organizationId: "org-1",
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should handle scenario where asset is checked in one booking but checked out in another", async () => {
    expect.assertions(2);

    // This is the key bug scenario: asset is checked in one booking (has partial checkin)
    // and checked out in another. The function should return the booking where it's checked out.
    const checkedOutBooking = {
      id: "booking-checked-out",
      name: "Checked Out Booking",
      status: BookingStatus.ONGOING,
      organizationId: "org-1",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(checkedOutBooking);

    const result = await getOngoingBookingForAsset({
      assetId: "asset-8",
      organizationId: "org-1",
    });

    // The query should exclude bookings where asset has partial checkin
    // so we get the right booking
    expect(db.booking.findFirst).toHaveBeenCalledWith({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId: "org-1",
        bookingAssets: { some: { assetId: "asset-8" } },
        partialCheckins: { none: { assetIds: { has: "asset-8" } } },
      },
    });
    expect(result).toEqual(checkedOutBooking);
  });
});

/* -------------------------------------------------------------------------- */
/*                  Phase 3c — Quantity-aware check-in tests                  */
/* -------------------------------------------------------------------------- */

describe("computeBookingAssetRemaining", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns booked minus logged sum across disposition categories", async () => {
    expect.assertions(1);

    // why: pivot row exists for this (booking, asset) pair with 10 booked.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });
    // why: aggregate of RETURN+CONSUME+LOSS+DAMAGE logs totals 3 units.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });

    const remaining = await computeBookingAssetRemaining(
      db,
      "booking-1",
      "asset-1"
    );

    expect(remaining).toBe(7);
  });

  it("clamps to zero when logs exceed booked quantity", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 5 });
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 8 } });

    const remaining = await computeBookingAssetRemaining(
      db,
      "booking-1",
      "asset-1"
    );

    expect(remaining).toBe(0);
  });

  it("returns booked quantity when no disposition logs exist", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });
    // why: Prisma _sum returns null when the aggregated set is empty.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: null } });

    const remaining = await computeBookingAssetRemaining(
      db,
      "booking-1",
      "asset-1"
    );

    expect(remaining).toBe(10);
  });

  it("returns zero when the bookingAsset pivot row is missing", async () => {
    expect.assertions(1);

    // why: defends against asset removed from booking between read+write.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue(null);
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    const remaining = await computeBookingAssetRemaining(
      db,
      "booking-1",
      "asset-1"
    );

    expect(remaining).toBe(0);
  });
});

describe("isBookingFullyCheckedIn", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns true when individuals are reconciled and qty-tracked remaining is zero", async () => {
    expect.assertions(1);

    // why: mixed booking with one INDIVIDUAL (asset-1) and one
    // QUANTITY_TRACKED (asset-2) asset.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        quantity: 1,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-2",
        quantity: 10,
        asset: { id: "asset-2", type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    // why: asset-1 is in a session → individual-side reconciled.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1"] },
    ]);
    // why: computeBookingAssetRemaining reads findUnique + aggregate.
    // Booked 10 − logged 10 → remaining 0 for asset-2.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });

  it("returns false when an individual asset is missing from every session", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        quantity: 1,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-2",
        quantity: 1,
        asset: { id: "asset-2", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: only asset-1 is reconciled; asset-2 is still pending.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1"] },
    ]);

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(false);
  });

  it("returns false when a qty-tracked asset still has remaining units", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-qty",
        quantity: 10,
        asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    // why: booked 10 − logged 3 → 7 still outstanding.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 3 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(false);
  });

  it("returns true when the booking has no assets at all (short-circuit)", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });
});

describe("partialCheckinBooking — qty-tracked dispositions", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: clearAllMocks clears call history but not `mockResolvedValue`
    // implementations. Tests in this block mutate several shared mocks
    // (bookingAsset.findMany, consumptionLog.aggregate, etc.) — reset
    // them to their original "empty" defaults so ordering doesn't leak.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
    (db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.booking.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({});
    (db.asset.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({});
    (db.custody.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
  });

  /** Booking id + common params reused across scenarios in this block. */
  const mockQtyBookingId = "booking-q1";
  const mockQtyAssetId = "asset-pens";

  /**
   * Minimal booking skeleton for qty-tracked flows. One QUANTITY_TRACKED
   * asset (Pens) with a booked quantity of 10 on a pool of 100.
   */
  const makeQtyBooking = () => ({
    id: mockQtyBookingId,
    name: "Qty Booking",
    status: BookingStatus.ONGOING,
    organizationId: "org-1",
    creatorId: "user-1",
    custodianUserId: "user-1",
    custodianTeamMemberId: null,
    bookingAssets: [
      {
        assetId: mockQtyAssetId,
        quantity: 10,
        asset: {
          id: mockQtyAssetId,
          type: AssetType.QUANTITY_TRACKED,
          kitId: null,
        },
      },
    ],
  });

  /** Shared base params; individual tests override `checkins`. */
  const baseParams = {
    id: mockQtyBookingId,
    organizationId: "org-1",
    userId: "user-1",
    hints: mockClientHints,
  };

  /**
   * Sets up the common mocks for qty-tracked partial-checkin flows.
   * - lockAssetForQuantityUpdate returns a Pens asset with pool=100
   * - booking.findUniqueOrThrow returns the qty booking shell
   * - bookingAsset.findUnique returns `quantity: 10` (booked on booking)
   * - consumptionLog.aggregate returns `{_sum: {quantity: 0}}` (no logs yet)
   *
   * @param overrides - optional per-test overrides
   */
  function setupQtyMocks(
    overrides: {
      pool?: number;
      logged?: number;
      custodySum?: number;
    } = {}
  ) {
    const pool = overrides.pool ?? 100;
    const logged = overrides.logged ?? 0;
    const custodySum = overrides.custodySum ?? 0;

    // why: returns the stable "Pens" stub used by every qty-tracked test.
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: mockQtyAssetId,
      title: "Pens",
      quantity: pool,
    });

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(makeQtyBooking());

    // why: booked 10 units on this booking.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });

    // why: logged-so-far aggregate controls `remaining = 10 − logged`.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({
      _sum: { quantity: logged },
    });

    // why: pool-drain guard reads custody aggregate sum.
    //@ts-expect-error missing vitest type
    db.custody.aggregate.mockResolvedValue({
      _sum: { quantity: custodySum },
    });
  }

  it("writes a single RETURN log for TWO_WAY when returned equals remaining", async () => {
    expect.assertions(3);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 10 }],
    });

    // One RETURN log for the full remaining quantity.
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mockQtyAssetId,
        category: "RETURN",
        quantity: 10,
        bookingId: mockQtyBookingId,
      })
    );
    // RETURN never touches Asset.quantity (pool stays put).
    expect(db.asset.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: expect.anything() }),
      })
    );
    // Booking flipped to COMPLETE because remaining hit zero.
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.COMPLETE }),
      })
    );
  });

  it("writes three logs and decrements pool when returned+lost+damaged equals remaining", async () => {
    expect.assertions(5);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 5, lost: 3, damaged: 2 }],
    });

    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "RETURN", quantity: 5 })
    );
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "LOSS", quantity: 3 })
    );
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "DAMAGE", quantity: 2 })
    );
    // Pool decrement = lost (3) + damaged (2) = 5. RETURN is excluded.
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: mockQtyAssetId },
      data: { quantity: { decrement: 5 } },
    });
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.COMPLETE }),
      })
    );
  });

  it("keeps booking ONGOING when the payload leaves units pending", async () => {
    expect.assertions(3);

    setupQtyMocks();

    // why: isBookingFullyCheckedIn reads tx.bookingAsset.findMany to decide
    // the COMPLETE transition. Return our qty-tracked asset so the helper
    // actually evaluates remaining instead of short-circuiting on empty.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: mockQtyAssetId,
        quantity: 10,
        asset: { id: mockQtyAssetId, type: AssetType.QUANTITY_TRACKED },
      },
    ]);

    // why: sequence consumptionLog.aggregate across the three calls in
    // the service so remaining progresses as:
    //   1. pre-lock check   → logged 0 → remaining 10
    //   2. post-lock re-query → logged 0 → remaining 10, claimed 8 OK
    //   3. isBookingFullyCheckedIn → logged 8 → remaining 2 → NOT complete
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce({ _sum: { quantity: 0 } })
      .mockResolvedValueOnce({ _sum: { quantity: 0 } })
      .mockResolvedValueOnce({ _sum: { quantity: 8 } });

    await partialCheckinBooking({
      ...baseParams,
      // 5 + 2 + 1 = 8 of 10 remaining → 2 still pending.
      checkins: [{ assetId: mockQtyAssetId, returned: 5, lost: 2, damaged: 1 }],
    });

    // Pool decrement = lost (2) + damaged (1) = 3.
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: mockQtyAssetId },
      data: { quantity: { decrement: 3 } },
    });

    // Booking must NOT flip to COMPLETE while units remain pending.
    const bookingUpdateCalls = (
      db.booking.update as ReturnType<typeof vitest.fn>
    ).mock.calls;
    const flippedToComplete = bookingUpdateCalls.some(
      (callArgs) => callArgs[0]?.data?.status === BookingStatus.COMPLETE
    );
    expect(flippedToComplete).toBe(false);

    // PartialBookingCheckin session row is still created (session log).
    expect(db.partialBookingCheckin.create).toHaveBeenCalled();
  });

  it("writes a CONSUME log and decrements pool for ONE_WAY consumed", async () => {
    expect.assertions(3);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, consumed: 10 }],
    });

    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "CONSUME", quantity: 10 })
    );
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: mockQtyAssetId },
      data: { quantity: { decrement: 10 } },
    });
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.COMPLETE }),
      })
    );
  });

  it("rejects over-return when claimed exceeds remaining", async () => {
    expect.assertions(3);

    // why: booked 10, logged 0 → remaining 10. Claimed 12 should fail.
    setupQtyMocks();

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [{ assetId: mockQtyAssetId, returned: 12 }],
      })
    ).rejects.toThrow(ShelfError);

    // No log writes and no pool decrement on rejection.
    expect(consumptionLogService.createConsumptionLog).not.toHaveBeenCalled();
    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("rejects when the pool-drain guard trips (projected < custody sum)", async () => {
    expect.assertions(3);

    // why: pool=10, custody holds 8, user tries to remove 5 →
    // projected (5) < inCustody (8). Must reject.
    setupQtyMocks({ pool: 10, custodySum: 8 });

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [{ assetId: mockQtyAssetId, lost: 5 }],
      })
    ).rejects.toThrow(ShelfError);

    expect(consumptionLogService.createConsumptionLog).not.toHaveBeenCalled();
    expect(db.asset.update).not.toHaveBeenCalled();
  });

  it("rejects an empty payload (no checkins and no assetIds)", async () => {
    expect.assertions(1);

    setupQtyMocks();

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [],
        assetIds: [],
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("checkinBooking — qty-tracked auto-default", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: reset mocks mutated by earlier describe blocks so test order
    // doesn't leak return values between qty-tracked scenarios.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
    (db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.booking.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({});
    (db.asset.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({});
  });

  const mockBookingId = "booking-c1";
  const mockQtyAssetId = "asset-pens";

  /**
   * Build a booking shell with one QUANTITY_TRACKED asset. `consumptionType`
   * drives whether the auto-default is RETURN (TWO_WAY) or CONSUME (ONE_WAY).
   */
  function makeBooking(consumptionType: ConsumptionType) {
    return {
      id: mockBookingId,
      name: "Auto Checkin",
      status: BookingStatus.ONGOING,
      organizationId: "org-1",
      creatorId: "user-1",
      custodianUserId: "user-1",
      custodianTeamMemberId: null,
      from: futureFromDate,
      to: futureToDate,
      bookingAssets: [
        {
          assetId: mockQtyAssetId,
          quantity: 10,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            consumptionType,
            title: "Pens",
            kitId: null,
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              {
                booking: {
                  id: mockBookingId,
                  status: BookingStatus.ONGOING,
                },
              },
            ],
          },
        },
      ],
      partialCheckins: [],
    };
  }

  const baseParams = {
    id: mockBookingId,
    organizationId: "org-1",
    userId: "user-1",
    hints: mockClientHints,
  };

  /**
   * Wire up the common mocks for checkinBooking qty-tracked paths.
   *
   * @param consumptionType - drives the auto-default branch
   * @param pool - starting `Asset.quantity` (defaults to 100)
   */
  function setupCheckinMocks(consumptionType: ConsumptionType, pool = 100) {
    const booking = makeBooking(consumptionType);
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(booking);

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...booking,
      status: BookingStatus.COMPLETE,
    });

    // why: booked 10 units, zero logged so remaining = 10.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findUnique.mockResolvedValue({ quantity: 10 });
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: mockQtyAssetId,
      title: "Pens",
      quantity: pool,
    });
  }

  it("auto-defaults to CONSUME for ONE_WAY assets and decrements the pool", async () => {
    expect.assertions(3);

    setupCheckinMocks(ConsumptionType.ONE_WAY);

    await checkinBooking(baseParams);

    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mockQtyAssetId,
        category: "CONSUME",
        quantity: 10,
        bookingId: mockBookingId,
      })
    );
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: mockQtyAssetId },
      data: { quantity: { decrement: 10 } },
    });
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.COMPLETE }),
      })
    );
  });

  it("auto-defaults to RETURN for TWO_WAY assets and leaves the pool untouched", async () => {
    expect.assertions(3);

    setupCheckinMocks(ConsumptionType.TWO_WAY);

    await checkinBooking(baseParams);

    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mockQtyAssetId,
        category: "RETURN",
        quantity: 10,
      })
    );
    // RETURN must NOT decrement Asset.quantity.
    expect(db.asset.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quantity: expect.anything() }),
      })
    );
    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: BookingStatus.COMPLETE }),
      })
    );
  });

  it("uses an explicit disposition when provided, overriding the auto-default", async () => {
    expect.assertions(3);

    setupCheckinMocks(ConsumptionType.TWO_WAY);

    await checkinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, lost: 10 }],
    });

    // Only a LOSS log — no RETURN or CONSUME auto-fill.
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({ category: "LOSS", quantity: 10 })
    );
    const calls = (
      consumptionLogService.createConsumptionLog as ReturnType<typeof vitest.fn>
    ).mock.calls;
    const categoriesLogged = calls.map(
      (callArgs) => callArgs[0]?.category as string | undefined
    );
    expect(categoriesLogged).not.toContain("RETURN");
    // Pool decrement = lost (10).
    expect(db.asset.update).toHaveBeenCalledWith({
      where: { id: mockQtyAssetId },
      data: { quantity: { decrement: 10 } },
    });
  });
});
