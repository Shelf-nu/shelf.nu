import {
  BookingStatus,
  AssetStatus,
  AssetType,
  KitStatus,
  OrganizationRoles,
  ConsumptionType,
} from "@prisma/client";

import { db } from "~/database/db.server";
import * as activityEventService from "~/modules/activity-event/service.server";
import * as bookingNoteService from "~/modules/booking-note/service.server";
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
  buildKitSlicesForBooking,
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
  addScannedAssetsToBooking,
  processBooking,
  getExistingBookingDetails,
  assertKitsAddableToActiveBooking,
  getOngoingBookingForAsset,
  getMinimalBookings,
  bookingDraftVisibilityClause,
  bulkArchiveBookings,
  bulkCancelBookings,
  // Phase 3c helpers
  computeBookingAssetRemaining,
  computeBookingAssetSliceRemaining,
  attributeDispositionsByBookingAsset,
  attributeCategorizedDispositionsByBookingAsset,
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
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findFirstOrThrow: vitest.fn().mockResolvedValue({}),
      findUnique: vitest.fn().mockResolvedValue(null),
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      delete: vitest.fn().mockResolvedValue({}),
      count: vitest.fn().mockResolvedValue(0),
    },
    asset: {
      // why: assertAssetsBelongToOrg (checkout/create cross-org guard) calls
      // db.asset.findMany({ where:{ id:{ in }, organizationId }, select:{ id }}).
      // Echo the requested ids so the guard passes for happy-path tests; other
      // call sites (no id.in) still get [], and tests override per-case.
      findMany: vitest.fn().mockImplementation((args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids) ? ids.map((id: string) => ({ id })) : []
        );
      }),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      update: vitest.fn().mockResolvedValue({}),
    },
    assetKit: {
      // why: assertAssetKitsBelongToOrg (kit-slice cross-org guard) calls
      // db.assetKit.findMany({ where:{ id:{ in }, organizationId }, select:{ id }}).
      // Echo the requested ids so the guard passes for happy-path tests;
      // tests asserting a foreign kit id override per-case.
      findMany: vitest.fn().mockImplementation((args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids) ? ids.map((id: string) => ({ id })) : []
        );
      }),
    },
    kit: {
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: assertKitsBelongToOrg (kit cross-org guard) calls
      // db.kit.findMany({ where:{ id:{ in }, organizationId }, select:{ id }}).
      // Echo the requested ids so the guard passes for happy-path tests;
      // tests asserting kit re-resolution (duplicateBooking) override per-case.
      findMany: vitest.fn().mockImplementation((args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids) ? ids.map((id: string) => ({ id })) : []
        );
      }),
    },
    partialBookingCheckin: {
      create: vitest.fn().mockResolvedValue({}),
      count: vitest.fn().mockResolvedValue(0),
      findMany: vitest.fn().mockResolvedValue([]),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { checkinCount: 0 } }),
    },
    partialBookingCheckout: {
      create: vitest.fn().mockResolvedValue({}),
      count: vitest.fn().mockResolvedValue(0),
      findMany: vitest.fn().mockResolvedValue([]),
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
    // why: bulkCancelBookings creates per-asset cancellation notes via
    // tx.note.createMany inside its transaction. Returning a no-op count
    // is enough — the assertion-under-test cares about the activity-event
    // emission, not the note write.
    note: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    tag: {
      findMany: vitest
        .fn()
        .mockResolvedValue([{ name: "Tag 1" }, { name: "Tag 2" }]),
    },
    teamMember: {
      findUnique: vitest.fn().mockResolvedValue(null),
      // why: cross-org IDOR guard (assertTeamMemberBelongsToOrg) and the
      // new-custodian lookup now query teamMember.findFirst scoped by
      // organizationId. Echo a minimal row for the requested id so the
      // guard passes; individual tests still override with richer shapes.
      findFirst: vitest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => ({
          id: where.id,
        })),
    },
    // why: cross-org IDOR guard assertUserBelongsToOrg now queries
    // userOrganization.findFirst({ userId, organizationId }) before connecting
    // a custodian user. Echo a membership row so happy-path booking tests pass;
    // tests that exercise the foreign-user rejection override with null.
    userOrganization: {
      findFirst: vitest.fn().mockResolvedValue({ id: "user-org-1" }),
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

// why: booking service writes activity events from main's transactional
// integration — stub so we can assert on calls without persisting them.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

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
      asset: { id: "asset-1", assetKits: [] },
      assetId: "asset-1",
      quantity: 1,
      id: "ba-1",
    },
    {
      asset: { id: "asset-2", assetKits: [] },
      assetId: "asset-2",
      quantity: 1,
      id: "ba-2",
    },
    {
      asset: { id: "asset-3", assetKits: [{ kitId: "kit-1" }] },
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

    // why: createBooking now runs cross-org IDOR guards inside its
    // transaction. assertAssetsBelongToOrg / assertTagsBelongToOrg compare
    // findMany().length against the requested id count, so the mock must
    // echo back exactly the requested ids (deduped) for the guards to pass.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id }))
    );
    (db.tag.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id }))
    );
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

  it("drops an INDIVIDUAL asset from the standalone bucket when it is also a kit slice", async () => {
    // Defense-in-depth: an INDIVIDUAL asset present in BOTH `assetIds` and
    // `kitSlices` is one physical unit and must be written ONCE (the kit-driven
    // row), never twice. QUANTITY_TRACKED would be kept in both buckets.
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(mockBookingData);
    // why: the overlap guard looks up types for the overlapping id; mark it
    // INDIVIDUAL so it is dropped from the standalone insert.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "asset-1", type: "INDIVIDUAL" },
    ]);

    await createBooking({
      ...mockCreateBookingParams,
      assetIds: ["asset-1"],
      kitSlices: [{ assetId: "asset-1", assetKitId: "ak-1", quantity: 1 }],
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingAssets: {
            create: [{ assetId: "asset-1", quantity: 1, assetKitId: "ak-1" }],
          },
        }),
      })
    );
  });

  it("dedupes duplicate standalone assetIds into a single BookingAsset row", async () => {
    // API/mobile payloads aren't uniqueness-checked; a repeated id must not
    // create two standalone rows (partial-unique violation) or double its
    // event qty meta.
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(mockBookingData);

    await createBooking({
      ...mockCreateBookingParams,
      assetIds: ["asset-1", "asset-1"],
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingAssets: { create: [{ assetId: "asset-1" }] },
        }),
      })
    );
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
    // Default: no progressive-checkout records (an all-at-once checkout), so
    // check-in eligibility falls back to all booking assets. Tests that need a
    // genuine progressive-checkout history override this per-test.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
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
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
        },
        {
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
        },
        {
          asset: { id: "asset-3", assetKits: [], type: AssetType.INDIVIDUAL },
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
    //     { id: "asset-1", assetKits: [] },
    //     { id: "asset-2", assetKits: [] },
    //     { id: "asset-3", assetKits: [] },
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

    // Mock asset statuses — the scanned assets are CHECKED_OUT so they pass
    // the progressive-checkout guard (main's PR #2625: only checked-out
    // assets can be checked in).
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
      { id: "asset-2", title: "Asset 2", status: AssetStatus.CHECKED_OUT },
    ]);

    const result = await partialCheckinBooking(mockPartialCheckinParams);

    // Verify assets status updated (only INDIVIDUAL assets get status reset).
    // The service filters by type in JS now (Phase 3c), so the where clause
    // just has the individual asset IDs.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      // why: partial check-in now scopes the asset status update by
      // organizationId (cross-org IDOR hardening).
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
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
    // link back to the booking (resolved-service kept HEAD's wider note
    // wording, see merge resolution of booking/service.server.ts hunk 13).
    expect(noteService.createNotes).toHaveBeenCalledWith({
      content:
        '{% link to="/settings/team/users/user-1" text="Test User" /%} checked in via partial check-in on {% link to="/bookings/booking-1" text="Test Booking" /%}.',
      type: "UPDATE",
      userId: "user-1",
      assetIds: ["asset-1", "asset-2"],
      // why: createNotes now requires organizationId (it internally runs the
      // cross-org asset guard); the booking service forwards the booking's org.
      organizationId: "org-1",
    });

    expect(result).toEqual({
      booking: bookingWithAssets, // Assets remain in booking with new approach
      checkedInAssetCount: 2,
      remainingAssetCount: 1, // 3 total - 2 checked in = 1 remaining
      isComplete: false,
    });
  });

  it("should reject checking in assets that were never checked out (progressive checkout guard)", async () => {
    expect.assertions(1);

    // Booking holds both assets; asset-2 is still Booked (AVAILABLE) — it was
    // never scanned out under progressive checkout, so it cannot be checked in.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      assets: [
        { id: "asset-1", kitId: null },
        { id: "asset-2", kitId: null },
      ],
    });

    // Progressive checkout history: only asset-1 was ever checked out for this
    // booking, so asset-2 is ineligible for check-in (per-booking, not global).
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-1"] }]);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);

    await expect(
      partialCheckinBooking(mockPartialCheckinParams)
    ).rejects.toThrow(/never checked out/i);
  });

  it("should redirect to complete check-in when all assets are being checked in", async () => {
    expect.assertions(1);

    // why: a prior test in this describe sets `partialBookingCheckin.findMany`
    // to return non-empty records; `vitest.clearAllMocks()` in beforeEach
    // clears CALLS but not IMPLEMENTATIONS, so without this explicit reset
    // `getPartiallyCheckedInAssetIds` would see stale records and the new
    // records-based completion gate would skip its early-exit.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);

    // Mock booking with same assets as being checked in
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [] },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
        },
        {
          asset: { id: "asset-2", assetKits: [] },
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

  it("should complete the booking from partial check-in records when the final batch returns the last outstanding asset, even though every asset reads CHECKED_OUT globally (shared across overlapping bookings)", async () => {
    expect.assertions(2);

    // Reproduces the production bug. Assets are shared across overlapping
    // bookings, so an asset returned for THIS booking can be CHECKED_OUT again
    // by a later booking. Completion must therefore be decided from this
    // booking's PartialBookingCheckin records (the per-booking source of truth
    // the progress bar uses), NOT from the assets' global `status`.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      assets: [
        { id: "asset-1", kitId: null },
        { id: "asset-2", kitId: null },
        { id: "asset-3", kitId: null },
      ],
    });

    // asset-1 and asset-2 were already returned for this booking in earlier
    // sessions (records exist); asset-3 is the last outstanding asset.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1", "asset-2"] },
    ]);

    // Every asset still reads CHECKED_OUT globally because other active
    // bookings hold the same physical items. The old status-based completion
    // check never matched here, stranding the booking OVERDUE.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", status: AssetStatus.CHECKED_OUT },
      { id: "asset-2", status: AssetStatus.CHECKED_OUT },
      { id: "asset-3", status: AssetStatus.CHECKED_OUT },
    ]);

    // Final scan returns the last outstanding asset for this booking.
    const result = await partialCheckinBooking({
      ...mockPartialCheckinParams,
      assetIds: ["asset-3"],
    });

    // The booking is fully returned → it completes via the full check-in path,
    // which does NOT record another partial check-in. Before the fix, the
    // status-based early-exit and the `total - currentBatch` count both failed
    // to recognise completion and left the booking incomplete.
    expect(db.partialBookingCheckin.create).not.toHaveBeenCalled();
    expect(result.isComplete).toBe(true);
  });

  it("should reject a batch containing assets not in the booking before taking the completion shortcut", async () => {
    expect.assertions(2);

    // A batch of [lastOutstandingAsset, unrelatedSameOrgAsset] satisfies the
    // record-based completion check (it covers every outstanding asset), so
    // membership MUST be validated first — otherwise the booking would complete
    // and write notes about an asset that was never on it instead of 400ing.
    // The mobile endpoint forwards raw assetIds, so this guard matters there.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      assets: [
        { id: "asset-1", kitId: null },
        { id: "asset-2", kitId: null },
      ],
    });

    // asset-1 already recorded → asset-2 is the only outstanding asset.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1"] },
    ]);

    await expect(
      partialCheckinBooking({
        ...mockPartialCheckinParams,
        assetIds: ["asset-2", "asset-unrelated"],
      })
    ).rejects.toThrow(ShelfError);

    // Must not have completed or recorded anything.
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
          asset: { id: "asset-3", assetKits: [] },
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
          asset: {
            id: "asset-1",
            assetKits: [{ kitId: "kit-1" }],
            type: AssetType.INDIVIDUAL,
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t2",
        },
        {
          asset: {
            id: "asset-2",
            assetKits: [{ kitId: "kit-1" }],
            type: AssetType.INDIVIDUAL,
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t3",
        },
        {
          asset: { id: "asset-3", assetKits: [], type: AssetType.INDIVIDUAL },
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
          asset: { id: "asset-3", assetKits: [] },
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
      // why: partial check-in now scopes the kit status update by
      // organizationId (cross-org IDOR hardening).
      where: { id: { in: ["kit-1"] }, organizationId: "org-1" },
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
  // An asset belongs to a kit when assetKits[0]?.kitId resolves to a kitId;
  // an empty assetKits array represents "not in any kit".
  it("should return unique kit IDs from assets", () => {
    const assets = [
      { id: "asset-1", assetKits: [{ kitId: "kit-1" }] },
      { id: "asset-2", assetKits: [{ kitId: "kit-1" }] },
      { id: "asset-3", assetKits: [{ kitId: "kit-2" }] },
      { id: "asset-4", assetKits: [] },
    ];

    const result = getKitIdsByAssets(assets);

    expect(result).toEqual(["kit-1", "kit-2"]);
  });

  it("should return empty array when no kits present", () => {
    const assets = [
      { id: "asset-1", assetKits: [] },
      { id: "asset-2", assetKits: [] },
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

    // why: the new-custodian lookup is now org-scoped via findFirst (was
    // findUnique) for cross-org IDOR hardening; mock findFirst with the
    // richer custodian shape so the email gets the new custodian's details.
    //@ts-expect-error missing vitest type
    db.teamMember.findFirst.mockResolvedValue({
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

  it("emits BOOKING_DATES_CHANGED events when from/to dates change", async () => {
    expect.assertions(2);

    const oldFrom = new Date("2024-01-01T09:00:00Z");
    const oldTo = new Date("2024-01-01T17:00:00Z");
    const newFrom = new Date("2024-02-01T09:00:00Z");
    const newTo = new Date("2024-02-01T17:00:00Z");

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "user-1",
      custodianTeamMemberId: "team-member-1",
      name: "Same Name",
      description: "Same Description",
      from: oldFrom,
      to: oldTo,
      custodianUser: null,
      custodianTeamMember: null,
      tags: [],
    });
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });

    await updateBasicBooking({
      id: "booking-1",
      organizationId: "org-1",
      name: "Same Name",
      description: "Same Description",
      from: newFrom,
      to: newTo,
      custodianUserId: "user-1",
      custodianTeamMemberId: "team-member-1",
      tags: [],
      userId: "editor-1",
      hints: mockClientHints,
    });

    // One event per changed field — `from` and `to` separately so reports
    // can `groupBy(field)` without unpacking JSON.
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_DATES_CHANGED",
        bookingId: "booking-1",
        field: "from",
        fromValue: oldFrom.toISOString(),
        toValue: newFrom.toISOString(),
      })
    );
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_DATES_CHANGED",
        bookingId: "booking-1",
        field: "to",
        fromValue: oldTo.toISOString(),
        toValue: newTo.toISOString(),
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

  it("does NOT flip asset status to CHECKED_OUT for ONGOING booking (progressive checkout)", async () => {
    // Progressive checkout: assets added to an ONGOING booking join it as line
    // items but stay AVAILABLE until purposefully checked out. Adding must not
    // flip status as a side-effect.
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
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual(mockBooking);
  });

  it("does NOT flip asset status to CHECKED_OUT for OVERDUE booking (progressive checkout)", async () => {
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
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual(mockBooking);
  });

  it("does NOT flip kit status to CHECKED_OUT when kitIds provided for ONGOING booking (progressive checkout)", async () => {
    // Kits added to an active booking stay AVAILABLE too — no status sync at
    // add time; checkout is a deliberate, separate step.
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
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.kit.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual(mockBooking);
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

  it("creates two kit-driven rows for the same asset in two kits", async () => {
    // The data-integrity fix: a single quantity-tracked asset that
    // belongs to TWO kits added to one booking must produce TWO
    // kit-driven BookingAsset inserts — one per AssetKit (distinct
    // assetKitId). The old 1:1 assetId→assetKitId map silently dropped
    // the second slice. We assert the kit-driven raw INSERT receives
    // both assetKitIds (and the shared assetId twice).
    expect.assertions(4);

    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    // why: validation reads the union of standalone + kit-slice asset
    // ids; the shared asset exists exactly once in the org.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-shared" }]);

    const params = {
      id: "booking-1",
      organizationId: "org-1",
      // No standalone assets — this mirrors a kit-add submission.
      assetIds: [] as string[],
      // `kitIds` is always passed on the kit-add path; it skips the
      // standalone-asset note block (kit notes are created separately).
      kitIds: ["kit-1", "kit-2"],
      kitSlices: [
        { assetId: "asset-shared", assetKitId: "ak-kit-1", quantity: 10 },
        { assetId: "asset-shared", assetKitId: "ak-kit-2", quantity: 5 },
      ],
    };

    const result = await updateBookingAssets(params);

    expect(result).toEqual(mockBooking);
    expect(db.$executeRaw).toHaveBeenCalled();

    // The kit-driven branch interpolates the (assetIds, quantities,
    // assetKitIds) arrays as raw-template values. Find the call whose
    // interpolated values include the assetKitIds array carrying both
    // AssetKit ids — proving both slices were written.
    const kitDrivenCall = (
      db.$executeRaw as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls.find((call: unknown[]) =>
      call.some(
        (arg) =>
          Array.isArray(arg) &&
          arg.includes("ak-kit-1") &&
          arg.includes("ak-kit-2")
      )
    );
    expect(kitDrivenCall).toBeDefined();

    // The same assetId appears twice (one row per AssetKit slice).
    const sharedAssetIdArray = kitDrivenCall?.find(
      (arg: unknown) =>
        Array.isArray(arg) &&
        arg.filter((v) => v === "asset-shared").length === 2
    );
    expect(sharedAssetIdArray).toBeDefined();
  });

  it("skips a kit slice for an INDIVIDUAL asset already standalone on the booking", async () => {
    // Adding a kit whose INDIVIDUAL member is already a standalone row must NOT
    // insert a second (kit-driven) row for that one physical unit. QT is exempt.
    expect.assertions(2);
    const mockBooking = {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // why: validAssets lookup must report the member as INDIVIDUAL for the skip.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "asset-1", type: "INDIVIDUAL" },
    ]);
    // why: the asset already exists on the booking as a standalone row.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetId: "asset-1" }]);

    await updateBookingAssets({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: [],
      kitIds: ["kit-1"],
      kitSlices: [{ assetId: "asset-1", assetKitId: "ak-1", quantity: 1 }],
    });

    // The kit-driven raw INSERT must NOT run for the skipped slice — no
    // $executeRaw call should carry the AssetKit id.
    const kitInsertCall = (
      db.$executeRaw as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls.find((call: unknown[]) =>
      call.some((arg) => Array.isArray(arg) && arg.includes("ak-1"))
    );
    expect(kitInsertCall).toBeUndefined();
    expect(db.booking.findUniqueOrThrow).toHaveBeenCalled();
  });
});

describe("buildKitSlicesForBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("maps each AssetKit membership row to a kit-driven slice spec", async () => {
    expect.assertions(2);

    // why: buildKitSlicesForBooking reads kit membership rows via
    // db.assetKit.findMany — stub the rows so we can assert the mapping
    // without a real DB. The default mock only echoes `{ id }`, so this
    // override supplies the assetId/quantity the mapping needs.
    (db.assetKit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "ak-1", assetId: "asset-1", quantity: 1 },
      { id: "ak-2", assetId: "asset-2", quantity: 4 },
    ]);

    const slices = await buildKitSlicesForBooking({
      kitIds: ["kit-1"],
      organizationId: "org-1",
    });

    expect(slices).toEqual([
      { assetId: "asset-1", assetKitId: "ak-1", quantity: 1 },
      { assetId: "asset-2", assetKitId: "ak-2", quantity: 4 },
    ]);
    // The same asset across multiple kits stays distinct per AssetKit id —
    // mapping is 1:1 with membership rows, never deduped by assetId.
    expect(slices).toHaveLength(2);
  });

  it("excludes memberships already represented on the booking", async () => {
    expect.assertions(1);

    // why: stub three membership rows; `existingAssetKitIds` should filter
    // out the ones already on the booking so re-adding a kit is idempotent.
    (db.assetKit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "ak-1", assetId: "asset-1", quantity: 1 },
      { id: "ak-2", assetId: "asset-2", quantity: 2 },
      { id: "ak-3", assetId: "asset-3", quantity: 3 },
    ]);

    const slices = await buildKitSlicesForBooking({
      kitIds: ["kit-1"],
      organizationId: "org-1",
      existingAssetKitIds: new Set(["ak-2"]),
    });

    expect(slices).toEqual([
      { assetId: "asset-1", assetKitId: "ak-1", quantity: 1 },
      { assetId: "asset-3", assetKitId: "ak-3", quantity: 3 },
    ]);
  });

  it("org-scopes the AssetKit lookup (cross-org IDOR guard)", async () => {
    expect.assertions(1);

    // why: capture the where-clause the helper passes so we can prove it is
    // scoped by organizationId — the only thing stopping a foreign-org kit id
    // from leaking another org's membership into the caller's booking.
    (db.assetKit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(
      []
    );

    await buildKitSlicesForBooking({
      kitIds: ["kit-1", "kit-2"],
      organizationId: "org-1",
    });

    expect(db.assetKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kitId: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
      })
    );
  });

  it("short-circuits to an empty list without querying when no kitIds", async () => {
    expect.assertions(2);

    const slices = await buildKitSlicesForBooking({
      kitIds: [],
      organizationId: "org-1",
    });

    expect(slices).toEqual([]);
    expect(db.assetKit.findMany).not.toHaveBeenCalled();
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
    // why: checkoutBooking now runs assertAssetsBelongToOrg over the booking's
    // assets (right after load, before any asset-derived logic). Echo the
    // requested ids so the org guard passes and tests can exercise the
    // conflict / custody / happy-path flows. (clearAllMocks keeps prior
    // describe implementations, so set this explicitly per describe.)
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids) ? ids.map((id: string) => ({ id })) : []
        );
      }
    );
  });

  const mockCheckoutParams = {
    id: "booking-1",
    organizationId: "org-1",
    hints: mockClientHints,
    from: futureFromDate,
    to: futureToDate,
  };

  it("aborts checkout and performs no writes when an attached asset is not in the caller's org", async () => {
    expect.assertions(3);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      assets: [
        {
          id: "asset-1",
          kitId: null,
          title: "Asset 1",
          status: "AVAILABLE",
          bookings: [],
        },
        // legacy cross-org link — belongs to another workspace
        {
          id: "foreign-asset",
          kitId: null,
          title: "Foreign Asset",
          status: "AVAILABLE",
          bookings: [],
        },
      ],
    };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // org guard: only the in-org asset resolves; "foreign-asset" is absent
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1" }]);

    await expect(checkoutBooking(mockCheckoutParams)).rejects.toThrow(
      "Some of the selected assets do not exist in your workspace"
    );
    // fail-safe: no status transition, no booking write
    expect(db.asset.updateMany).not.toHaveBeenCalled();
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("should checkout booking successfully with no conflicts", async () => {
    expect.assertions(2);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            assetKits: [],
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
            assetKits: [{ kitId: "kit-1" }],
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
      // why: checkout now scopes the asset status update by organizationId
      // (cross-org IDOR hardening) so foreign-org assets can't be mutated.
      where: { id: { in: ["asset-1", "asset-2"] }, organizationId: "org-1" },
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
            assetKits: [],
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
            assetKits: [],
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
      // why: checkout now scopes the asset status update by organizationId
      // (cross-org IDOR hardening) so foreign-org assets can't be mutated.
      where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
        assetKits: { kitId: string }[];
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
    expect.assertions(3);

    const mockBooking = buildPreTxBooking({
      bookingAssets: [
        {
          asset: {
            id: "hp-1",
            assetKits: [],
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
      // why: checkout now scopes the asset status update by organizationId
      // (cross-org IDOR hardening).
      where: {
        id: { in: ["hp-1", "dell-1", "dell-2", "dell-3"] },
        organizationId: "org-1",
      },
      data: { status: AssetStatus.CHECKED_OUT },
    });
    expect(result).toEqual(hydratedBooking);

    // Activity events — per-asset BOOKING_CHECKED_OUT for every asset on
    // the post-scan booking (the same set the asset.updateMany flips).
    // Mirrors `checkoutBooking`'s emission contract.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_CHECKED_OUT",
          bookingId: "booking-1",
          assetId: "hp-1",
        }),
        expect.objectContaining({
          action: "BOOKING_CHECKED_OUT",
          bookingId: "booking-1",
          assetId: "dell-1",
        }),
      ]),
      expect.anything()
    );
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
            assetKits: [],
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
            assetKits: [],
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
            assetKits: [],
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
            assetKits: [{ kitId: "kit-1" }],
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
      // why: INDIVIDUAL-only reset (qty-tracked assets are reset separately)
      // plus organizationId scoping (cross-org IDOR hardening) so foreign-org
      // assets can't be mutated.
      where: {
        id: { in: ["asset-1", "asset-2"] },
        type: AssetType.INDIVIDUAL,
        organizationId: "org-1",
      },
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
            assetKits: [],
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
            assetKits: [{ kitId: "kit-1" }],
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
      // why: INDIVIDUAL-only reset + organizationId scoping (cross-org IDOR).
      where: {
        id: { in: ["asset-1"] },
        type: AssetType.INDIVIDUAL,
        organizationId: "org-1",
      },
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
            assetKits: [],
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
            assetKits: [],
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
            assetKits: [],
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
        // why: check-in now scopes the asset status update by organizationId.
        organizationId: "org-1",
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
            assetKits: [{ kitId: "kit-1" }],
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
            assetKits: [{ kitId: "kit-1" }],
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
            assetKits: [{ kitId: "kit-1" }],
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
            assetKits: [],
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
        // why: check-in now scopes the asset status update by organizationId.
        organizationId: "org-1",
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
            assetKits: [],
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
            assetKits: [],
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
            assetKits: [],
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
          asset: { id: "asset-1", assetKits: [] },
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

  // why: bug #99 — historically cancelBooking blanket-flipped every asset on
  // the booking to AVAILABLE, silently stripping commitments the asset still
  // had elsewhere (another active booking, custody record). The reconciliation
  // helper now reads BookingAsset/Custody counts per asset and picks the
  // strongest remaining terminal status. These tests model the
  // other-booking-count + custody-count returns explicitly per asset so the
  // "binary status assertion regression trap" (any new caller silently
  // collapsing back to updateMany) trips loudly.
  describe("cancelBooking reconciles asset status per asset (bug #99)", () => {
    /**
     * Wires `tx.bookingAsset.count` + `tx.custody.count` mocks so each call
     * site sees a per-asset count based on the supplied maps. Mirrors how the
     * helper at L483 dispatches a count query per assetId — without this,
     * `mockResolvedValue` would return the same scalar to every assetId and
     * we couldn't model the multi-asset scenarios the bug requires.
     *
     * @param otherActiveBookingsByAssetId - assetId → count of OTHER ongoing /
     *   overdue BookingAsset rows (the source booking's own rows are excluded
     *   by `excludeBookingId` inside the helper, so this is purely "elsewhere").
     * @param custodyByAssetId - assetId → count of Custody rows for the asset.
     */
    function mockReconciliationCounts(
      otherActiveBookingsByAssetId: Record<string, number>,
      custodyByAssetId: Record<string, number>
    ) {
      (
        db.bookingAsset.count as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: { where?: { assetId?: string } }) => {
        const assetId = args?.where?.assetId ?? "";
        return Promise.resolve(otherActiveBookingsByAssetId[assetId] ?? 0);
      });
      (db.custody.count as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { assetId?: string } }) => {
          const assetId = args?.where?.assetId ?? "";
          return Promise.resolve(custodyByAssetId[assetId] ?? 0);
        }
      );
    }

    it("keeps asset CHECKED_OUT when another ongoing booking still holds it", async () => {
      // Scenario: Asset-1 is on this ONGOING booking AND on another ONGOING
      // booking. Cancelling this booking must not free the asset — the other
      // booking still has it checked out.
      expect.assertions(2);

      const mockBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.ONGOING,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 3,
            id: "ba-cancel-1",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.CANCELLED,
      });

      // Asset-1: 1 other ongoing booking, 0 custody → CHECKED_OUT.
      mockReconciliationCounts({ "asset-1": 1 }, { "asset-1": 0 });

      await cancelBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: mockClientHints,
      });

      // Per-asset terminal write keeps CHECKED_OUT. NOT the blanket
      // `updateMany({status: AVAILABLE})` of the old code path.
      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.CHECKED_OUT },
      });
      // Defence: no blanket flip to AVAILABLE on the asset list.
      expect(db.asset.updateMany).not.toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
    });

    it("flips asset to IN_CUSTODY when held by a custody record (no other bookings)", async () => {
      // Scenario: Asset-1 was on this ONGOING booking and ALSO assigned to an
      // operator's custody. Cancelling must not strip the custody signal —
      // the team member still holds the asset.
      expect.assertions(2);

      const mockBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.ONGOING,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 1,
            id: "ba-cancel-2",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.CANCELLED,
      });

      // Asset-1: no other bookings, but 1 custody row → IN_CUSTODY.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 1 });

      await cancelBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: mockClientHints,
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.IN_CUSTODY },
      });
      expect(db.asset.updateMany).not.toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
    });

    it("flips asset to AVAILABLE when no other bookings and no custody (regression coverage)", async () => {
      // Regression scenario: Asset-1 is only on this booking and not in
      // anyone's custody. Cancelling correctly releases it — proves the
      // reconciliation path still hits the AVAILABLE branch when nothing
      // else holds the asset (i.e. we didn't over-correct for #99 and pin
      // every cancelled asset to CHECKED_OUT).
      expect.assertions(1);

      const mockBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.ONGOING,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 1,
            id: "ba-cancel-3",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.CANCELLED,
      });

      // Asset-1: no other bookings, no custody → AVAILABLE.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 0 });

      await cancelBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: mockClientHints,
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
    });
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

  // why: bug #99 — deleting an ONGOING/OVERDUE booking previously routed
  // through `updateBookingAssetStates`, which is the same blanket
  // `updateMany({status: AVAILABLE})` the cancel path used. Same leak: an
  // asset on another active booking, or held in custody, got silently freed.
  // These tests assert per-asset reconciliation on the delete path.
  describe("deleteBooking reconciles asset status per asset (bug #99)", () => {
    /** See cancelBooking equivalent above — same per-asset count-mock shim. */
    function mockReconciliationCounts(
      otherActiveBookingsByAssetId: Record<string, number>,
      custodyByAssetId: Record<string, number>
    ) {
      (
        db.bookingAsset.count as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: { where?: { assetId?: string } }) => {
        const assetId = args?.where?.assetId ?? "";
        return Promise.resolve(otherActiveBookingsByAssetId[assetId] ?? 0);
      });
      (db.custody.count as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { assetId?: string } }) => {
          const assetId = args?.where?.assetId ?? "";
          return Promise.resolve(custodyByAssetId[assetId] ?? 0);
        }
      );
    }

    it("keeps asset CHECKED_OUT when another ongoing booking still holds it", async () => {
      expect.assertions(2);

      const activeBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.ONGOING,
        activeSchedulerReference: null,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 1,
            id: "ba-delete-1",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUnique.mockResolvedValue(activeBooking);
      //@ts-expect-error missing vitest type
      db.booking.delete.mockResolvedValue({
        ...activeBooking,
        _count: { bookingAssets: 1 },
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
      });

      // Asset-1: another ONGOING booking still references it → CHECKED_OUT.
      mockReconciliationCounts({ "asset-1": 1 }, { "asset-1": 0 });

      await deleteBooking(
        { id: "booking-1", organizationId: "org-1" },
        mockClientHints,
        "user-1"
      );

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.CHECKED_OUT },
      });
      // Defence: NOT the old blanket flip-to-AVAILABLE on the asset list.
      expect(db.asset.updateMany).not.toHaveBeenCalledWith({
        where: expect.objectContaining({ id: { in: ["asset-1"] } }),
        data: { status: AssetStatus.AVAILABLE },
      });
    });

    it("flips asset to IN_CUSTODY when held by a custody record (no other bookings)", async () => {
      expect.assertions(1);

      const activeBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.OVERDUE,
        activeSchedulerReference: null,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 1,
            id: "ba-delete-2",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUnique.mockResolvedValue(activeBooking);
      //@ts-expect-error missing vitest type
      db.booking.delete.mockResolvedValue({
        ...activeBooking,
        _count: { bookingAssets: 1 },
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
      });

      // Asset-1: no other bookings, 1 custody row → IN_CUSTODY.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 1 });

      await deleteBooking(
        { id: "booking-1", organizationId: "org-1" },
        mockClientHints,
        "user-1"
      );

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.IN_CUSTODY },
      });
    });

    it("flips asset to AVAILABLE when no other bookings and no custody (regression coverage)", async () => {
      expect.assertions(1);

      const activeBooking = {
        ...mockBookingData,
        id: "booking-1",
        status: BookingStatus.ONGOING,
        activeSchedulerReference: null,
        bookingAssets: [
          {
            asset: { id: "asset-1", assetKits: [] },
            assetId: "asset-1",
            quantity: 1,
            id: "ba-delete-3",
          },
        ],
      };

      //@ts-expect-error missing vitest type
      db.booking.findUnique.mockResolvedValue(activeBooking);
      //@ts-expect-error missing vitest type
      db.booking.delete.mockResolvedValue({
        ...activeBooking,
        _count: { bookingAssets: 1 },
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
      });

      // Asset-1: no other bookings, no custody → AVAILABLE.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 0 });

      await deleteBooking(
        { id: "booking-1", organizationId: "org-1" },
        mockClientHints,
        "user-1"
      );

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
    });
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
  // Shared booking window reused across duplicate scenarios: a fixed future
  // window, intentionally distinct from any now/tomorrow default, so assertions
  // prove the caller-provided dates flow through. Centralized so a contract
  // change only needs editing here.
  const DUPLICATE_FROM = new Date("2099-08-01T09:00:00.000Z");
  const DUPLICATE_TO = new Date("2099-08-03T17:00:00.000Z");

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should duplicate booking using the caller-provided from/to dates", async () => {
    expect.assertions(4);

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

    const from = DUPLICATE_FROM;
    const to = DUPLICATE_TO;

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(duplicatedBooking);

    const result = await duplicateBooking({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
      from,
      to,
      request: new Request("https://example.com"),
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test Booking (Copy)",
          status: BookingStatus.DRAFT,
          organizationId: "org-1",
          creatorId: "user-1",
          from,
          to,
        }),
      })
    );
    expect(result).toEqual(duplicatedBooking);

    // Lifecycle event for the duplicated booking — same recordEvent
    // contract as createBooking.
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_CREATED",
        bookingId: "booking-2",
      }),
      expect.anything()
    );

    // One BOOKING_ASSETS_ADDED per copied asset.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          bookingId: "booking-2",
          assetId: "asset-1",
        }),
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          bookingId: "booking-2",
          assetId: "asset-2",
        }),
      ]),
      expect.anything()
    );
  });

  it("preserves assetKitId per slice when the same asset has standalone + kit-driven rows (Bug 3)", async () => {
    // Bug 3 repro: a source booking holds TWO slices for the SAME asset —
    // a standalone slice (assetKitId NULL) and a kit-driven slice
    // (assetKitId "ak-x"). If duplicateBooking dropped `assetKitId`, both
    // copied rows would be standalone for the same (bookingId, assetId),
    // tripping the `BookingAsset_manual_unique` partial unique. The fix
    // emits one standalone copy (assetKitId NULL) plus one kit-driven
    // slice re-resolved from the kit's CURRENT AssetKit row so each row
    // stays distinct on the partial-unique pair.
    expect.assertions(2);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: {
            id: "asset-shared",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [],
          },
          assetId: "asset-shared",
          quantity: 5,
          assetKitId: null,
          id: "ba-standalone",
        },
        {
          asset: {
            id: "asset-shared",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            // The source's kit-driven slice points at AssetKit "ak-x";
            // re-resolution needs this `assetKits` entry to find the kit id.
            assetKits: [{ id: "ak-x", kitId: "kit-1" }],
          },
          assetId: "asset-shared",
          quantity: 3,
          assetKitId: "ak-x",
          id: "ba-kit",
        },
      ],
      tags: [],
    };
    const duplicatedBooking = {
      ...originalBooking,
      id: "booking-2",
      name: "Test Booking (Copy)",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(duplicatedBooking);

    // Kit "kit-1" currently still contains asset-shared via AssetKit "ak-x",
    // qty 3 — same as the source snapshot, so the duplicate's kit-driven
    // slice mirrors what the source carried (no drift).
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockImplementationOnce((args?: any) => {
      if (args?.where?.kitId?.in) {
        return Promise.resolve([
          {
            id: "ak-x",
            assetId: "asset-shared",
            quantity: 3,
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await duplicateBooking({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
      from: DUPLICATE_FROM,
      to: DUPLICATE_TO,
      request: new Request("https://example.com"),
    });

    // Both slices are recreated, each carrying its own assetKitId — the
    // standalone keeps NULL, the kit-driven keeps "ak-x" (re-resolved).
    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingAssets: {
            create: [
              { assetId: "asset-shared", quantity: 5, assetKitId: null },
              { assetId: "asset-shared", quantity: 3, assetKitId: "ak-x" },
            ],
          },
        }),
      })
    );

    // Sanity: the two copied rows are distinct on assetKitId so they
    // won't collide on the manual-unique partial index.
    const createArg = (
      db.booking.create as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0];
    const createdSlices = createArg?.data?.bookingAssets?.create as Array<{
      assetKitId: string | null;
    }>;
    const distinctKitIds = new Set(createdSlices.map((s) => s.assetKitId));
    expect(distinctKitIds.size).toBe(2);
  });

  it("re-resolves kit contents from current AssetKit rows (drift includes new QT addition)", async () => {
    // Drift repro: the source booking carries a kit with 3 INDIVIDUAL
    // members. After source creation, a 4th QT asset (qty 5) is added to
    // the kit. duplicateBooking must rebuild the kit-driven slices from
    // the kit's CURRENT contents — so the duplicate includes the new QT
    // member at its current qty — while standalone slices are copied
    // verbatim. The lifecycle event's `assetCount` reflects the NEW
    // count (1 standalone + 4 kit-driven = 5), not the source count (4).
    expect.assertions(4);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        // One standalone — copied verbatim, unchanged.
        {
          asset: {
            id: "asset-standalone",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [],
          },
          assetId: "asset-standalone",
          quantity: 1,
          assetKitId: null,
          id: "ba-standalone",
        },
        // Three kit-driven slices from the SAME kit (`kit-1`), one per
        // INDIVIDUAL member. The source snapshot pre-dates the QT addition.
        {
          asset: {
            id: "kit-asset-a",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ id: "ak-a", kitId: "kit-1" }],
          },
          assetId: "kit-asset-a",
          quantity: 1,
          assetKitId: "ak-a",
          id: "ba-k-a",
        },
        {
          asset: {
            id: "kit-asset-b",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ id: "ak-b", kitId: "kit-1" }],
          },
          assetId: "kit-asset-b",
          quantity: 1,
          assetKitId: "ak-b",
          id: "ba-k-b",
        },
        {
          asset: {
            id: "kit-asset-c",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ id: "ak-c", kitId: "kit-1" }],
          },
          assetId: "kit-asset-c",
          quantity: 1,
          assetKitId: "ak-c",
          id: "ba-k-c",
        },
      ],
      tags: [],
    };
    const duplicatedBooking = {
      ...originalBooking,
      id: "booking-2",
      name: "Test Booking (Copy)",
    };

    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValue(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(duplicatedBooking);

    // Kit "kit-1"'s CURRENT membership has FOUR rows — the original three
    // INDIVIDUAL members plus a newly-added QT asset at qty 5.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockImplementationOnce((args?: any) => {
      if (args?.where?.kitId?.in) {
        return Promise.resolve([
          {
            id: "ak-a",
            assetId: "kit-asset-a",
            quantity: 1,
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-b",
            assetId: "kit-asset-b",
            quantity: 1,
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-c",
            assetId: "kit-asset-c",
            quantity: 1,
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-qt",
            assetId: "qt-gloves",
            quantity: 5,
            asset: {
              type: AssetType.QUANTITY_TRACKED,
              unitOfMeasure: "pairs",
            },
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await duplicateBooking({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
      from: DUPLICATE_FROM,
      to: DUPLICATE_TO,
      request: new Request("https://example.com"),
    });

    const createArg = (
      db.booking.create as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0];
    const createdSlices = createArg?.data?.bookingAssets?.create as Array<{
      assetId: string;
      quantity: number;
      assetKitId: string | null;
    }>;

    // 1 standalone + 4 kit-driven (incl. the new QT) = 5 total slices.
    expect(createdSlices).toHaveLength(5);

    // Standalone slice copied verbatim (quantity preserved, assetKitId NULL).
    expect(createdSlices).toEqual(
      expect.arrayContaining([
        { assetId: "asset-standalone", quantity: 1, assetKitId: null },
      ])
    );

    // Kit-driven slice for the newly-added QT carries AssetKit.quantity (5),
    // NOT a default of 1 — proves we read from AssetKit, not the source.
    expect(createdSlices).toEqual(
      expect.arrayContaining([
        { assetId: "qt-gloves", quantity: 5, assetKitId: "ak-qt" },
      ])
    );

    // BOOKING_CREATED lifecycle event reflects the NEW slice count (5),
    // not the source's pre-drift count (4).
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_CREATED",
        meta: expect.objectContaining({ assetCount: 5 }),
      }),
      expect.anything()
    );
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
          asset: { id: "asset-1", assetKits: [] },
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
    expect.assertions(3);

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

    // Activity event — BOOKING_DATES_CHANGED is recorded for the new end date.
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_DATES_CHANGED",
        bookingId: "booking-1",
        field: "to",
      })
    );
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
    expect.assertions(3);

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

    // Activity event — BOOKING_STATUS_CHANGED is recorded for the
    // OVERDUE → ONGOING flip (extendBooking does not call
    // createStatusTransitionNote, so it must emit the event itself).
    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_STATUS_CHANGED",
        bookingId: "booking-1",
        field: "status",
        fromValue: BookingStatus.OVERDUE,
        toValue: BookingStatus.ONGOING,
      })
    );
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
    // The booking-status read now happens INSIDE the deleteMany tx so the
    // status-flip decision and the pivot deletion commit atomically (bug
    // #99). Only `status` + `name` are selected — `id` is already known
    // from the call arg and was previously selected for the return shape.
    expect(db.booking.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "booking-1", organizationId: "org-1" },
      select: {
        status: true,
        name: true,
      },
    });
  });

  // why: bug #99 — removeAssets on an ONGOING/OVERDUE booking used to
  // blanket-flip every removed asset to AVAILABLE, even when another active
  // booking still held it or it was in custody. The reconciliation helper now
  // makes the terminal status per-asset; these tests model the per-asset
  // count returns so a future refactor regressing back to updateMany trips
  // the "binary status assertion regression trap" loudly.
  describe("removeAssets reconciles asset status per asset (bug #99)", () => {
    /** See cancelBooking equivalent above — same per-asset count-mock shim. */
    function mockReconciliationCounts(
      otherActiveBookingsByAssetId: Record<string, number>,
      custodyByAssetId: Record<string, number>
    ) {
      (
        db.bookingAsset.count as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: { where?: { assetId?: string } }) => {
        const assetId = args?.where?.assetId ?? "";
        return Promise.resolve(otherActiveBookingsByAssetId[assetId] ?? 0);
      });
      (db.custody.count as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { assetId?: string } }) => {
          const assetId = args?.where?.assetId ?? "";
          return Promise.resolve(custodyByAssetId[assetId] ?? 0);
        }
      );
    }

    it("keeps asset CHECKED_OUT when another ongoing booking still holds it", async () => {
      expect.assertions(2);

      const mockBooking = {
        id: "booking-1",
        assetIds: ["asset-1"],
      };

      //@ts-expect-error missing vitest type
      db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...mockBooking,
        name: "Test Booking",
        status: BookingStatus.ONGOING,
      });

      // Asset-1 still on another ONGOING booking → CHECKED_OUT.
      mockReconciliationCounts({ "asset-1": 1 }, { "asset-1": 0 });

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.CHECKED_OUT },
      });
      // Defence: NOT the old blanket flip-to-AVAILABLE.
      expect(db.asset.updateMany).not.toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
    });

    it("flips asset to IN_CUSTODY when held by a custody record (no other bookings)", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        assetIds: ["asset-1"],
      };

      //@ts-expect-error missing vitest type
      db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...mockBooking,
        name: "Test Booking",
        status: BookingStatus.OVERDUE,
      });

      // Asset-1: no other bookings, 1 custody → IN_CUSTODY.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 1 });

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.IN_CUSTODY },
      });
    });

    it("flips asset to AVAILABLE when no other bookings and no custody (regression coverage)", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        assetIds: ["asset-1"],
      };

      //@ts-expect-error missing vitest type
      db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...mockBooking,
        name: "Test Booking",
        status: BookingStatus.ONGOING,
      });

      // Asset-1: no other bookings, no custody → AVAILABLE.
      mockReconciliationCounts({ "asset-1": 0 }, { "asset-1": 0 });

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: "asset-1", organizationId: "org-1" },
        data: { status: AssetStatus.AVAILABLE },
      });
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
    // why: `computeBookingAssetRemaining` switched from `findUnique` to
    // `findMany` once BookingAsset gained multi-row support — the helper
    // sums quantities across all rows for the (booking, asset) pair.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([{ quantity: 10 }]);
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
    db.bookingAsset.findMany.mockResolvedValue([{ quantity: 5 }]);
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

    // why: `computeBookingAssetRemaining` switched from `findUnique` to
    // `findMany` once BookingAsset gained multi-row support — the helper
    // sums quantities across all rows for the (booking, asset) pair.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([{ quantity: 10 }]);
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
    db.bookingAsset.findMany.mockResolvedValue([]);
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

describe("computeBookingAssetSliceRemaining", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
  });

  it("returns slice.quantity minus only the logs tagged to that slice", async () => {
    expect.assertions(1);

    // why: the slice was booked at 50; 12 units already disposed against
    // THIS slice (tagged). Remaining = 50 − 12 = 38.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 50 });
    (
      db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ _sum: { quantity: 12 } });

    const remaining = await computeBookingAssetSliceRemaining(
      db,
      "booking-1",
      "ba-slice-1"
    );

    expect(remaining).toBe(38);
  });

  it("clamps at zero and treats a missing slice as 0 booked", async () => {
    expect.assertions(1);

    // why: findUnique → null (slice not found) → booked 0 → remaining 0.
    const remaining = await computeBookingAssetSliceRemaining(
      db,
      "booking-1",
      "ba-missing"
    );

    expect(remaining).toBe(0);
  });
});

describe("attributeDispositionsByBookingAsset (legacy NULL + tagged mix)", () => {
  it("attributes tagged logs exactly and greedy-fills NULL logs (standalone first)", () => {
    // Two slices of the same asset: a kit-driven slice (50) and a
    // standalone slice (33). One NEW log is tagged to the standalone
    // slice (20); one LEGACY log has no bookingAssetId (40) and must be
    // greedy-filled — standalone slice first.
    const result = attributeDispositionsByBookingAsset({
      bookingAssetRows: [
        { id: "ba-standalone", quantity: 33, assetKitId: null },
        { id: "ba-kit", quantity: 50, assetKitId: "ak-1" },
      ],
      consumptionLogs: [
        { bookingAssetId: "ba-standalone", quantity: 20 },
        { bookingAssetId: null, quantity: 40 },
      ],
    });

    // Standalone slice takes its exactly-tagged 20 first, then the greedy
    // pass fills its remaining capacity (33 − 20 = 13) before touching the
    // kit → 20 + 13 = 33.
    expect(result.get("ba-standalone")).toBe(33);
    // Kit-driven slice absorbs the remaining legacy pool (40 − 13 = 27).
    expect(result.get("ba-kit")).toBe(27);
  });
});

describe("attributeCategorizedDispositionsByBookingAsset (legacy NULL + tagged mix)", () => {
  it("attributes tagged logs exactly and greedy-fills NULL logs standalone-first", () => {
    // Two slices of the same asset: a kit-driven slice (50) and a
    // standalone slice (33). One NEW log is tagged to the standalone slice
    // (RETURN 20); one LEGACY log has no bookingAssetId (RETURN 40) and must
    // be greedy-filled standalone-first — consistent with the check-out
    // fallback in `attributeDispositionsByBookingAsset` so both surfaces
    // credit the same slice for identical untagged data.
    const result = attributeCategorizedDispositionsByBookingAsset({
      bookingAssetRows: [
        { id: "ba-standalone", quantity: 33, assetKitId: null },
        { id: "ba-kit", quantity: 50, assetKitId: "ak-1" },
      ],
      consumptionLogs: [
        { bookingAssetId: "ba-standalone", category: "RETURN", quantity: 20 },
        { bookingAssetId: null, category: "RETURN", quantity: 40 },
      ],
    });

    // Standalone slice takes its exactly-tagged 20 first, then the greedy
    // pass fills its remaining capacity (33 − 20 = 13) before touching the
    // kit → 20 + 13 = 33 returned.
    expect(result.get("ba-standalone")).toEqual({
      returned: 33,
      consumed: 0,
      lost: 0,
      damaged: 0,
    });
    // Kit-driven slice absorbs the remaining legacy pool (40 − 13 = 27).
    expect(result.get("ba-kit")).toEqual({
      returned: 27,
      consumed: 0,
      lost: 0,
      damaged: 0,
    });
  });
});

describe("isBookingFullyCheckedIn", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns true when individuals are reconciled and qty-tracked remaining is zero", async () => {
    expect.assertions(1);

    // why: both `isBookingFullyCheckedIn` AND the
    // `computeBookingAssetRemaining` helper it delegates to read
    // `bookingAsset.findMany`. Sequence the responses so the first
    // call returns the booking's asset list and the second returns the
    // (booking, qty-asset) row(s) the helper aggregates over.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([{ quantity: 10 }]);
    // why: asset-1 is in a session → individual-side reconciled.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      { assetIds: ["asset-1"] },
    ]);
    // Booked 10 − logged 10 → remaining 0 for asset-2.
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

    // why: both calls (isBookingFullyCheckedIn + computeBookingAssetRemaining)
    // hit `bookingAsset.findMany` — sequence the responses.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
        {
          assetId: "asset-qty",
          quantity: 10,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 10 }]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    // why: booked 10 − logged 3 → 7 still outstanding.
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
          assetKits: [],
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

    // why: `computeBookingAssetRemaining` (multi-row aware) queries
    // `bookingAsset.findMany({ where: { bookingId, assetId } })` and
    // sums quantities. `isBookingFullyCheckedIn` ALSO queries
    // `bookingAsset.findMany` but only by `bookingId`. We branch by the
    // shape of the where clause:
    //   - `assetId` set → compute helper → return the booked qty
    //   - `assetId` absent → isBookingFullyCheckedIn → return empty so
    //     the "nothing to check in → complete" short-circuit fires
    //     (mirrors the pre-multi-row mock behaviour where the helper
    //     wasn't called from compute and the default empty mock won).
    //     Individual tests that need the helper to see the full asset
    //     list and walk it can override with `mockResolvedValueOnce`.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockImplementation((args: { where: { assetId?: string } }) => {
        if (args.where?.assetId) {
          return Promise.resolve([{ quantity: 10 }]);
        }
        return Promise.resolve([]);
      });

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

  it("bare scan (no disposition) of a TWO_WAY QT asset in a partial batch defaults to RETURN of ALL remaining units", async () => {
    expect.assertions(1);

    setupQtyMocks();

    // Two-asset booking: the QT "Pens" (booked 10) + an INDIVIDUAL asset that
    // is NOT scanned this batch. Because the batch does not cover every
    // outstanding asset, the flow stays on the partial path (it does not
    // delegate to the full checkinBooking), so the in-tx default resolution is
    // what we're exercising here.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...makeQtyBooking(),
      bookingAssets: [
        {
          assetId: mockQtyAssetId,
          quantity: 10,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          asset: {
            id: "asset-individual-2",
            type: AssetType.INDIVIDUAL,
            assetKits: [],
          },
        },
      ],
    });
    // No prior check-ins → both assets outstanding (keeps us off the early-exit).
    (
      db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    // The scanned QT asset is checked out (passes the progressive-checkout guard).
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: mockQtyAssetId, title: "Pens", status: AssetStatus.CHECKED_OUT },
    ]);

    // Bare scan — no `checkins` disposition, exactly what the native app sends.
    await partialCheckinBooking({
      ...baseParams,
      assetIds: [mockQtyAssetId],
    });

    // Resolved to "all remaining" (10) → one RETURN log for the full amount
    // (default lock stub has no consumptionType → treated as returnable).
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mockQtyAssetId,
        category: "RETURN",
        quantity: 10,
        bookingId: mockQtyBookingId,
      })
    );
  });

  it("bare scan (no disposition) of a ONE_WAY (consumable) QT asset defaults to CONSUME of ALL remaining units", async () => {
    expect.assertions(1);

    setupQtyMocks();
    // Mark the locked asset consumable so the default resolves to CONSUME.
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: mockQtyAssetId,
      title: "Pens",
      quantity: 100,
      consumptionType: ConsumptionType.ONE_WAY,
    });

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...makeQtyBooking(),
      bookingAssets: [
        {
          assetId: mockQtyAssetId,
          quantity: 10,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          asset: {
            id: "asset-individual-2",
            type: AssetType.INDIVIDUAL,
            assetKits: [],
          },
        },
      ],
    });
    (
      db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: mockQtyAssetId, title: "Pens", status: AssetStatus.CHECKED_OUT },
    ]);

    await partialCheckinBooking({
      ...baseParams,
      assetIds: [mockQtyAssetId],
    });

    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: mockQtyAssetId,
        category: "CONSUME",
        quantity: 10,
        bookingId: mockQtyBookingId,
      })
    );
  });

  it("rejects a BARE re-scan of a QT asset that is already fully checked in (no units remain)", async () => {
    expect.assertions(1);

    // Asset booked 10, all 10 already logged back → remaining 0. A bare scan
    // must reject rather than write a no-op PartialBookingCheckin + event.
    setupQtyMocks({ logged: 10 });

    // Two-asset booking (QT fully reconciled + an INDIVIDUAL still out) so the
    // batch does not cover all outstanding and stays on the partial path.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...makeQtyBooking(),
      bookingAssets: [
        {
          assetId: mockQtyAssetId,
          quantity: 10,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          asset: {
            id: "asset-individual-2",
            type: AssetType.INDIVIDUAL,
            assetKits: [],
          },
        },
      ],
    });
    (
      db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: mockQtyAssetId, title: "Pens", status: AssetStatus.CHECKED_OUT },
    ]);

    await expect(
      partialCheckinBooking({
        ...baseParams,
        assetIds: [mockQtyAssetId],
      })
    ).rejects.toThrow(/no units remain to check in/);
  });

  it("bare full-coverage scan of a single QT asset is accepted (not rejected by the guard) and completes via the delegate path", async () => {
    expect.assertions(1);

    // Single-QT-asset booking (default makeQtyBooking): a bare scan covers ALL
    // outstanding units, so `hasQuantityDispositions` is false and the batch
    // takes the "all remaining scanned → complete check-in" early-exit that
    // delegates to the full checkinBooking. This is the common native case, and
    // pre-fix it would have thrown at the non-zero-disposition guard. We assert
    // the batch is accepted and completes (isComplete) — proof the bare id
    // reaches the delegate. checkinBooking's own all-remaining default is
    // exercised by its dedicated tests; asserting its internal ConsumptionLog
    // here would just re-test that function under partialCheckinBooking's mocks.
    setupQtyMocks();
    (
      db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: mockQtyAssetId, title: "Pens", status: AssetStatus.CHECKED_OUT },
    ]);

    const result = await partialCheckinBooking({
      ...baseParams,
      assetIds: [mockQtyAssetId],
    });

    // Full-coverage batch delegates and completes the booking (it did not throw
    // the "must include a non-zero disposition" guard the bare id used to hit).
    expect(result.isComplete).toBe(true);
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

  /* ---------------- Polish-7b: per-slice attribution ---------------- */

  it("tags each slice's ConsumptionLog with its bookingAssetId (multi-slice, same asset)", async () => {
    expect.assertions(2);

    setupQtyMocks();
    // why: the per-slice cap reads `bookingAsset.findUnique` — give each
    // slice ample headroom so both claims pass the cap.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 50 });

    await partialCheckinBooking({
      ...baseParams,
      checkins: [
        { assetId: mockQtyAssetId, bookingAssetId: "ba-A", returned: 5 },
        { assetId: mockQtyAssetId, bookingAssetId: "ba-B", returned: 3 },
      ],
    });

    // Each slice's RETURN log carries its OWN bookingAssetId — they must
    // NOT collapse into a single asset-level entry.
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "RETURN",
        quantity: 5,
        bookingAssetId: "ba-A",
      })
    );
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "RETURN",
        quantity: 3,
        bookingAssetId: "ba-B",
      })
    );
  });

  it("rejects an over-claim against a single slice even when the asset has free units (per-slice cap)", async () => {
    expect.assertions(2);

    setupQtyMocks();
    // why: asset-level remaining is 10 (setupQtyMocks), but THIS slice was
    // only booked at 5. Claiming 8 must fail on the slice cap
    // (min(10, 5) = 5), not slip through on the looser asset-level guard.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 5 });

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [
          { assetId: mockQtyAssetId, bookingAssetId: "ba-A", returned: 8 },
        ],
      })
    ).rejects.toThrow(ShelfError);

    expect(consumptionLogService.createConsumptionLog).not.toHaveBeenCalled();
  });

  it("leaves bookingAssetId null and skips the per-slice cap for legacy callers", async () => {
    expect.assertions(2);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      // No bookingAssetId → legacy / single-slice path (unchanged).
      checkins: [{ assetId: mockQtyAssetId, returned: 10 }],
    });

    // The per-slice helper (bookingAsset.findUnique) is never consulted
    // when no bookingAssetId is supplied — pure asset-level handling.
    expect(db.bookingAsset.findUnique).not.toHaveBeenCalled();
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "RETURN",
        quantity: 10,
        bookingAssetId: null,
      })
    );
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
          id: "ba-pens-standalone",
          assetId: mockQtyAssetId,
          assetKitId: null,
          quantity: 10,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            consumptionType,
            title: "Pens",
            assetKits: [],
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
    // why: `computeBookingAssetRemaining` switched from `findUnique` to
    // `findMany` once BookingAsset gained multi-row support — the helper
    // sums quantities across all rows for the (booking, asset) pair.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([{ quantity: 10 }]);
    // why: the per-slice loop reads `computeBookingAssetSliceRemaining`,
    // which queries `bookingAsset.findUnique({ select: { quantity } })`
    // for the slice being dispositioned. The single slice here is booked
    // for 10 units (matches the `bookingAssets[0].quantity` shell above).
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
        // Bug 2 fix: auto-default tags the log with the slice's bookingAssetId
        // (not NULL) so future reads attribute it to the right slice.
        bookingAssetId: "ba-pens-standalone",
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
        // Bug 2 fix: auto-default RETURN is tagged with the slice id too.
        bookingAssetId: "ba-pens-standalone",
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

  it("tags EACH slice's auto-default ConsumptionLog with its own bookingAssetId (Bug 2)", async () => {
    // Bug 2 repro: a single qty-tracked asset booked via TWO BookingAsset
    // slices in one booking — a standalone slice (assetKitId NULL) plus a
    // kit-driven slice (assetKitId set). Before the fix, the completion
    // path computed an ASSET-LEVEL disposition and wrote ConsumptionLog
    // rows with `bookingAssetId: NULL`. The fix iterates per slice and
    // tags each log with that slice's own id.
    expect.assertions(4);

    const standaloneSliceId = "ba-cam-standalone";
    const kitSliceId = "ba-cam-kit";
    const camAssetId = "asset-camera";

    const booking = {
      id: mockBookingId,
      name: "Multi-slice Checkin",
      status: BookingStatus.ONGOING,
      organizationId: "org-1",
      creatorId: "user-1",
      custodianUserId: "user-1",
      custodianTeamMemberId: null,
      from: futureFromDate,
      to: futureToDate,
      bookingAssets: [
        {
          id: standaloneSliceId,
          assetId: camAssetId,
          assetKitId: null,
          quantity: 33,
          asset: {
            id: camAssetId,
            type: AssetType.QUANTITY_TRACKED,
            consumptionType: ConsumptionType.TWO_WAY,
            title: "Camera",
            assetKits: [],
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: mockBookingId, status: BookingStatus.ONGOING } },
            ],
          },
        },
        {
          id: kitSliceId,
          assetId: camAssetId,
          assetKitId: "ak-1",
          quantity: 22,
          asset: {
            id: camAssetId,
            type: AssetType.QUANTITY_TRACKED,
            consumptionType: ConsumptionType.TWO_WAY,
            title: "Camera",
            assetKits: [],
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: mockBookingId, status: BookingStatus.ONGOING } },
            ],
          },
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(booking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...booking,
      status: BookingStatus.COMPLETE,
    });

    // why: asset-level remaining = 33 + 22 booked, 0 logged = 55.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      { quantity: 33 },
      { quantity: 22 },
    ]);
    // why: per-slice remaining reads `findUnique({ where: { id } })` — return
    // each slice's booked quantity so both slices have work to do.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        where.id === standaloneSliceId
          ? { quantity: 33 }
          : where.id === kitSliceId
          ? { quantity: 22 }
          : null
      )
    );
    // why: no logs written yet on either slice or the asset.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ id: camAssetId, title: "Camera", quantity: 100 });

    await checkinBooking(baseParams);

    const logCalls = (
      consumptionLogService.createConsumptionLog as ReturnType<typeof vitest.fn>
    ).mock.calls.map((c) => c[0]);

    // Exactly two RETURN logs — one per slice.
    const returnLogs = logCalls.filter((l) => l.category === "RETURN");
    expect(returnLogs).toHaveLength(2);

    // Each slice's log is tagged with its OWN bookingAssetId (33 → standalone,
    // 22 → kit), and the right quantity.
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: camAssetId,
        category: "RETURN",
        quantity: 33,
        bookingAssetId: standaloneSliceId,
      })
    );
    expect(consumptionLogService.createConsumptionLog).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: camAssetId,
        category: "RETURN",
        quantity: 22,
        bookingAssetId: kitSliceId,
      })
    );

    // None of the logs are NULL-tagged (the bug).
    expect(returnLogs.every((l) => l.bookingAssetId != null)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Activity Events — Track 4 gaps                                             */
/*                                                                            */
/* These suites cover the per-booking lifecycle events emitted by the bulk    */
/* + scanner code paths. They focus on the event-emission contract (what     */
/* gets passed to recordEvent / recordEvents), not on the unrelated mutation */
/* logic which is exercised by integration scenarios elsewhere.              */
/* -------------------------------------------------------------------------- */

describe("bulkArchiveBookings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits one BOOKING_ARCHIVED event per archived booking", async () => {
    expect.assertions(1);

    const completedBookings = [
      {
        id: "bk-arch-1",
        status: BookingStatus.COMPLETE,
        custodianUserId: null,
        activeSchedulerReference: null,
      },
      {
        id: "bk-arch-2",
        status: BookingStatus.COMPLETE,
        custodianUserId: "user-2",
        activeSchedulerReference: null,
      },
    ];

    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue(completedBookings);

    await bulkArchiveBookings({
      bookingIds: ["bk-arch-1", "bk-arch-2"],
      organizationId: "org-1",
      userId: "user-1",
    });

    // Service no longer wraps the updateMany + notes in an interactive
    // tx (P2028 regression — SHELF-WEBAPP-1KQ), so `recordEvents` is
    // called WITHOUT a `tx` arg now. Assert the payload shape only.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ARCHIVED",
          bookingId: "bk-arch-1",
        }),
        expect.objectContaining({
          action: "BOOKING_ARCHIVED",
          bookingId: "bk-arch-2",
        }),
      ])
    );
  });

  // Regression for Sentry SHELF-WEBAPP-1KQ: the per-booking status notes used
  // to run inside an interactive transaction, which held the tx open across N
  // sequential note writes and aborted the commit with P2028 on large
  // selections. Notes are written via the global db (never `tx`), so they were
  // never atomic — they must run AFTER a plain `updateMany`, with no tx.
  it("archives via a plain updateMany (no interactive tx) and persists a status note for each booking", async () => {
    expect.assertions(4);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        status: BookingStatus.COMPLETE,
        custodianUserId: "u1",
        activeSchedulerReference: null,
      },
      {
        id: "b2",
        status: BookingStatus.COMPLETE,
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await bulkArchiveBookings({
      bookingIds: ["b1", "b2"],
      organizationId: "org-1",
    });

    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["b1", "b2"] }, organizationId: "org-1" },
      data: { status: BookingStatus.ARCHIVED },
    });
    // The fix removed the interactive transaction entirely for this path.
    expect(db.$transaction).not.toHaveBeenCalled();

    // Observable outcome: each archived booking gets its own status note in the
    // caller's org. `createSystemBookingNote` is the persistence boundary the
    // suite stubs for booking notes (it forwards to db.bookingNote.create), so
    // we assert per-booking payload here rather than just a call count.
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "b1", organizationId: "org-1" })
    );
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "b2", organizationId: "org-1" })
    );
  });

  it("throws if any selected booking is not COMPLETE", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        status: BookingStatus.ONGOING,
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await expect(
      bulkArchiveBookings({ bookingIds: ["b1"], organizationId: "org-1" })
    ).rejects.toThrow(ShelfError);
  });
});

describe("bulkCancelBookings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits one BOOKING_CANCELLED event per cancelled booking inside the tx", async () => {
    expect.assertions(1);

    const cancellableBookings = [
      {
        id: "bk-canc-1",
        name: "Booking 1",
        status: BookingStatus.RESERVED,
        custodianUserId: null,
        activeSchedulerReference: null,
        bookingAssets: [],
        from: new Date("2025-01-01T09:00:00Z"),
        to: new Date("2025-01-02T17:00:00Z"),
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 0 },
      },
      {
        id: "bk-canc-2",
        name: "Booking 2",
        status: BookingStatus.RESERVED,
        custodianUserId: "user-2",
        activeSchedulerReference: null,
        bookingAssets: [],
        from: new Date("2025-01-03T09:00:00Z"),
        to: new Date("2025-01-04T17:00:00Z"),
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 0 },
      },
    ];

    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue(cancellableBookings);

    await bulkCancelBookings({
      bookingIds: ["bk-canc-1", "bk-canc-2"],
      organizationId: "org-1",
      userId: "user-1",
      hints: mockClientHints,
    });

    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_CANCELLED",
          bookingId: "bk-canc-1",
        }),
        expect.objectContaining({
          action: "BOOKING_CANCELLED",
          bookingId: "bk-canc-2",
        }),
      ]),
      expect.anything()
    );
  });
});

describe("addScannedAssetsToBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("rejects when a scanned asset is reserved for an overlapping booking", async () => {
    const from = new Date("2026-07-01T09:00:00Z");
    const to = new Date("2026-07-01T17:00:00Z");

    // why: stub the booking-window lookup that drives the overlap query so the
    // guard runs without hitting the DB.
    (db.booking.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      from,
      to,
    });
    // why: return one asset RESERVED by another overlapping booking so the real
    // hasAssetBookingConflicts fires (and assertAssetsBelongToOrg sees it as an
    // org member) — keeps the test off a real DB.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        title: "Conflicting Asset",
        status: AssetStatus.AVAILABLE,
        // Post-Phase-3a pivot shape: conflicts reach the asset via
        // `bookingAssets[].booking`, not the legacy `bookings` field.
        bookingAssets: [
          {
            booking: {
              id: "other-booking",
              status: BookingStatus.RESERVED,
            },
          },
        ],
      },
    ]);

    await expect(
      addScannedAssetsToBooking({
        assetIds: ["asset-1"],
        kitIds: [],
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow(/already booked or checked out/i);

    // The conflicting asset must never be connected to the booking — the guard
    // runs before the connect transaction.
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("emits one BOOKING_ASSETS_ADDED event per scanned asset inside the tx", async () => {
    expect.assertions(1);

    // Mock the asset metadata fetch inside the tx-helper. Empty
    // assetModelId means the materialize-model-request loop is a no-op.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-scan-1",
        title: "Scanned Asset 1",
        type: AssetType.INDIVIDUAL,
        assetModelId: null,
      },
      {
        id: "asset-scan-2",
        title: "Scanned Asset 2",
        type: AssetType.INDIVIDUAL,
        assetModelId: null,
      },
    ]);

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      id: "booking-scan",
      name: "Scan Booking",
      status: BookingStatus.DRAFT,
    });

    await addScannedAssetsToBooking({
      assetIds: ["asset-scan-1", "asset-scan-2"],
      kitIds: [],
      bookingId: "booking-scan",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          bookingId: "booking-scan",
          assetId: "asset-scan-1",
        }),
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          bookingId: "booking-scan",
          assetId: "asset-scan-2",
        }),
      ]),
      expect.anything()
    );
  });
});

describe("getExistingBookingDetails — addable statuses", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it.each([
    BookingStatus.DRAFT,
    BookingStatus.RESERVED,
    BookingStatus.ONGOING,
    BookingStatus.OVERDUE,
  ])("allows adding to a %s booking", async (status) => {
    // Progressive checkout: active (ONGOING/OVERDUE) bookings accept new items
    // too, not just not-yet-started DRAFT/RESERVED ones.
    (db.booking.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "booking-1",
      status,
      bookingAssets: [],
    });

    const result = await getExistingBookingDetails("booking-1", "org-1");
    expect(result.status).toBe(status);
  });

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
  ])("rejects adding to a terminal %s booking", async (status) => {
    (db.booking.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "booking-1",
      status,
      bookingAssets: [],
    });

    await expect(
      getExistingBookingDetails("booking-1", "org-1")
    ).rejects.toThrow(/Draft, Reserved, Ongoing or Overdue/i);
  });
});

describe("processBooking — checked-out guard for active bookings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * Wire the two db.asset.findMany call sites processBooking triggers:
   *  1. getAvailableAssetsIdsForBooking — no `status` filter; must return
   *     `{ id, status, assetKits }` rows.
   *  2. the guard — filters `status: CHECKED_OUT`; returns the offending rows.
   */
  function mockAssets(
    rows: Array<{ id: string; title?: string; status: AssetStatus }>
  ) {
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      (args?: any) => {
        // Respect the `id: { in }` scope so the guard's narrowed query (which
        // excludes assets already on the booking) is reflected accurately.
        const requestedIds: string[] | undefined = args?.where?.id?.in;
        const inScope = (id: string) =>
          !requestedIds || requestedIds.includes(id);

        if (args?.where?.status === AssetStatus.CHECKED_OUT) {
          return Promise.resolve(
            rows
              .filter(
                (r) => r.status === AssetStatus.CHECKED_OUT && inScope(r.id)
              )
              .map((r) => ({ id: r.id, title: r.title ?? r.id }))
          );
        }
        return Promise.resolve(
          rows
            .filter((r) => inScope(r.id))
            .map((r) => ({ id: r.id, status: r.status, assetKits: [] }))
        );
      }
    );
  }

  // Owner auth for the checked-out-guard cases: validateBookingOwnership is a
  // no-op for OWNER, keeping these focused on the CHECKED_OUT behavior.
  const OWNER_AUTH = {
    userId: "user-1",
    role: OrganizationRoles.OWNER,
  } as const;

  function mockBooking(
    status: BookingStatus,
    existingAssetIds: string[] = [],
    ownership: {
      creatorId?: string | null;
      custodianUserId?: string | null;
    } = {}
  ) {
    (db.booking.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      id: "booking-1",
      status,
      creatorId: ownership.creatorId ?? "user-1",
      custodianUserId: ownership.custodianUserId ?? null,
      bookingAssets: existingAssetIds.map((assetId) => ({
        assetId,
        assetKitId: null,
        asset: { id: assetId, title: assetId },
      })),
    });
  }

  it("blocks a CHECKED_OUT asset from being added to an ONGOING booking", async () => {
    mockBooking(BookingStatus.ONGOING);
    mockAssets([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
    ]);

    await expect(
      processBooking("booking-1", ["asset-1"], "org-1", OWNER_AUTH)
    ).rejects.toThrow(/already checked out/i);
  });

  it("blocks a SELF_SERVICE user from adding to a booking they do not own", async () => {
    // Cross-user IDOR guard: booking:create/update is org-wide for SELF_SERVICE.
    mockBooking(BookingStatus.RESERVED, [], {
      creatorId: "someone-else",
      custodianUserId: "someone-else",
    });
    mockAssets([{ id: "asset-1", status: AssetStatus.AVAILABLE }]);

    await expect(
      processBooking("booking-1", ["asset-1"], "org-1", {
        userId: "attacker",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).rejects.toThrow(/not authorized/i);
  });

  it("allows a SELF_SERVICE user to add to a booking they own", async () => {
    mockBooking(BookingStatus.RESERVED, [], { creatorId: "owner-user" });
    mockAssets([{ id: "asset-1", status: AssetStatus.AVAILABLE }]);

    const { finalAssetIds } = await processBooking(
      "booking-1",
      ["asset-1"],
      "org-1",
      { userId: "owner-user", role: OrganizationRoles.SELF_SERVICE }
    );
    expect(finalAssetIds).toEqual(["asset-1"]);
  });

  it("allows AVAILABLE assets to be added to an ONGOING booking (they stay available)", async () => {
    mockBooking(BookingStatus.ONGOING);
    mockAssets([{ id: "asset-1", status: AssetStatus.AVAILABLE }]);

    const { finalAssetIds } = await processBooking(
      "booking-1",
      ["asset-1"],
      "org-1",
      OWNER_AUTH
    );
    expect(finalAssetIds).toEqual(["asset-1"]);
  });

  it("does NOT block a CHECKED_OUT asset for a DRAFT booking (guard is active-only)", async () => {
    mockBooking(BookingStatus.DRAFT);
    mockAssets([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
    ]);

    const { finalAssetIds } = await processBooking(
      "booking-1",
      ["asset-1"],
      "org-1",
      OWNER_AUTH
    );
    expect(finalAssetIds).toEqual(["asset-1"]);
  });

  it("does NOT block an asset already on this ONGOING booking even if it is CHECKED_OUT", async () => {
    // Regression: an asset checked out via THIS booking's progressive checkout
    // must not trip the guard when re-submitted — the duplicate / "add only the
    // rest" flow handles it downstream.
    mockBooking(BookingStatus.ONGOING, ["asset-1"]);
    mockAssets([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
    ]);

    const { finalAssetIds } = await processBooking(
      "booking-1",
      ["asset-1"],
      "org-1",
      OWNER_AUTH
    );
    expect(finalAssetIds).toEqual(["asset-1"]);
  });

  it("guards only NEW checked-out assets, ignoring ones already on this booking", async () => {
    // asset-1 is already on the (ONGOING) booking and checked out here → skipped.
    // asset-2 is new and AVAILABLE → allowed. No throw.
    mockBooking(BookingStatus.ONGOING, ["asset-1"]);
    mockAssets([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
      { id: "asset-2", title: "Asset 2", status: AssetStatus.AVAILABLE },
    ]);

    const { finalAssetIds } = await processBooking(
      "booking-1",
      ["asset-1", "asset-2"],
      "org-1",
      OWNER_AUTH
    );
    expect(finalAssetIds).toEqual(["asset-1", "asset-2"]);
  });
});

describe("assertKitsAddableToActiveBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /** Kits already on the booking, resolved from existingAssetKitIds. */
  function mockKitsAlreadyOnBooking(kitIds: string[]) {
    (db.assetKit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(
      kitIds.map((kitId) => ({ kitId }))
    );
  }

  /** Kits returned by the CHECKED_OUT query. */
  function mockCheckedOutKits(kits: Array<{ id: string; name: string }>) {
    (db.kit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue(kits);
  }

  it.each([BookingStatus.DRAFT, BookingStatus.RESERVED])(
    "is a no-op for a %s booking (no queries, no throw)",
    async (bookingStatus) => {
      await assertKitsAddableToActiveBooking({
        kitIds: ["kit-1"],
        existingAssetKitIds: new Set(["ak-1"]),
        bookingStatus,
        bookingId: "booking-1",
        organizationId: "org-1",
      });

      expect(db.assetKit.findMany).not.toHaveBeenCalled();
      expect(db.kit.findMany).not.toHaveBeenCalled();
    }
  );

  it.each([BookingStatus.ONGOING, BookingStatus.OVERDUE])(
    "throws for a kit checked out elsewhere when target is %s",
    async (bookingStatus) => {
      mockKitsAlreadyOnBooking([]); // nothing already on booking
      mockCheckedOutKits([{ id: "kit-1", name: "Kit 1" }]);

      await expect(
        assertKitsAddableToActiveBooking({
          kitIds: ["kit-1"],
          existingAssetKitIds: new Set(["ak-1"]),
          bookingStatus,
          bookingId: "booking-1",
          organizationId: "org-1",
        })
      ).rejects.toThrow(/already checked out/i);
    }
  );

  it("does NOT throw for a checked-out kit that is already on this booking", async () => {
    // kit-1 already has a membership on the booking → excluded from the guard,
    // so its CHECKED_OUT status (owned by this booking) is ignored.
    mockKitsAlreadyOnBooking(["kit-1"]);

    await assertKitsAddableToActiveBooking({
      kitIds: ["kit-1"],
      existingAssetKitIds: new Set(["ak-1"]),
      bookingStatus: BookingStatus.ONGOING,
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    // Short-circuits before the checked-out query once all kits are excluded.
    expect(db.kit.findMany).not.toHaveBeenCalled();
  });

  it("does NOT throw when the newly-added kits are all available", async () => {
    mockKitsAlreadyOnBooking([]);
    mockCheckedOutKits([]); // none checked out

    await assertKitsAddableToActiveBooking({
      kitIds: ["kit-1", "kit-2"],
      existingAssetKitIds: new Set(),
      bookingStatus: BookingStatus.ONGOING,
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    // With no existing memberships, the assetKit lookup is skipped entirely.
    expect(db.assetKit.findMany).not.toHaveBeenCalled();
    expect(db.kit.findMany).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 4e Commit 4 — Booking axis: qty-tracked notes + event meta            */
/*                                                                            */
/* QUANTITY_TRACKED assets surface the per-row BookingAsset.quantity on the   */
/* booking-side notes ("N units of {asset}") and on the per-asset event meta. */
/* INDIVIDUAL phrasing + events stay byte-for-byte unchanged.                 */
/* -------------------------------------------------------------------------- */

describe("booking notes + events — qty-tracked axis", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    // Default echo mock used by the org-validation guards.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id }))
    );
  });

  it("updateBookingAssets — qty-tracked single-asset note prefixes the unit count + event meta carries quantity", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-qty",
      name: "Qty Booking",
      status: BookingStatus.DRAFT,
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    // Two findMany calls inside updateBookingAssets: the org-validation
    // call (`select: { id }`) and the event-meta lookup
    // (`select: { id, type, unitOfMeasure }`), then the note-side
    // lookup (`select: { id, title, type, unitOfMeasure }`). The same
    // mock implementation handles all three by echoing the full asset
    // shape — guards check `length`, the others read the extra fields.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          title: "Pens",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: "boxes",
        }))
    );

    await updateBookingAssets({
      id: "booking-qty",
      organizationId: "org-1",
      assetIds: ["asset-pens"],
      userId: "user-1",
      quantities: { "asset-pens": 50 },
    });

    // Per-asset event carries `meta.quantity = 50`.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          assetId: "asset-pens",
          bookingId: "booking-qty",
          meta: { quantity: 50 },
        }),
      ]),
      expect.anything()
    );

    // Booking-level summary note prefixes "50 boxes of {asset link}".
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-qty",
        organizationId: "org-1",
        content: expect.stringContaining("added 50 boxes of"),
      })
    );
  });

  it("updateBookingAssets — INDIVIDUAL single-asset note keeps legacy phrasing + event meta omits quantity", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-ind",
      name: "Ind Booking",
      status: BookingStatus.DRAFT,
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          title: "Camera",
          type: AssetType.INDIVIDUAL,
          unitOfMeasure: null,
        }))
    );

    await updateBookingAssets({
      id: "booking-ind",
      organizationId: "org-1",
      assetIds: ["asset-camera"],
      userId: "user-1",
    });

    // No `meta.quantity` for INDIVIDUAL — assetQtyMeta returns `{}`.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ASSETS_ADDED",
          assetId: "asset-camera",
          bookingId: "booking-ind",
          meta: {},
        }),
      ]),
      expect.anything()
    );

    // Legacy phrasing — bare asset link, no "N units of" prefix.
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-ind",
        organizationId: "org-1",
        content: expect.stringMatching(
          /added \{% link to="\/assets\/asset-camera" text="Camera" \/%\} to the booking\.$/
        ),
      })
    );
  });

  it("removeAssets — qty-tracked event meta + asset-timeline note surface the removed quantity", async () => {
    expect.assertions(2);

    const mockBooking = {
      id: "booking-1",
      assetIds: ["asset-pens"],
    };

    //@ts-expect-error missing vitest type
    db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });

    // Snapshot of the BookingAsset rows about to be deleted — used by
    // removeAssets to source per-asset removed quantity.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      { assetId: "asset-pens", quantity: 80 },
    ]);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBooking,
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    });

    // Asset metadata read inside the removal tx — provide the full shape
    // so the qty-aware per-asset phrasing kicks in.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          assetModelId: null,
          title: "Pens",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: null,
        }))
    );

    await removeAssets({
      booking: mockBooking,
      firstName: "Test",
      lastName: "User",
      userId: "user-1",
      organizationId: "org-1",
    });

    // Per-asset event carries `meta.quantity = 80`.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ASSETS_REMOVED",
          assetId: "asset-pens",
          bookingId: "booking-1",
          meta: { quantity: 80 },
        }),
      ])
    );

    // Asset-timeline note phrasing: "removed 80 units of {asset} from {booking}".
    expect(noteService.createNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        assetIds: ["asset-pens"],
        organizationId: "org-1",
        type: "UPDATE",
        content: expect.stringContaining("removed 80 units of"),
      })
    );
  });
});

describe("bookingDraftVisibilityClause", () => {
  it("shows non-DRAFT bookings to everyone and DRAFTs only to their creator", () => {
    // The permission-sensitive rule shared by getBookings and
    // getMinimalBookings. Locking its shape here so the two list queries
    // cannot silently diverge on who can see a draft.
    expect(bookingDraftVisibilityClause("user-1")).toEqual({
      OR: [
        { status: { not: "DRAFT" } },
        { AND: [{ status: "DRAFT" }, { creatorId: "user-1" }] },
      ],
    });
  });
});

describe("getMinimalBookings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("selects only the picker fields and applies the id sort tiebreaker", async () => {
    // why: assert the slim projection + deterministic order, not DB behavior.
    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany.mockResolvedValueOnce([]);

    await getMinimalBookings({
      organizationId: "org-1",
      userId: "user-1",
      statuses: ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"],
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0];

    // Slim select: exactly the columns the add-to-booking picker renders.
    expect(arg.select).toEqual({
      id: true,
      name: true,
      status: true,
      from: true,
      to: true,
    });
    // No heavy include, and no count query (only one findMany, no db.booking.count).
    expect(arg.include).toBeUndefined();
    expect(db.booking.count).not.toHaveBeenCalled();
    // `from` primary + `id` tiebreaker => deterministic, unpaginated order.
    expect(arg.orderBy).toEqual([{ from: "asc" }, { id: "asc" }]);
    // Carries the shared DRAFT-visibility rule, scoped to the org + viewer.
    expect(arg.where.organizationId).toBe("org-1");
    expect(arg.where.AND).toEqual([bookingDraftVisibilityClause("user-1")]);
    expect(arg.where.status).toEqual({
      in: ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"],
    });
  });

  it("defaults to excluding archived & cancelled when no statuses are given", async () => {
    // why: stub the query so we can assert the default status where-clause
    // getMinimalBookings builds, not real DB behavior.
    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany.mockResolvedValueOnce([]);

    await getMinimalBookings({ organizationId: "org-1", userId: "user-1" });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where.status).toEqual({
      notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED],
    });
    // No custodian scope unless asked for.
    expect(arg.where.custodianUserId).toBeUndefined();
  });

  it("scopes to a custodian when custodianUserId is provided (self-service)", async () => {
    // why: stub the query so we can assert the custodian where-clause
    // getMinimalBookings adds for self-service callers, not real DB behavior.
    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany.mockResolvedValueOnce([]);

    await getMinimalBookings({
      organizationId: "org-1",
      userId: "user-1",
      custodianUserId: "user-1",
    });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where.custodianUserId).toBe("user-1");
  });
});
