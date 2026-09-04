/**
 * Booking Service — Unit Tests
 *
 * Covers the booking lifecycle mutations against a mocked Prisma client: the
 * status transitions and their audit trail, partial check-out / check-in
 * (including quantity dispositions), kit-slice membership, and the date
 * rewrites that check-out, check-in and extension apply.
 *
 * @see {@link file://./service.server.ts}
 */

import Markdoc from "@markdoc/markdoc";
import {
  BookingStatus,
  AssetStatus,
  AssetType,
  KitStatus,
  OrganizationRoles,
  ConsumptionType,
} from "@prisma/client";
import {
  BOOKING_EMPTY_RESERVED_MESSAGE,
  BOOKING_RESERVE_BLOCKED_LABELS,
} from "@shelf/labels";

import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import * as activityEventService from "~/modules/activity-event/service.server";
import { fulfilModelRequestsForAssets } from "~/modules/booking-model-request/service.server";
import * as bookingNoteService from "~/modules/booking-note/service.server";
import * as lowStockService from "~/modules/consumption-log/low-stock.server";
import * as quantityLock from "~/modules/consumption-log/quantity-lock.server";
import * as consumptionLogService from "~/modules/consumption-log/service.server";
import * as noteService from "~/modules/note/service.server";
import { ShelfError } from "~/utils/error";
import { wrapBookingStatusForNote } from "~/utils/markdoc-wrappers";
import { scheduler } from "~/utils/scheduler.server";
import { sendBookingUpdatedEmail } from "./email-helpers";
import { getBookingNotificationRecipients } from "./notification-recipients.server";
import {
  createBooking,
  partialCheckinBooking,
  hasPartialCheckins,
  getPartialCheckinHistory,
  getTotalPartialCheckinCount,
  getPartiallyCheckedInAssetIds,
  getKitIdsByAssets,
  getKitIdsByBookingSlices,
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
  computeBookingKitDrift,
  revertBookingToDraft,
  extendBooking,
  removeAssets,
  addScannedAssetsToBooking,
  processBooking,
  getAvailableAssetsIdsForBooking,
  getExistingBookingDetails,
  assertKitsAddableToActiveBooking,
  getOngoingBookingForAsset,
  getMinimalBookings,
  bookingDraftVisibilityClause,
  bulkArchiveBookings,
  bulkCancelBookings,
  bulkDeleteBookings,
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
    // why: `lockBookingForStatusCheck` issues a raw `SELECT … FOR UPDATE`,
    // which the model-shaped mock below cannot express. Defaults to an OPEN
    // status so every pre-existing test is unaffected; the status-guard tests
    // override it. ONGOING specifically: it is the only status that satisfies
    // BOTH assertions (open for the asset-mutation paths, in-flight for
    // check-in), so one default serves every caller. A string literal, not
    // BookingStatus.ONGOING — this factory is hoisted above the imports.
    $queryRaw: vitest.fn().mockResolvedValue([{ status: "ONGOING" }]),
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
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
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
      // why: the windowed QT availability guard (`getAssetAvailability` →
      // `computeAvailableQuantity`, kept REAL by the consumption-log
      // partial-mock below) reads `Asset.quantity` via
      // `findUniqueOrThrow({ where: { id } })`. Default to 0 so unrelated
      // (non-QT) tests that never touch this path stay inert; QT checkout
      // tests override per-asset via `mockImplementation`.
      findUniqueOrThrow: vitest.fn().mockResolvedValue({ quantity: 0 }),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      update: vitest.fn().mockResolvedValue({}),
    },
    assetKit: {
      // why: assertAssetKitsBelongToOrg (kit-slice cross-org guard) calls
      // db.assetKit.findMany({ where:{ id:{ in }, organizationId },
      // select:{ id, kitId }}) and returns an `assetKitId -> kitId` map that
      // the booking write paths use as the ONLY source for
      // `BookingAsset.sourceKitId`. Echo the requested ids with a derived
      // kitId so the guard passes for happy-path tests; tests that assert a
      // specific sourceKitId override per-case.
      findMany: vitest.fn().mockImplementation((args?: any) => {
        const ids = args?.where?.id?.in;
        return Promise.resolve(
          Array.isArray(ids)
            ? ids.map((id: string) => ({ id, kitId: `kit-of-${id}` }))
            : []
        );
      }),
      // why: `getAssetAvailability` (the windowed QT availability guard)
      // sums units allocated into kits via `assetKit.aggregate`. Default to
      // 0 — none of these fixtures model kit-allocated units; per-test
      // overrides aren't needed since no test in this file exercises that
      // branch.
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      // why: `getAssetAvailabilityBatch` (the batched QT availability guard
      // powering `reserveBooking`/`updateBookingAssets`'s new write-time
      // checks) sums kit-allocated units via `assetKit.groupBy` instead of
      // the singular primitive's `aggregate`. Default to no rows — per-test
      // overrides aren't needed unless a test models kit-allocated units.
      groupBy: vitest.fn().mockResolvedValue([]),
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
        displayName: null,
      }),
      // why: updateBasicBooking now resolves the acting user's format prefs via
      // resolveUserFormatPrefsById (db.user.findFirst). Returning null makes the
      // resolver fall back to hints/defaults — no test asserts the formatted
      // date string, so null is sufficient to keep the flow from crashing.
      findFirst: vitest.fn().mockResolvedValue(null),
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
      // why: `resolveCustodianScope` reads every team-member row the user holds
      // in the org, so any query that restricts to "my bookings" reaches this.
      // Defaults to none; the custodian-scope tests supply their own rows.
      findMany: vitest.fn().mockResolvedValue([]),
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
      // why: checkout/check-in stamp `checkedOutAt`/`checkedInAt` on the
      // slices they move, which is what the check-in eligibility guard reads.
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
      aggregate: vitest.fn().mockResolvedValue({ _sum: { quantity: 0 } }),
      groupBy: vitest.fn().mockResolvedValue([]),
      // why: Phase 3c qty-tracked flows call tx.bookingAsset.count when
      // deciding whether a shared pool can flip back to AVAILABLE.
      count: vitest.fn().mockResolvedValue(0),
      // why: reserveBooking's in-transaction eligibility probe looks for a
      // single slice whose asset is flagged unavailable.
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    // why: Phase 3d checkoutBooking queries tx.bookingModelRequest.findMany
    // to block RESERVED → ONGOING when model-level reservations haven't
    // been materialised into concrete BookingAsset rows yet.
    bookingModelRequest: {
      findMany: vitest.fn().mockResolvedValue([]),
      // why: removeAssets reads each affected request to decrement
      // `fulfilledQuantity` and clear `fulfilledAt`, then emits the
      // reversal event off the before-state it read here.
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
      // why: reserveBooking's eligibility probe falls back to counting model
      // reservations when a booking holds no concrete assets.
      count: vitest.fn().mockResolvedValue(0),
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
      // why: the booking-exit reconciler reads custody holders for a whole
      // batch in one query rather than counting per asset.
      findMany: vitest.fn().mockResolvedValue([]),
      // why: `getAssetAvailabilityBatch` sums in-custody units via
      // `custody.groupBy` instead of the singular primitive's `aggregate`.
      // Default to no rows — per-test overrides aren't needed unless a test
      // models custody-held units.
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    bookingSettings: {
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    // why: a check-in that CONSUMEs/LOSEs/DAMAGEs units lowers `Asset.quantity`,
    // so `reconcileManualPlacementsForStockDecrease` reads the manual placement
    // rows to keep `SUM(AssetLocation.quantity) <= Asset.quantity` true. Default
    // to no placements — tests that model placement drift override it.
    assetLocation: {
      findMany: vitest.fn().mockResolvedValue([]),
      update: vitest.fn().mockResolvedValue({}),
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
    displayName: null,
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

// why: wiring-only — the check-in decrement paths call the low-stock notifier
// after their transaction commits. Stub it so we assert the call (and its
// args) without running the real debounce/email logic (covered in
// low-stock.server.test.ts).
vitest.mock("~/modules/consumption-log/low-stock.server", () => ({
  checkAndNotifyLowStock: vitest.fn().mockResolvedValue(undefined),
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
  // why: every add-assets path now discharges model reservations through this
  // chokepoint. Its own behaviour is covered in
  // booking-model-request/service.server.test.ts; here we only care WHICH
  // assets each caller hands it, so the default is an empty result and tests
  // assert on the call argument.
  fulfilModelRequestsForAssets: vitest.fn().mockResolvedValue(new Map()),
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
      displayName: null,
    },
  ]),
}));

// why: recipient resolution has its own tests
// (notification-recipients.server.test.ts). Mocking the resolver lets each
// test control the resolved list so the email fan-out can be asserted without
// real org-settings lookups. Default: nobody resolves, so no emails fire.
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
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
      // Fixture default: this slice went out with the booking.
      checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
      checkedInAt: null,
    },
    {
      asset: { id: "asset-2", assetKits: [] },
      assetId: "asset-2",
      quantity: 1,
      id: "ba-2",
      // Fixture default: this slice went out with the booking.
      checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
      checkedInAt: null,
    },
    {
      asset: { id: "asset-3", assetKits: [{ kitId: "kit-1" }] },
      assetId: "asset-3",
      quantity: 1,
      id: "ba-3",
      // Fixture default: this slice went out with the booking.
      checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
      checkedInAt: null,
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
      kitSlices: [
        { assetId: "asset-1", assetKitId: "ak-1", kitId: "kit-1", quantity: 1 },
      ],
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingAssets: {
            create: [
              {
                assetId: "asset-1",
                quantity: 1,
                assetKitId: "ak-1",
                // Resolved by the module-level assetKit mock's derived kitId,
                // not from the `kitId` passed above — see that mock's `why:`.
                sourceKitId: "kit-of-ak-1",
              },
            ],
          },
        }),
      })
    );
  });

  it("stamps sourceKitId on kit-driven slices so provenance survives kit edits", async () => {
    // why: `assetKitId` is SET NULL'd when the asset leaves the kit, which
    // erases the fact that the slice came from a kit. `sourceKitId` must be
    // written at insert time or the information is unrecoverable later.
    //
    // The value must come from the org-scoped guard's lookup, NOT from the
    // caller: `sourceKitId`'s FK accepts any org's Kit, so a client-supplied
    // value would be a cross-org write. The input below therefore carries a
    // foreign kit id that must be ignored.
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValue(mockBookingData);
    // why: assertAssetKitsBelongToOrg returns the org-proven
    // `assetKitId -> kitId` map; "kit-real" is the membership's true owner.
    // `Once` (not `mockResolvedValue`) because `clearAllMocks` clears calls but
    // NOT implementations — a persistent mock here would silently leak this
    // `ak-a -> kit-real` answer into every later kit-slice test in the file.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValueOnce([
      { id: "ak-a", kitId: "kit-real" },
    ]);

    await createBooking({
      ...mockCreateBookingParams,
      assetIds: [],
      kitSlices: [
        {
          assetId: "asset-a",
          assetKitId: "ak-a",
          // A foreign / tampered value — must never reach the row.
          kitId: "kit-from-another-org",
          quantity: 2,
        },
      ],
    });

    expect(db.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingAssets: {
            create: [
              {
                assetId: "asset-a",
                quantity: 2,
                assetKitId: "ak-a",
                sourceKitId: "kit-real",
              },
            ],
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-3", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-3",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
    // the ONGOING→COMPLETE transition. All three slices carry `checkedOutAt`
    // (as every dispatched slice does in production) and asset-3 has no
    // recorded return, which keeps the booking in the partial (non-complete)
    // branch so txResult.booking resolves to bookingWithAssets (with name
    // set) and the note block succeeds. Also feeds the post-tx "outstanding"
    // count.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        quantity: 1,
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-2",
        quantity: 1,
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: { id: "asset-2", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-3",
        quantity: 1,
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: { id: "asset-3", type: AssetType.INDIVIDUAL },
      },
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
    // never scanned out under progressive checkout, so it carries no
    // `checkedOutAt` and cannot be checked in.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      assets: [
        { id: "asset-1", kitId: null },
        { id: "asset-2", kitId: null },
      ],
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
          checkedOutAt: null,
          checkedInAt: null,
        },
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

  it("checks in an all-at-once asset after a later scan recorded a checkout session", async () => {
    // The reported production failure. A booking checked out with the button
    // writes no PartialBookingCheckout rows; adding one asset later and
    // scanning only that one writes the booking's FIRST row. A booking-level
    // "does this booking have any rows?" test then declares every asset that
    // went out with the button to have never been checked out.
    //
    // `BookingAsset.checkedOutAt` is what makes this answerable: asset-1 was
    // flipped by the button (marker set), asset-2 was scanned later (marker
    // set, and a session row exists for it alone).
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          checkedOutAt: new Date("2026-08-26T14:45:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
          checkedOutAt: new Date("2026-08-26T17:08:29.000Z"),
          checkedInAt: null,
        },
      ],
    });

    // The booking's only session row — asset-2's later scan. Under the old
    // booking-level test this single row is what made asset-1 ineligible.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-2"] }]);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", title: "Asset 1" }]);

    await expect(
      partialCheckinBooking({
        ...mockPartialCheckinParams,
        assetIds: ["asset-1"],
      })
    ).resolves.not.toThrow();
  });

  it("still refuses an asset added to an ONGOING booking but never checked out", async () => {
    // The guard must keep working. `updateBookingAssets` deliberately does not
    // auto-check-out onto an ONGOING booking, so a newly added slice carries no
    // `checkedOutAt` and genuinely cannot be checked in.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          checkedOutAt: new Date("2026-08-26T14:45:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
          checkedOutAt: null,
          checkedInAt: null,
        },
      ],
    });

    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetIds: ["asset-1"] }]);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-2", title: "Asset 2" }]);

    await expect(
      partialCheckinBooking({
        ...mockPartialCheckinParams,
        assetIds: ["asset-2"],
      })
    ).rejects.toThrow(/never checked out/i);
  });

  it("reports an already checked-in asset as such, not as never checked out", async () => {
    // Refusing is right — it is a duplicate operation — but "never checked
    // out" is the wrong reason and sends the reader hunting the wrong bug.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          checkedOutAt: new Date("2026-08-26T14:45:00.000Z"),
          checkedInAt: new Date("2026-08-26T20:00:00.000Z"),
        },
      ],
    });

    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", title: "Asset 1" }]);

    await expect(
      partialCheckinBooking({
        ...mockPartialCheckinParams,
        assetIds: ["asset-1"],
      })
    ).rejects.toThrow(/already checked in/i);
  });

  it("lets an untagged claim through while a sibling slice is still out", async () => {
    expect.assertions(1);

    // A qty-tracked asset holds a standalone slice plus one per kit, so it can
    // be half reconciled and half still out. An untagged claim names no slice,
    // so it is a claim on whatever is left — refusing it as "already checked
    // in" would strand the outstanding slice with no operator workaround.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            assetKits: [],
            type: AssetType.QUANTITY_TRACKED,
          },
          assetId: "asset-1",
          quantity: 5,
          id: "ba-standalone",
          checkedOutAt: new Date("2026-08-26T10:00:00.000Z"),
          checkedInAt: new Date("2026-08-26T18:00:00.000Z"),
        },
        {
          asset: {
            id: "asset-1",
            assetKits: [],
            type: AssetType.QUANTITY_TRACKED,
          },
          assetId: "asset-1",
          quantity: 3,
          id: "ba-kit",
          assetKitId: "ak-1",
          checkedOutAt: new Date("2026-08-26T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
    });

    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);

    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", title: "Asset 1" }]);

    // Asserted on the message rather than on success: this covers the
    // eligibility guard, which runs before the quantity machinery, and that
    // machinery needs fixtures of its own. Passing whenever the guard stays
    // quiet keeps the test about the guard.
    const outcome = await partialCheckinBooking({
      ...mockPartialCheckinParams,
      assetIds: ["asset-1"],
    }).catch((cause: unknown) => cause);

    expect(String(outcome)).not.toMatch(/already checked in/i);
  });

  it("does not stamp a return on a slice that never went out", async () => {
    expect.assertions(2);

    // `sessionReconciledAssetIds` is asset-level while the marker is per
    // slice, and an asset's remaining sums across all of its slices — so a
    // slice added after checkout sits inside an asset a session can drive to
    // zero. Stamping it would record a return for units that never left.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-went-out",
          checkedOutAt: new Date("2026-08-26T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          // Still out and NOT scanned here, so this stays on the progressive
          // path instead of delegating to the full check-in.
          asset: { id: "asset-2", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-still-out",
          checkedOutAt: new Date("2026-08-26T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-3", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-added-later",
          checkedOutAt: null,
          checkedInAt: null,
        },
      ],
    });

    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      { assetId: "asset-1", asset: { type: AssetType.INDIVIDUAL } },
      { assetId: "asset-2", asset: { type: AssetType.INDIVIDUAL } },
      { assetId: "asset-3", asset: { type: AssetType.INDIVIDUAL } },
    ]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1", status: AssetStatus.CHECKED_OUT },
    ]);

    await partialCheckinBooking({
      ...mockPartialCheckinParams,
      assetIds: ["asset-1"],
    });

    // The progressive write is the one scoped by slice id; the full check-in
    // delegate writes booking-wide, and matching that instead would test a
    // guard this code path does not own.
    const markerCall = vitest
      .mocked(db.bookingAsset.updateMany)
      .mock.calls.find(
        ([args]) =>
          "checkedInAt" in (args?.data ?? {}) && "id" in (args?.where ?? {})
      )?.[0];

    expect(markerCall).toBeDefined();
    expect(markerCall?.where).toEqual(
      expect.objectContaining({
        id: { in: ["ba-went-out"] },
        checkedOutAt: { not: null },
      })
    );
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
      // The base fixture is DRAFT, but this scenario checks assets back IN and
      // mocks them CHECKED_OUT — a combination that cannot exist. Nothing read
      // the status before, so the mismatch went unnoticed.
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", assetKits: [] },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [] },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-2",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
      // Same fixture mismatch as the sibling test: the scenario is a booking
      // in flight, but the base fixture is DRAFT.
      status: BookingStatus.ONGOING,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-3", assetKits: [], type: AssetType.INDIVIDUAL },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t4",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          displayName: null,
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

  it("cannot be used to inject a Markdoc tag via the booking name", async () => {
    expect.assertions(3);

    // The reported vector: booking names are free-form user input and land in
    // Markdoc-rendered note content, so a name containing `{% … %}` became a
    // LIVE tag in the activity feed — an attacker-chosen link shown to anyone
    // viewing the booking. The note must carry the name as inert text.
    const payload = '{% link to="javascript:alert(1)" text="x" /%}';

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.DRAFT,
      custodianUserId: "user-1",
      name: "Old Name",
      tags: [],
    });
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ ...mockBookingData, name: payload });

    await updateBasicBooking({ ...mockUpdateBookingParams, name: payload });

    const noteCall = (
      bookingNoteService.createSystemBookingNote as ReturnType<typeof vitest.fn>
    ).mock.calls.find(
      ([args]) => args?.content?.includes("changed booking name")
    );

    expect(noteCall).toBeDefined();
    const { content } = noteCall![0];
    // Parsed the way the feed parses it: no tag node may exist.
    const tags = [...Markdoc.parse(content).walk()].filter(
      (node) => node.type === "tag"
    );
    expect(tags).toHaveLength(0);
    expect(content).not.toContain("{%");
  });

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
        displayName: null,
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
        displayName: null,
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
        displayName: null,
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
        displayName: null,
      },
      custodianTeamMember: {
        id: "old-team-member-1",
        name: "Old TM",
        user: {
          id: "old-custodian-1",
          firstName: "Old",
          lastName: "Custodian",
          displayName: null,
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

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
  ])("refuses to change the items on a %s booking", async (status) => {
    // All four callers DO check the status — but each in a read of its own,
    // before calling this function. A booking closed in between was still
    // written to. The guard now reads the status inside the same transaction
    // as the write, which closes that window rather than narrowing it.
    // (detail.dev D055)
    // why: the guard takes a row lock via raw SQL, so this is the read it
    // asserts on. Once, not persistent: clearAllMocks clears call history but
    // NOT implementations, and a persistent closed status would fail every
    // later test in this describe for the wrong reason.
    (db.$queryRaw as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      { status },
    ]);

    await expect(
      updateBookingAssets({
        id: "booking-1",
        organizationId: "org-1",
        assetIds: ["asset-1"],
        userId: "user-1",
      })
    ).rejects.toThrow(/closed records/);

    // The guard bails before anything else in the transaction runs: the asset
    // validation immediately after it never fires. Asserting on a downstream
    // effect rather than only on the throw, so this still fails if the guard is
    // moved somewhere that lets writes happen first.
    expect(db.asset.findMany).not.toHaveBeenCalled();
  });

  /**
   * The booking activity feed must record one add as ONE event.
   *
   * `updateBookingAssets` writes a booking-side note as a side effect, and the
   * only way to opt out used to be passing a non-empty `kitIds` — that flag was
   * standing in for "the caller writes its own note". A non-kit caller that also
   * wrote one (manage-assets) had no way to say so, so a single add produced two
   * rows. For one INDIVIDUAL asset they were byte-identical, because
   * `formatUnitCount` returns null off QUANTITY_TRACKED and the service's
   * single-asset wrapper then collapses to the same bare link the route emits.
   * A reader could not tell one add from two — the audit trail stated something
   * untrue, which is the one thing an audit trail may not do.
   */
  it("writes the booking-side note by default", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", title: "Asset 1" }]);

    await updateBookingAssets({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: ["asset-1"],
      userId: "user-1",
    });

    // Callers that do NOT compose their own note still get one — removing the
    // note wholesale would leave those feeds silent instead of duplicated.
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalled();
  });

  it("suppresses the booking-side note when the caller owns it", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([{ id: "asset-1", title: "Asset 1" }]);

    await updateBookingAssets({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: ["asset-1"],
      userId: "user-1",
      skipBookingNote: true,
    });

    expect(bookingNoteService.createSystemBookingNote).not.toHaveBeenCalled();
  });

  /**
   * Model reservations are discharged by an asset ARRIVING on the booking.
   * `updateBookingAssets` is the "Manage assets" path, and that dialog reposts
   * the operator's full selection on every save — so the set of assets it
   * touched is NOT the set of assets that are new. Keying fulfilment off the
   * former lets a plain re-save decrement the reservation again, and a 3-unit
   * reservation reaches 3/3 with only two physical assets behind it. Nothing
   * else in the system would flag that: the counts simply lie.
   */
  it("only offers newly added assets for model-request fulfilment", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.DRAFT,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "asset-1", title: "Asset 1" },
      { id: "asset-2", title: "Asset 2" },
    ]);
    // `asset-1` is already on the booking — the operator merely resubmitted it.
    //@ts-expect-error missing vitest type
    // why: the pre-existing read now selects `assetKitId` so it can tell a
    // standalone row from a kit slice — `null` means standalone.
    db.bookingAsset.findMany.mockResolvedValue([
      { assetId: "asset-1", assetKitId: null },
    ]);

    await updateBookingAssets({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: ["asset-1", "asset-2"],
      userId: "user-1",
    });

    const handedOver = vitest.mocked(fulfilModelRequestsForAssets).mock
      .calls[0]?.[0].assets;

    expect(handedOver?.map((a) => a.id)).toEqual(["asset-2"]);
    // Stated explicitly: the resubmitted asset must not reach the helper at
    // all, rather than being filtered somewhere downstream.
    expect(handedOver?.map((a) => a.id)).not.toContain("asset-1");
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
      // `from`/`to` are selected for the QUANTITY_TRACKED windowed-availability
      // guard (skipped here since the booking is DRAFT, not ACTIVE).
      select: { id: true, name: true, status: true, from: true, to: true },
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
    // both assetKitIds (and the shared assetId twice), plus the matching
    // per-slice `sourceKitId` bindings (server-resolved, and named in the
    // INSERT's column list).
    expect.assertions(6);

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

    // why: assertAssetKitsBelongToOrg returns the org-proven
    // `assetKitId -> kitId` map that supplies `sourceKitId`. The client-side
    // `kitId`s below are deliberately foreign and must be ignored.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      { id: "ak-kit-1", kitId: "kit-1" },
      { id: "ak-kit-2", kitId: "kit-2" },
    ]);

    const params = {
      id: "booking-1",
      organizationId: "org-1",
      // No standalone assets — this mirrors a kit-add submission.
      assetIds: [] as string[],
      // `kitIds` is always passed on the kit-add path; it skips the
      // standalone-asset note block (kit notes are created separately).
      kitIds: ["kit-1", "kit-2"],
      kitSlices: [
        {
          assetId: "asset-shared",
          assetKitId: "ak-kit-1",
          kitId: "kit-from-another-org",
          quantity: 10,
        },
        {
          assetId: "asset-shared",
          assetKitId: "ak-kit-2",
          kitId: "kit-from-another-org",
          quantity: 5,
        },
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

    // The `sourceKitId` bindings must reach the statement too — the durable
    // provenance column is a separate unnest() array, so a dropped binding
    // would be invisible without asserting on it. Pinned by ORDER (not
    // `arrayContaining`) so it stays index-aligned with the assetKitIds
    // array: `["kit-2","kit-1"]` would silently swap each row's provenance.
    // Values are the SERVER-resolved kit ids, not the foreign ones the caller
    // supplied.
    const sourceKitIdArray = kitDrivenCall?.find(
      (arg: unknown) =>
        Array.isArray(arg) && arg.includes("kit-1") && arg.includes("kit-2")
    );
    expect(sourceKitIdArray).toEqual(["kit-1", "kit-2"]);

    // The binding array is worthless if the column isn't in the INSERT's
    // column list — the template strings live in `call[0]`, so assert the
    // statement text actually names `sourceKitId`. Per
    // `.claude/rules/raw-sql-respects-prisma-map.md` (item 4): typecheck
    // cannot validate raw SQL, so a column-name regression is only ever
    // caught by a test like this.
    expect(kitDrivenCall?.[0]?.join("")).toContain("sourceKitId");
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
    // why: `clearAllMocks` resets calls but NOT implementations, so the
    // preceding test's two-row assetKit mock would leak in and make
    // assertAssetKitsBelongToOrg's count check reject this single-slice call.
    (db.assetKit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "ak-1", kitId: "kit-1" },
    ]);
    // why: the asset already exists on the booking as a standalone row.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([{ assetId: "asset-1", assetKitId: null }]);

    await updateBookingAssets({
      id: "booking-1",
      organizationId: "org-1",
      assetIds: [],
      kitIds: ["kit-1"],
      kitSlices: [
        { assetId: "asset-1", assetKitId: "ak-1", kitId: "kit-1", quantity: 1 },
      ],
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

  /**
   * The windowed QUANTITY_TRACKED availability guard wired into
   * `updateBookingAssets` (over-commit-on-add). Only fires for bookings
   * already in an ACTIVE status (RESERVED/ONGOING/OVERDUE) — a DRAFT
   * booking hasn't committed to holding stock yet, so `reserveBooking`'s
   * own guard is the one responsible for validating it at the DRAFT →
   * RESERVED transition.
   *
   * These tests exercise `assertAssetQuantitiesAvailable`'s real (unmocked)
   * composition — via `getAssetAvailabilityBatch` — against fully
   * controlled fixture data, mirroring the `checkoutBooking` QT-guard
   * describe above but for the BATCHED primitive's query shapes
   * (`asset.findMany({ select: { id, quantity } })`,
   * `bookingAsset.findMany` with `assetId: { in: [...] }`).
   */
  describe("QUANTITY_TRACKED availability guard on ACTIVE bookings", () => {
    const QT_ASSET_ID = "asset-qty-add";

    const qtyParams = {
      id: "booking-1",
      organizationId: "org-1",
      assetIds: [QT_ASSET_ID],
      quantities: { [QT_ASSET_ID]: 7 },
    };

    /**
     * Installs `db.asset.findMany` so BOTH `updateBookingAssets`'s own
     * `validAssets` validation read AND `getAssetAvailabilityBatch`'s
     * `{id, quantity}` read (same underlying mock, different `select`
     * shapes — the mock doesn't project) resolve from one fixture: a
     * single QUANTITY_TRACKED asset with a fixed pool `total`.
     */
    function mockQtyAssetTotal(total: number) {
      (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { id?: { in?: string[] } } }) => {
          const ids = args?.where?.id?.in ?? [];
          return Promise.resolve(
            ids.map((id) => ({
              id,
              type: AssetType.QUANTITY_TRACKED,
              title: "Folding Chairs",
              unitOfMeasure: "chairs",
              quantity: total,
            }))
          );
        }
      );
    }

    /**
     * Installs `db.bookingAsset.findMany` as a router standing in for the
     * TWO distinct queries the batched guard drives:
     *   1. `computeCheckedOutBatch`'s pivots read (`booking.status IN
     *      [ONGOING, OVERDUE]`) — always empty; none of these fixtures
     *      model a unit physically checked out elsewhere.
     *   2. `getAssetAvailabilityBatch`'s reserved-rows read
     *      (`booking.status IN [RESERVED, ONGOING, OVERDUE]`), applying the
     *      same date-overlap test a real Postgres query would apply via the
     *      `booking.OR` clause. Mirrors the `checkoutBooking` describe's
     *      `mockReservedRows` helper above, adapted for the batch
     *      primitive's `assetId: { in: [...] }` where-shape.
     */
    function mockOtherReservations(
      rows: Array<{
        bookingId: string;
        quantity: number;
        from: Date;
        to: Date;
      }>
    ) {
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        const statuses: string[] = args?.where?.booking?.status?.in ?? [];
        if (!statuses.includes(BookingStatus.RESERVED)) {
          // computeCheckedOutBatch's pivots query.
          return Promise.resolve([]);
        }
        const excludeId: string | undefined = args?.where?.bookingId?.not;
        const orBranches = args?.where?.booking?.OR as
          | Array<
              | { status: string }
              | { AND: [{ from: { lt: Date } }, { to: { gt: Date } }] }
            >
          | undefined;
        const dateBranch = orBranches?.find(
          (
            branch
          ): branch is {
            AND: [{ from: { lt: Date } }, { to: { gt: Date } }];
          } => "AND" in branch
        );
        const matching = rows
          .filter((r) => r.bookingId !== excludeId)
          .filter((r) => {
            if (!dateBranch) return true;
            return (
              r.from < dateBranch.AND[0].from.lt &&
              r.to > dateBranch.AND[1].to.gt
            );
          })
          .map((r) => ({
            assetId: QT_ASSET_ID,
            bookingId: r.bookingId,
            quantity: r.quantity,
            booking: { from: r.from, to: r.to },
          }));
        return Promise.resolve(matching);
      });
    }

    beforeEach(() => {
      vitest.clearAllMocks();
      mockQtyAssetTotal(10);
      mockOtherReservations([]);
    });

    it("rejects adding a QT asset beyond windowed availability to a RESERVED booking", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        name: "Test Booking",
        status: BookingStatus.RESERVED,
        from: futureFromDate,
        to: futureToDate,
      };
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

      // Another RESERVED booking already holds 5 of the 10-unit pool, in
      // the SAME window as this add — only 5 left, but this call wants 7.
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: futureFromDate,
          to: futureToDate,
        },
      ]);

      await expect(updateBookingAssets(qtyParams)).rejects.toThrow(
        '"Folding Chairs": requested 7, only 5'
      );
    });

    it("does NOT block the same over-commit on a DRAFT booking (reserve-time guard covers it instead)", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        name: "Test Booking",
        status: BookingStatus.DRAFT,
        from: futureFromDate,
        to: futureToDate,
      };
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: futureFromDate,
          to: futureToDate,
        },
      ]);

      const result = await updateBookingAssets(qtyParams);

      expect(result).toEqual(mockBooking);
    });

    it("allows adding a QT asset when the other reservation's window does not overlap", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        name: "Test Booking",
        status: BookingStatus.RESERVED,
        from: futureFromDate,
        to: futureToDate,
      };
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

      // Another booking reserves 5 of the pool, but its window starts a
      // full day after this booking's `to` — never concurrent.
      const otherFrom = new Date(futureToDate.getTime() + 24 * 60 * 60 * 1000);
      const otherTo = new Date(
        otherFrom.getTime() + HOURS_BETWEEN_FROM_AND_TO * 60 * 60 * 1000
      );
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: otherFrom,
          to: otherTo,
        },
      ]);

      const result = await updateBookingAssets(qtyParams);

      expect(result).toEqual(mockBooking);
    });

    it("allows REDUCING an already-over-committed booking even when the pool is exhausted (directional #2725)", async () => {
      expect.assertions(1);

      const mockBooking = {
        id: "booking-1",
        name: "Test Booking",
        status: BookingStatus.RESERVED,
        from: futureFromDate,
        to: futureToDate,
      };
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

      // This booking ALREADY holds 8 standalone units of the asset — the
      // directional guard reads this via `bookingAsset.groupBy`.
      (
        db.bookingAsset.groupBy as ReturnType<typeof vitest.fn>
      ).mockResolvedValue([{ assetId: QT_ASSET_ID, _sum: { quantity: 8 } }]);

      // Another overlapping booking holds 5 of the 10-unit pool, so only 5 is
      // bookable for OTHERS — this booking is already over-committed (holds 8).
      // `qtyParams` reduces it to 7: still above the 5 bookable, but 7 <= its
      // current 8, so the directional guard must ALLOW it (the #2725 recovery
      // rule — without `currentQuantity` this would be rejected as an increase).
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: futureFromDate,
          to: futureToDate,
        },
      ]);

      const result = await updateBookingAssets(qtyParams);

      expect(result).toEqual(mockBooking);
    });
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
    // Healthy eligibility on the OUTER client. The tests below hand the
    // transaction a client that disagrees, so a guard reading through `db`
    // instead of `tx` sees a booking that is fine and fails to refuse.
    //@ts-expect-error missing vitest type
    db.bookingAsset.count.mockResolvedValue(1);
    //@ts-expect-error missing vitest type
    db.bookingAsset.findFirst.mockResolvedValue(null);
    //@ts-expect-error missing vitest type
    db.bookingModelRequest.count.mockResolvedValue(1);
  });

  afterEach(() => {
    // Restore the module-level defaults: implementations set with
    // `mockResolvedValue` survive `clearAllMocks`, so without this the
    // reserve-friendly values above leak into every later describe.
    //@ts-expect-error missing vitest type
    db.bookingAsset.count.mockResolvedValue(0);
    //@ts-expect-error missing vitest type
    db.bookingAsset.findFirst.mockResolvedValue(null);
    //@ts-expect-error missing vitest type
    db.bookingModelRequest.count.mockResolvedValue(0);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callbackOrArray) =>
      typeof callbackOrArray === "function"
        ? callbackOrArray(db)
        : Promise.all(callbackOrArray)
    );
  });

  /**
   * Hands the transaction callback a client whose eligibility answers differ
   * from the outer `db` mock.
   *
   * This is what makes the tests below able to tell an IN-transaction guard
   * from a pre-transaction one. With the default `$transaction` mock the
   * callback receives `db` itself, so `tx.x` IS `db.x` and relocating the
   * guard out of the transaction — the exact regression this describe exists
   * to prevent — would leave every assertion green.
   */
  function installTxEligibility(eligibility: {
    sliceCount: number;
    unavailableSlice: { id: string } | null;
    modelRequestCount: number;
  }) {
    const tx = {
      ...db,
      bookingAsset: {
        ...db.bookingAsset,
        count: vitest.fn().mockResolvedValue(eligibility.sliceCount),
        findFirst: vitest.fn().mockResolvedValue(eligibility.unavailableSlice),
      },
      bookingModelRequest: {
        ...db.bookingModelRequest,
        count: vitest.fn().mockResolvedValue(eligibility.modelRequestCount),
      },
    };

    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callbackOrArray) =>
      typeof callbackOrArray === "function"
        ? callbackOrArray(tx)
        : Promise.all(callbackOrArray)
    );

    return tx;
  }

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

  /**
   * Race-safe twin of the caller-side checks. The web overview only disables
   * its Reserve button from loader flags and the mobile route checks before it
   * reads working hours and settings, so both leave a window in which a
   * concurrent edit can empty the booking or mark an asset unavailable.
   *
   * Every test here states the healthy answer on the outer `db` mock and the
   * concurrently-edited answer on the transaction client, so they fail both
   * ways: deleting the guard drops the refusal, and moving it back OUT of the
   * transaction makes it read the stale outer values and also drop it.
   */
  describe("eligibility re-check on the read immediately before the write", () => {
    /** The booking as the outer read still sees it: one healthy asset. */
    const healthyOuterRead = {
      ...mockBookingData,
      status: BookingStatus.DRAFT,
      from: mockReserveParams.from,
      to: mockReserveParams.to,
      modelRequests: [],
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            title: "Asset 1",
            status: "AVAILABLE",
            availableToBook: true,
            bookingAssets: [],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-1",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
    };

    it("refuses a booking that lost its last asset and holds no model request", async () => {
      expect.assertions(1);

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(healthyOuterRead);
      // Emptied by a concurrent request after the outer read.
      installTxEligibility({
        sliceCount: 0,
        unavailableSlice: null,
        modelRequestCount: 0,
      });

      await expect(reserveBooking(mockReserveParams)).rejects.toThrow(
        BOOKING_RESERVE_BLOCKED_LABELS.NOTHING_TO_RESERVE
      );
    });

    it("reserves a booking that holds only a model request", async () => {
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...mockBookingData,
        status: BookingStatus.DRAFT,
        from: mockReserveParams.from,
        to: mockReserveParams.to,
        bookingAssets: [],
        modelRequests: [{ id: "mr-1", assetModelId: "model-1", quantity: 2 }],
      });
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBookingData,
        status: BookingStatus.RESERVED,
        bookingAssets: [],
        modelRequests: [],
      });
      installTxEligibility({
        sliceCount: 0,
        unavailableSlice: null,
        modelRequestCount: 1,
      });

      await expect(reserveBooking(mockReserveParams)).resolves.toBeDefined();
    });

    it("refuses when an asset was marked unavailable after the caller checked", async () => {
      expect.assertions(1);

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(healthyOuterRead);
      // Flipped to unavailable by another request between the two reads.
      installTxEligibility({
        sliceCount: 1,
        unavailableSlice: { id: "ba-1" },
        modelRequestCount: 0,
      });

      await expect(reserveBooking(mockReserveParams)).rejects.toThrow(
        BOOKING_RESERVE_BLOCKED_LABELS.UNAVAILABLE_ASSETS
      );
    });

    it("reads eligibility through the transaction client, not the outer one", async () => {
      expect.assertions(3);

      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(healthyOuterRead);
      const tx = installTxEligibility({
        sliceCount: 1,
        unavailableSlice: null,
        modelRequestCount: 0,
      });
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...healthyOuterRead,
        status: BookingStatus.RESERVED,
      });

      await reserveBooking(mockReserveParams);

      // The probes ran on the transaction client...
      expect(tx.bookingAsset.count).toHaveBeenCalledWith({
        where: { bookingId: mockReserveParams.id },
      });
      expect(tx.bookingAsset.findFirst).toHaveBeenCalledWith({
        where: {
          bookingId: mockReserveParams.id,
          asset: { availableToBook: false },
        },
        select: { id: true },
      });
      // ...and not on the outer one.
      expect(db.bookingAsset.count).not.toHaveBeenCalled();
    });
  });

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
            availableToBook: true,
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t101",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: {
            id: "asset-2",
            title: "Asset 2",
            status: "AVAILABLE",
            availableToBook: true,
            bookingAssets: [], // No conflicting bookings
          },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t102",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
            availableToBook: true,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  /**
   * The windowed QUANTITY_TRACKED availability guard wired into the
   * DRAFT → RESERVED status-flip transaction (over-commit-on-create).
   * `hasAssetBookingConflicts` (tested above) always returns `false` for
   * QUANTITY_TRACKED rows, so without this guard a DRAFT booking whose QT
   * asset already exceeds the windowed pool could commit straight to
   * RESERVED unchecked.
   *
   * Mirrors the `checkoutBooking` QT-guard describe below (same
   * `assertAssetQuantitiesAvailable` → `getAssetAvailabilityBatch`
   * composition, run for real against controlled fixture data) but adapted
   * for the batched primitive's query shapes.
   */
  describe("QUANTITY_TRACKED availability guard on the DRAFT → RESERVED transition", () => {
    const QT_ASSET_ID = "asset-qty-reserve";

    /** Builds a DRAFT booking carrying a single QUANTITY_TRACKED asset row. */
    function draftBookingWithQtyAsset(quantity: number) {
      return {
        ...mockBookingData,
        status: BookingStatus.DRAFT,
        from: mockReserveParams.from,
        to: mockReserveParams.to,
        bookingAssets: [
          {
            asset: {
              id: QT_ASSET_ID,
              title: "Folding Chairs",
              type: AssetType.QUANTITY_TRACKED,
              availableToBook: true,
              status: "AVAILABLE",
              unitOfMeasure: "chairs",
              // QUANTITY_TRACKED assets are exempt from the whole-asset
              // conflict guard — several bookings may legitimately share
              // the pool — so this stays empty regardless of fixture.
              bookingAssets: [],
            },
            assetId: QT_ASSET_ID,
            quantity,
            id: "ba-qty-1",
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
          },
        ],
      };
    }

    /**
     * Installs `db.asset.findMany` so `getAssetAvailabilityBatch`'s
     * `{id, quantity}` read resolves the QT asset's pool total.
     */
    function mockAssetTotal(total: number) {
      (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { id?: { in?: string[] } } }) => {
          const ids = args?.where?.id?.in ?? [];
          return Promise.resolve(ids.map((id) => ({ id, quantity: total })));
        }
      );
    }

    /**
     * Installs `db.bookingAsset.findMany` as a router standing in for the
     * batched guard's TWO queries (checked-out pivots + reserved rows) —
     * see the analogous helper in the `updateBookingAssets` QT-guard
     * describe and the `checkoutBooking` describe below.
     */
    function mockOtherReservations(
      rows: Array<{
        bookingId: string;
        quantity: number;
        from: Date;
        to: Date;
      }>
    ) {
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        const statuses: string[] = args?.where?.booking?.status?.in ?? [];
        if (!statuses.includes(BookingStatus.RESERVED)) {
          // computeCheckedOutBatch's pivots query.
          return Promise.resolve([]);
        }
        const excludeId: string | undefined = args?.where?.bookingId?.not;
        const orBranches = args?.where?.booking?.OR as
          | Array<
              | { status: string }
              | { AND: [{ from: { lt: Date } }, { to: { gt: Date } }] }
            >
          | undefined;
        const dateBranch = orBranches?.find(
          (
            branch
          ): branch is {
            AND: [{ from: { lt: Date } }, { to: { gt: Date } }];
          } => "AND" in branch
        );
        const matching = rows
          .filter((r) => r.bookingId !== excludeId)
          .filter((r) => {
            if (!dateBranch) return true;
            return (
              r.from < dateBranch.AND[0].from.lt &&
              r.to > dateBranch.AND[1].to.gt
            );
          })
          .map((r) => ({
            assetId: QT_ASSET_ID,
            bookingId: r.bookingId,
            quantity: r.quantity,
            booking: { from: r.from, to: r.to },
          }));
        return Promise.resolve(matching);
      });
    }

    beforeEach(() => {
      vitest.clearAllMocks();
      mockAssetTotal(10);
      mockOtherReservations([]);
    });

    it("rejects DRAFT → RESERVED when the QT asset would exceed the windowed pool of OTHER overlapping bookings", async () => {
      expect.assertions(2);

      const mockBooking = draftBookingWithQtyAsset(7);
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

      // Another RESERVED booking already holds 5 of the 10-unit pool, in
      // the SAME window as this reservation — only 5 left, but this draft
      // wants 7.
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: mockReserveParams.from,
          to: mockReserveParams.to,
        },
      ]);

      await expect(reserveBooking(mockReserveParams)).rejects.toThrow(
        '"Folding Chairs": requested 7, only 5'
      );
      // The guard throws inside the transaction, before the status write.
      expect(db.booking.update).not.toHaveBeenCalled();
    });

    it("reserves a KIT-only QT asset even when the free pool is exhausted (kit slices skip the free-pool guard)", async () => {
      expect.assertions(1);

      // The QT asset is on this booking ONLY as a kit-driven slice
      // (`assetKitId` set). Its units come from the kit's own allocation —
      // already subtracted from `bookable` via `inKits` — NOT the free pool,
      // so the reserve-time free-pool guard must skip it even though OTHER
      // bookings have exhausted the standalone pool. Counting the kit slice
      // against `bookable` would wrongly reject this reservation (Codex P1).
      const base = draftBookingWithQtyAsset(7);
      const kitOnlyBooking = {
        ...base,
        bookingAssets: [
          { ...base.bookingAssets[0], assetKitId: "kit-1", id: "ba-kit-1" },
        ],
      };
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(kitOnlyBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...kitOnlyBooking,
        status: BookingStatus.RESERVED,
      });

      // Other bookings hold the ENTIRE 10-unit standalone pool in this window.
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 10,
          from: mockReserveParams.from,
          to: mockReserveParams.to,
        },
      ]);

      await reserveBooking(mockReserveParams);

      expect(db.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: BookingStatus.RESERVED }),
        })
      );
    });

    it("reserves successfully when the other booking's window does not overlap", async () => {
      expect.assertions(1);

      const mockBooking = draftBookingWithQtyAsset(7);
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.RESERVED,
      });

      // Another booking reserves 5 of the pool, but its window starts a
      // full day after this booking's `to` — never concurrent.
      const otherFrom = new Date(
        mockReserveParams.to.getTime() + 24 * 60 * 60 * 1000
      );
      const otherTo = new Date(
        otherFrom.getTime() + HOURS_BETWEEN_FROM_AND_TO * 60 * 60 * 1000
      );
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: otherFrom,
          to: otherTo,
        },
      ]);

      await reserveBooking(mockReserveParams);

      expect(db.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "booking-1" },
          data: expect.objectContaining({ status: BookingStatus.RESERVED }),
        })
      );
    });

    it("reserves successfully at exactly the remaining bookable amount (no increase beyond the pool)", async () => {
      expect.assertions(1);

      const mockBooking = draftBookingWithQtyAsset(5);
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({
        ...mockBooking,
        status: BookingStatus.RESERVED,
      });

      // Another overlapping RESERVED booking already holds 5 of the
      // 10-unit pool — exactly 5 left, and this draft requests exactly 5
      // (not more): `requestedQuantity > bookable` is false at the
      // boundary, so this must NOT be rejected (see the directional
      // guard's #2725 recovery rule — exact capacity always passes).
      mockOtherReservations([
        {
          bookingId: "other-booking",
          quantity: 5,
          from: mockReserveParams.from,
          to: mockReserveParams.to,
        },
      ]);

      await reserveBooking(mockReserveParams);

      expect(db.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "booking-1" },
          data: expect.objectContaining({ status: BookingStatus.RESERVED }),
        })
      );
    });
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("records the residue of a partially-scanned qty slice as a tagged session row", async () => {
    expect.assertions(1);

    // A QT slice with 3 of 8 units already dispatched by a progressive scan
    // (slice stamped + a 3-unit tagged session). The full checkout sends the
    // remaining 5 out and must record them — session attribution otherwise
    // reads the asset as 3 dispatched and completion could settle the booking
    // with 5 units still out.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-qty",
            assetKits: [{ kitId: "kit-1" }],
            title: "Cables",
            type: AssetType.QUANTITY_TRACKED,
            status: "AVAILABLE",
            bookingAssets: [],
          },
          assetId: "asset-qty",
          quantity: 8,
          id: "ba-qty",
          // why: kit-driven slice — keeps the free-pool availability sweep
          // (which needs the full availability query chain) out of this test;
          // the residue derivation itself is kit/standalone-agnostic.
          assetKitId: "ak-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
    };
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce({ ...mockBooking, status: BookingStatus.ONGOING });
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });
    // why: the residue derivation reads pre-stamped slices (checkedOutAt
    // filter); any other bookingAsset read in the flow gets an empty list.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation((args?: { where?: { checkedOutAt?: unknown } }) =>
      Promise.resolve(
        args?.where?.checkedOutAt
          ? [
              {
                id: "ba-qty",
                assetId: "asset-qty",
                quantity: 8,
                assetKitId: "ak-1",
              },
            ]
          : []
      )
    );
    // why: the prior progressive scan recorded 3 units against this slice.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      { assetIds: ["asset-qty"], quantities: [3], bookingAssetIds: ["ba-qty"] },
    ]);

    await checkoutBooking(mockCheckoutParams);

    expect(db.partialBookingCheckout.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking-1",
        assetIds: ["asset-qty"],
        quantities: [5],
        bookingAssetIds: ["ba-qty"],
        checkoutCount: 1,
      }),
    });
  });

  it("tops up checkedOutQuantity by the same residue it records as a session", async () => {
    expect.assertions(2);

    // Same shape as above: 3 of 8 units already scanned out, 5 departing now.
    // The stored counter and the session-derived one must agree — the
    // departure statement cannot carry this slice, because it adds a whole
    // booked quantity while only the residue leaves here.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-qty",
            assetKits: [{ kitId: "kit-1" }],
            title: "Cables",
            type: AssetType.QUANTITY_TRACKED,
            status: "AVAILABLE",
            bookingAssets: [],
          },
          assetId: "asset-qty",
          quantity: 8,
          id: "ba-qty",
          assetKitId: "ak-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
    };
    // why: the flow reads the booking twice — once to validate, once after the
    // status write — and the second read must come back ONGOING or the
    // post-checkout branch takes the not-yet-started path.
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce({ ...mockBooking, status: BookingStatus.ONGOING });
    // why: the status write itself is not under test here; it only has to
    // resolve so the transaction reaches the counter writes below.
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });
    // why: the residue derivation reads pre-stamped slices via the
    // `checkedOutAt` filter. Every other slice read in this flow gets an empty
    // list, so only that one shapes the result.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation((args?: { where?: { checkedOutAt?: unknown } }) =>
      Promise.resolve(
        args?.where?.checkedOutAt
          ? [
              {
                id: "ba-qty",
                assetId: "asset-qty",
                quantity: 8,
                assetKitId: "ak-1",
              },
            ]
          : []
      )
    );
    // why: the earlier progressive scan recorded 3 of this slice's 8 units,
    // which is what leaves a 5-unit residue for this checkout to record.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      { assetIds: ["asset-qty"], quantities: [3], bookingAssetIds: ["ba-qty"] },
    ]);

    await checkoutBooking(mockCheckoutParams);

    // Only the counter writes; `updateMany` also stamps the slice markers.
    const counterWrites = (
      db.bookingAsset.updateMany as unknown as {
        mock: {
          calls: Array<
            [
              {
                where?: { id?: { in?: string[] } };
                data?: { checkedOutQuantity?: { increment?: number } };
              },
            ]
          >;
        };
      }
    ).mock.calls.filter((c) => c[0]?.data?.checkedOutQuantity !== undefined);

    expect(counterWrites).toHaveLength(1);
    expect(counterWrites[0][0]).toEqual({
      where: { id: { in: ["ba-qty"] } },
      data: { checkedOutQuantity: { increment: 5 } },
    });
  });

  it("counts a re-dispatched slice once, not its quantity plus a residue", async () => {
    expect.assertions(2);

    // 3 of 8 units scanned out earlier, then the slice came back IN FULL, and
    // now departs again whole. The departure statement adds its 8; the residue
    // top-up must not also add 5, or the counter claims 13 units left when 8
    // did. The residue session row is still written — that records the
    // dispatch, the counter records the units.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-qty",
            assetKits: [{ kitId: "kit-1" }],
            title: "Cables",
            type: AssetType.QUANTITY_TRACKED,
            status: "AVAILABLE",
            bookingAssets: [],
          },
          assetId: "asset-qty",
          quantity: 8,
          id: "ba-qty",
          assetKitId: "ak-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: new Date("2026-01-02T10:00:00.000Z"),
        },
      ],
    };
    // why: as above — two booking reads, the second of which must report
    // ONGOING for the flow to continue past the status write.
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce({ ...mockBooking, status: BookingStatus.ONGOING });
    // why: the status write only has to resolve; it is not what this asserts.
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });
    // why: this flow issues two slice reads with different shapes — the
    // pre-stamp scan keys on `checkedOutAt`, the departure scan on `OR`. A
    // fully-returned slice answers BOTH, which is what creates the overlap
    // this test pins.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation(
      (args?: { where?: { checkedOutAt?: unknown; OR?: unknown } }) => {
        if (args?.where?.checkedOutAt) {
          return Promise.resolve([
            {
              id: "ba-qty",
              assetId: "asset-qty",
              quantity: 8,
              assetKitId: "ak-1",
            },
          ]);
        }
        if (args?.where?.OR) {
          return Promise.resolve([{ id: "ba-qty", quantity: 8 }]);
        }
        return Promise.resolve([]);
      }
    );
    // why: the earlier progressive scan recorded 3 of this slice's 8 units, so
    // the residue derivation sees 5 outstanding and would otherwise top up.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      { assetIds: ["asset-qty"], quantities: [3], bookingAssetIds: ["ba-qty"] },
    ]);

    await checkoutBooking(mockCheckoutParams);

    const counterWrites = (
      db.bookingAsset.updateMany as unknown as {
        mock: {
          calls: Array<
            [
              {
                where?: { id?: { in?: string[] } };
                data?: { checkedOutQuantity?: { increment?: number } };
              },
            ]
          >;
        };
      }
    ).mock.calls.filter((c) => c[0]?.data?.checkedOutQuantity !== undefined);

    // Exactly one counter write, and it is the whole-slice departure.
    expect(counterWrites).toHaveLength(1);
    expect(counterWrites[0][0]).toEqual({
      where: { id: { in: ["ba-qty"] } },
      data: { checkedOutQuantity: { increment: 8 } },
    });
  });

  it("clears the stale check-in marker on a slice that departs a second time", async () => {
    expect.assertions(3);

    // Same slice as above: it went out, came back IN FULL, and departs again.
    // The counter already counts it. The markers have to move with it, or the
    // row still reads "checked in" while the units are gone, and the
    // completion gate lets the booking close on an asset that is out.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      bookingAssets: [
        {
          asset: {
            id: "asset-qty",
            assetKits: [{ kitId: "kit-1" }],
            title: "Cables",
            type: AssetType.QUANTITY_TRACKED,
            status: "AVAILABLE",
            bookingAssets: [],
          },
          assetId: "asset-qty",
          quantity: 8,
          id: "ba-qty",
          assetKitId: "ak-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: new Date("2026-01-02T10:00:00.000Z"),
        },
      ],
    };
    // why: two booking reads, the second reporting ONGOING so the flow
    // continues past the status write.
    (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(mockBooking)
      .mockResolvedValueOnce({ ...mockBooking, status: BookingStatus.ONGOING });
    // why: the status write only has to resolve; it is not what this asserts.
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ id: "booking-1" });
    // why: the departure scan keys on `OR`, and its ids are what the marker
    // write must reuse. A fully-returned slice answers that scan.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation(
      (args?: { where?: { checkedOutAt?: unknown; OR?: unknown } }) => {
        if (args?.where?.OR) {
          return Promise.resolve([{ id: "ba-qty", quantity: 8 }]);
        }
        return Promise.resolve([]);
      }
    );

    await checkoutBooking(mockCheckoutParams);

    const markerWrites = (
      db.bookingAsset.updateMany as unknown as {
        mock: {
          calls: Array<
            [
              {
                where?: unknown;
                data?: { checkedOutAt?: unknown; checkedInAt?: unknown };
              },
            ]
          >;
        };
      }
    ).mock.calls.filter((c) => c[0]?.data?.checkedOutAt !== undefined);

    expect(markerWrites).toHaveLength(1);
    // Keyed on the departing ids, not on `checkedOutAt: null`, which this
    // already-stamped slice would never match.
    expect(markerWrites[0][0].where).toEqual({ id: { in: ["ba-qty"] } });
    // And the check-in that answered the first trip is cleared.
    expect(markerWrites[0][0].data).toMatchObject({ checkedInAt: null });
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { name: "Dell Latitude 5550" },
      },
      {
        id: "mr-2",
        bookingId: "booking-1",
        assetModelId: "am-2",
        quantity: 3,
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
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
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { name: "Dell Latitude 5550" },
      },
      {
        id: "mr-2",
        bookingId: "booking-1",
        assetModelId: "am-2",
        quantity: 3,
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  /**
   * Task 11 (QT-availability unification, GitHub #2724) — the
   * QUANTITY_TRACKED checkout guard used to sum every RESERVED/ONGOING/
   * OVERDUE reservation for an asset GLOBALLY (all-time), so three
   * non-overlapping bookings of 7 against a 10-qty asset would wrongly
   * block each other's checkout. The guard is now windowed by THIS
   * booking's own `[from, to]` via `getAssetAvailability` — only
   * reservations that actually overlap this booking's dates count.
   *
   * These tests exercise the guard through `checkoutBooking` (the public
   * entry point) rather than the internal `checkoutBookingWritesWithinTx`
   * helper directly, since that helper is not exported. The extra mock
   * surface (`asset.findUniqueOrThrow`, `assetKit.aggregate`) added to the
   * shared `db` mock above, plus the `bookingAsset.findMany` router below,
   * make `getAssetAvailability`'s real (unmocked) composition run against
   * fully-controlled fixture data — a behavioral test of the actual
   * windowing math, not a mock-call assertion.
   */
  describe("QUANTITY_TRACKED availability guard is windowed, not global (Task 11)", () => {
    const CAMERA_ID = "asset-camera";
    const TRIPOD_ID = "asset-tripod";

    /** A QUANTITY_TRACKED asset bookingAsset row, shaped for `checkoutBooking`. */
    const qtyBookingAssetRow = (
      assetId: string,
      title: string,
      quantity: number,
      bookingAssetId: string
    ) => ({
      asset: {
        id: assetId,
        title,
        type: AssetType.QUANTITY_TRACKED,
        status: AssetStatus.AVAILABLE,
        unitOfMeasure: null,
        assetKits: [],
        // No conflicting bookings for this asset — QUANTITY_TRACKED assets
        // are exempt from the whole-asset conflict guard anyway (multiple
        // bookings may legitimately share the pool).
        bookingAssets: [],
      },
      assetId,
      quantity,
      id: bookingAssetId,
    });

    /**
     * Installs `db.asset.findUniqueOrThrow` so `computeAvailableQuantity`
     * (called for real by `getAssetAvailability`, not mocked in this file)
     * reads each asset's `Asset.quantity` from the fixture map.
     */
    function mockAssetTotals(totals: Record<string, number>) {
      (
        db.asset.findUniqueOrThrow as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: { where?: { id?: string } }) =>
        Promise.resolve({ quantity: totals[args?.where?.id ?? ""] ?? 0 })
      );
    }

    /**
     * Installs a `bookingAsset.findMany` router standing in for the TWO
     * distinct real queries the windowed guard drives per asset:
     *   1. `computeCheckedOutForAsset`'s pivots read (`booking.status IN
     *      [ONGOING, OVERDUE]`) — always empty here; none of these
     *      fixtures model a unit physically checked out elsewhere.
     *   2. `getAssetAvailability`'s reserved-rows read (`booking.status IN
     *      [RESERVED, ONGOING, OVERDUE]`, `assetKitId: null`) — echoes
     *      `reservedRows`, applying the SAME date-overlap test a real
     *      Postgres query would apply via the `booking.OR` clause (mirrors
     *      what the DB would already have filtered out, not the
     *      application code under test).
     */
    function mockReservedRows(
      reservedRows: Array<{
        assetId: string;
        bookingId: string;
        quantity: number;
        from: Date;
        to: Date;
      }>
    ) {
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        const statuses: string[] = args?.where?.booking?.status?.in ?? [];
        const queriedAssetId: string | undefined = args?.where?.assetId;
        if (!statuses.includes(BookingStatus.RESERVED)) {
          // computeCheckedOutForAsset's pivots query.
          return Promise.resolve([]);
        }
        const excludeId: string | undefined = args?.where?.bookingId?.not;
        // The `booking.OR` now has TWO branches (windowed-occupancy fix):
        // an unconditional `{status: OVERDUE}` branch, and the date-overlap
        // `{AND: [...]}` branch. None of these fixtures model an OVERDUE
        // row, so only the AND branch is ever relevant here.
        const orBranches = args?.where?.booking?.OR as
          | Array<
              | { status: string }
              | { AND: [{ from: { lt: Date } }, { to: { gt: Date } }] }
            >
          | undefined;
        const dateBranch = orBranches?.find(
          (
            branch
          ): branch is {
            AND: [{ from: { lt: Date } }, { to: { gt: Date } }];
          } => "AND" in branch
        );
        const rows = reservedRows
          .filter((r) => r.assetId === queriedAssetId)
          .filter((r) => r.bookingId !== excludeId)
          .filter((r) => {
            if (!dateBranch) return true;
            // Mirrors the production `.OR` overlap test:
            // booking.from < window.to AND booking.to > window.from (strict).
            return (
              r.from < dateBranch.AND[0].from.lt &&
              r.to > dateBranch.AND[1].to.gt
            );
          })
          .map((r) => ({
            bookingId: r.bookingId,
            quantity: r.quantity,
            booking: { from: r.from, to: r.to },
          }));
        return Promise.resolve(rows);
      });
    }

    beforeEach(() => {
      mockAssetTotals({ [CAMERA_ID]: 10, [TRIPOD_ID]: 10 });
      mockReservedRows([]);
    });

    it("(a) passes checkout when the other reservation does NOT overlap this booking's window (previously wrongly blocked by the global guard)", async () => {
      expect.assertions(1);

      const thisBooking = {
        ...mockBookingData,
        status: BookingStatus.RESERVED,
        bookingAssets: [qtyBookingAssetRow(CAMERA_ID, "Camera", 7, "ba-cam")],
      };
      const hydratedBooking = {
        ...thisBooking,
        status: BookingStatus.ONGOING,
      };
      (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
        .mockResolvedValueOnce(thisBooking)
        .mockResolvedValueOnce(hydratedBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({ id: "booking-1" });

      // Another booking reserves 7 of the same 10-unit pool, but its window
      // starts a full day AFTER this booking's `to` — never concurrent.
      // Under the OLD global guard this would have summed unconditionally
      // (available = 10 - 7 = 3 < requested 7) and wrongly blocked checkout.
      const otherFrom = new Date(futureToDate.getTime() + 24 * 60 * 60 * 1000);
      const otherTo = new Date(
        otherFrom.getTime() + HOURS_BETWEEN_FROM_AND_TO * 60 * 60 * 1000
      );
      mockReservedRows([
        {
          assetId: CAMERA_ID,
          bookingId: "other-booking",
          quantity: 7,
          from: otherFrom,
          to: otherTo,
        },
      ]);

      await checkoutBooking(mockCheckoutParams);

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [CAMERA_ID] }, organizationId: "org-1" },
        data: { status: AssetStatus.CHECKED_OUT },
      });
    });

    it("(b) still blocks checkout when the other reservation genuinely overlaps this booking's window, with the standardized message", async () => {
      expect.assertions(2);

      const thisBooking = {
        ...mockBookingData,
        status: BookingStatus.RESERVED,
        bookingAssets: [qtyBookingAssetRow(CAMERA_ID, "Camera", 7, "ba-cam")],
      };
      // Only the pre-tx load is ever reached — the guard throws before any
      // post-commit re-fetch.
      (
        db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
      ).mockResolvedValue(thisBooking);

      // Another booking reserves 5 of the 10-unit pool, in the SAME window
      // as this booking — a genuine in-window over-commit (7 requested,
      // only 5 left of the 10 - 5 = 5 bookable).
      mockReservedRows([
        {
          assetId: CAMERA_ID,
          bookingId: "other-booking",
          quantity: 5,
          from: futureFromDate,
          to: futureToDate,
        },
      ]);

      await expect(checkoutBooking(mockCheckoutParams)).rejects.toThrow(
        '"Camera": requested 7, only 5 available in this window'
      );
      // No status transition when the guard rejects.
      expect(db.booking.update).not.toHaveBeenCalled();
    });

    it("(c) aggregates only the truly-insufficient assets when multiple QUANTITY_TRACKED assets are checked out together", async () => {
      expect.assertions(2);

      const thisBooking = {
        ...mockBookingData,
        status: BookingStatus.RESERVED,
        bookingAssets: [
          qtyBookingAssetRow(CAMERA_ID, "Camera", 7, "ba-cam"),
          qtyBookingAssetRow(TRIPOD_ID, "Tripod", 4, "ba-tri"),
        ],
      };
      // Only the pre-tx load is ever reached — the guard throws before any
      // post-commit re-fetch.
      (
        db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
      ).mockResolvedValue(thisBooking);

      // Only Camera has a genuinely overlapping competing reservation;
      // Tripod's 10-unit pool is entirely free.
      mockReservedRows([
        {
          assetId: CAMERA_ID,
          bookingId: "other-booking",
          quantity: 5,
          from: futureFromDate,
          to: futureToDate,
        },
      ]);

      let caughtMessage = "";
      try {
        await checkoutBooking(mockCheckoutParams);
      } catch (error) {
        caughtMessage = (error as ShelfError).message;
      }

      expect(caughtMessage).toContain(
        '"Camera": requested 7, only 5 available in this window'
      );
      expect(caughtMessage).not.toContain("Tripod");
    });

    it("(d) validates only STANDALONE slices against the free pool — a QT asset split across kits + standalone still checks out (#2790)", async () => {
      expect.assertions(1);

      // Reproduction of the reported bug: "Boards" has total 10 with 6 units
      // allocated across two kits (inKits = 6), so its free pool is 4. This
      // booking holds Boards as 4 standalone + 3 (kit b1) + 3 (kit b2) = 10.
      // The kit slices draw from the kits' own allocation — already reserved
      // out of `bookable` via `inKits` — so ONLY the 4 standalone units are
      // validated against the free pool of 4, and checkout must succeed.
      // Before the fix, `requested` summed all 10 slices against `bookable` 4
      // and threw "requested 10, only 4 available in this window".
      mockAssetTotals({ [CAMERA_ID]: 10 });
      // inKits = 6 for this asset (two kit memberships of 3 units each).
      (db.assetKit.aggregate as ReturnType<typeof vitest.fn>).mockResolvedValue(
        { _sum: { quantity: 6 } }
      );
      mockReservedRows([]);

      // One standalone slice (qty 4) + two kit-driven slices (qty 3 each). The
      // fixture leaves `asset.assetKits` empty so no kit-status flip runs —
      // this isolates the availability guard, which keys off `ba.assetKitId`.
      const standalone = qtyBookingAssetRow(CAMERA_ID, "Boards", 4, "ba-free");
      const thisBooking = {
        ...mockBookingData,
        status: BookingStatus.RESERVED,
        bookingAssets: [
          standalone,
          { ...standalone, assetKitId: "kit-1", quantity: 3, id: "ba-kit-1" },
          { ...standalone, assetKitId: "kit-2", quantity: 3, id: "ba-kit-2" },
        ],
      };
      const hydratedBooking = { ...thisBooking, status: BookingStatus.ONGOING };
      (db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>)
        .mockResolvedValueOnce(thisBooking)
        .mockResolvedValueOnce(hydratedBooking);
      //@ts-expect-error missing vitest type
      db.booking.update.mockResolvedValue({ id: "booking-1" });

      await checkoutBooking(mockCheckoutParams);

      // Checkout proceeded: the asset was flipped to CHECKED_OUT (the guard did
      // NOT reject on the kit-inflated request). The `id.in` array carries the
      // asset id once per slice (3 here — standalone + 2 kit), so match it
      // loosely; the point is checkout ran rather than throwing.
      expect(db.asset.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: expect.arrayContaining([CAMERA_ID]) },
            organizationId: "org-1",
          },
          data: { status: AssetStatus.CHECKED_OUT },
        })
      );
    });
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
      checkedOutAt?: Date | null;
      checkedInAt?: Date | null;
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
    });
    const hydratedBooking = { ...mockBooking, status: BookingStatus.ONGOING };

    // why: no database in unit tests, so every booking read this flow makes
    // has to be queued here — the pre-tx load, then the post-tx hydrate. The
    // in-tx status guard does NOT consume an entry: it reads through
    // `$queryRaw` (row lock), which is stubbed separately in the db mock.
    // Ordering matters — a missing or surplus entry does not fail loudly, it
    // shifts every later read by one and the function returns whatever the
    // exhausted mock yields.
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
    // why: `addScannedAssetsToBookingWithinTx` first reads which scanned assets
    // ALREADY hold a standalone row, so only newly-arrived ones can discharge a
    // reservation. None do here, so this queued value is empty. It must come
    // first — the chain below is order-dependent.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);

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
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
        // why: the checkout guard now shares `getOutstandingModelRequests`
        // with the UI, so a row must carry the fields that predicate reads.
        fulfilledQuantity: 0,
        fulfilledAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("keeps the planned end of an extended booking when checking it in late", async () => {
    expect.assertions(3);

    // An extended booking carries the deadline it was planned for in
    // `originalTo` and the renegotiated one in `to`. Checking it in overdue
    // rewrites `to` to the return moment — the planned end must survive, or
    // Booking Compliance measures the return against the extension.
    const plannedEnd = new Date("2026-04-10T17:00:00Z");
    const extendedTo = new Date("2026-04-20T17:00:00Z");

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.OVERDUE,
      to: extendedTo,
      originalTo: plannedEnd,
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
          id: "ba-t107b",
          checkedOutAt: new Date("2026-04-01T09:00:00Z"),
          checkedInAt: null,
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

    await checkinBooking(mockCheckinParams);

    const updateCall = vitest.mocked(db.booking.update).mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;

    // Assert the write happened before reading anything off it: `?.` on an
    // absent call yields `undefined`, which satisfies both assertions below
    // and would let a check-in that never ran pass as a check-in that did.
    expect(updateCall?.data?.to).toBeInstanceOf(Date);
    // `to` moves to the return moment, so it is neither of the planned dates.
    expect(updateCall?.data?.to).not.toEqual(extendedTo);
    // `originalTo` is left untouched — the column already holds the plan.
    expect(updateCall?.data?.originalTo).toBeUndefined();
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("refuses a checkin whose booking is completed between the read and the write", async () => {
    // The race the row lock exists for. The pre-transaction read sees ONGOING
    // and passes the early exit; by the time the write transaction opens, a
    // concurrent check-in has committed COMPLETE. Modelled by letting the two
    // reads disagree — which is precisely what a non-locking SELECT permits
    // under READ COMMITTED.
    const mockBooking = { ...mockBookingData, status: BookingStatus.ONGOING };
    // why: the unlocked pre-transaction read — still the old status.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // why: the locked in-transaction read — the booking has moved on.
    (db.$queryRaw as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      { status: BookingStatus.COMPLETE },
    ]);

    await expect(checkinBooking(mockCheckinParams)).rejects.toThrow(
      /ongoing or overdue/
    );
    // Without the locked check the early exit would have waved this through
    // and the booking would have been written a second time.
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  it("refuses checkin of a booking that was never checked out", async () => {
    // This test used to assert the OPPOSITE — that checking in a DRAFT
    // booking "works" — and so pinned the defect in place: `checkinBooking`
    // writes COMPLETE unconditionally, while the asset filter keeps only
    // CHECKED_OUT assets, of which a DRAFT booking has none. The booking came
    // out marked finished with nothing checked in. (detail.dev D084)
    const mockBooking = { ...mockBookingData, status: BookingStatus.DRAFT };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });

    await expect(checkinBooking(mockCheckinParams)).rejects.toThrow(
      /ongoing or overdue/
    );
    // Assert on the WRITE, not only the throw: the point of the guard is that
    // the booking is never stamped COMPLETE.
    expect(db.booking.update).not.toHaveBeenCalled();
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("emits an ASSET_QUANTITY_CHANGED event for a QUANTITY_TRACKED pool decrement on check-in", async () => {
    expect.assertions(1);

    // Single QT asset (Pens) booked 10 units on a pool of 100. An explicit
    // LOSS of 4 units decrements the pool 100 → 96 — the audit event must
    // capture that stock drop.
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-pens",
            type: AssetType.QUANTITY_TRACKED,
            unitOfMeasure: null,
            consumptionType: ConsumptionType.ONE_WAY,
            title: "Pens",
            assetKits: [],
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-pens",
          quantity: 10,
          id: "ba-q1",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
      partialCheckins: [],
    };

    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue(mockBooking);
    (db.booking.update as ReturnType<typeof vitest.fn>).mockResolvedValue({
      ...mockBooking,
      status: BookingStatus.COMPLETE,
    });
    // Locked pool = 100; the event's fromValue is read off this.
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-pens",
      title: "Pens",
      type: AssetType.QUANTITY_TRACKED,
      quantity: 100,
      unitOfMeasure: null,
    });
    // computeBookingAssetRemaining reads findMany({ where:{ assetId }}); the
    // by-bookingId-only shape is used by isBookingFullyCheckedIn — keep it
    // empty so completion resolution stays simple.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation((args: { where?: { assetId?: string } }) =>
      args?.where?.assetId
        ? Promise.resolve([{ quantity: 10 }])
        : Promise.resolve([])
    );
    // computeBookingAssetSliceRemaining reads findUnique → booked 10.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 10 });
    // No logs yet → full 10 remaining; no custody held.
    (
      db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ _sum: { quantity: 0 } });
    (db.custody.aggregate as ReturnType<typeof vitest.fn>).mockResolvedValue({
      _sum: { quantity: 0 },
    });

    await checkinBooking({
      ...mockCheckinParams,
      userId: "user-1",
      checkins: [{ assetId: "asset-pens", bookingAssetId: "ba-q1", lost: 4 }],
    });

    const emittedQuantityChange = (
      activityEventService.recordEvents as ReturnType<typeof vitest.fn>
    ).mock.calls.some(([events]) =>
      (events as Array<Record<string, unknown>>).some(
        (e) =>
          e.action === "ASSET_QUANTITY_CHANGED" &&
          e.assetId === "asset-pens" &&
          e.field === "quantity" &&
          e.fromValue === 100 &&
          e.toValue === 96
      )
    );
    expect(emittedQuantityChange).toBe(true);
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
      where: { id: "booking-1", status: BookingStatus.COMPLETE },
      data: { status: BookingStatus.ARCHIVED },
    });
    expect(result).toEqual(archivedBooking);
  });

  it("rejects ONGOING bookings (their assets are still checked out)", async () => {
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

  it("archives a past-due RESERVED booking and flags it archivedWithoutCheckin", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      to: new Date("2020-01-01T00:00:00Z"),
    };
    const archivedBooking = { ...mockBooking, status: BookingStatus.ARCHIVED };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(archivedBooking);

    await archiveBooking({
      id: "booking-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1", status: BookingStatus.RESERVED },
      data: {
        status: BookingStatus.ARCHIVED,
        archivedWithoutCheckin: true,
      },
    });
  });

  it("rejects a RESERVED booking whose end date has not passed", async () => {
    expect.assertions(1);

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      to: new Date("2999-01-01T00:00:00Z"),
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      archiveBooking({ id: "booking-1", organizationId: "org-1" })
    ).rejects.toThrow(ShelfError);
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
      // The reconciler reads the whole batch in two set-based queries and keys
      // on the slice markers, so these model row PRESENCE per asset rather
      // than a count per asset.
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        // Only the reconciler's read carries a `checkedOutAt` filter; every
        // other `bookingAsset.findMany` on these paths keeps the default [].
        if (args?.where?.checkedOutAt === undefined) return Promise.resolve([]);
        const ids: string[] = args?.where?.assetId?.in ?? [];
        return Promise.resolve(
          ids
            .filter((id) => (otherActiveBookingsByAssetId[id] ?? 0) > 0)
            .map((assetId) => ({ assetId }))
        );
      });
      (db.custody.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: any) => {
          const ids: string[] = args?.where?.assetId?.in ?? [];
          return Promise.resolve(
            ids
              .filter((id) => (custodyByAssetId[id] ?? 0) > 0)
              .map((assetId) => ({ assetId }))
          );
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
        data: { status: AssetStatus.IN_CUSTODY },
      });
      expect(db.asset.updateMany).not.toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
      // The reconciler reads the whole batch in two set-based queries and keys
      // on the slice markers, so these model row PRESENCE per asset rather
      // than a count per asset.
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        // Only the reconciler's read carries a `checkedOutAt` filter; every
        // other `bookingAsset.findMany` on these paths keeps the default [].
        if (args?.where?.checkedOutAt === undefined) return Promise.resolve([]);
        const ids: string[] = args?.where?.assetId?.in ?? [];
        return Promise.resolve(
          ids
            .filter((id) => (otherActiveBookingsByAssetId[id] ?? 0) > 0)
            .map((assetId) => ({ assetId }))
        );
      });
      (db.custody.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: any) => {
          const ids: string[] = args?.where?.assetId?.in ?? [];
          return Promise.resolve(
            ids
              .filter((id) => (custodyByAssetId[id] ?? 0) > 0)
              .map((assetId) => ({ assetId }))
          );
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
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
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
        // `assetKits: []` mirrors BOOKING_WITH_ASSETS_INCLUDE, which always
        // selects the relation — duplicateBooking reads it as the legacy
        // fallback for kit-driven rows written without a `sourceKitId`.
        {
          asset: { id: "asset-1", assetKits: [] },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t117",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", assetKits: [] },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t118",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Genuine standalone: BOTH pointers null, so it is copied verbatim.
          assetKitId: null,
          sourceKitId: null,
          id: "ba-standalone",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: {
            id: "asset-shared",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ id: "ak-x", kitId: "kit-1" }],
          },
          assetId: "asset-shared",
          quantity: 3,
          assetKitId: "ak-x",
          // Kit re-resolution reads the kit id from here, not from
          // `asset.assetKits`.
          sourceKitId: "kit-1",
          id: "ba-kit",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
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
              {
                assetId: "asset-shared",
                quantity: 5,
                assetKitId: null,
                sourceKitId: null,
              },
              {
                assetId: "asset-shared",
                quantity: 3,
                assetKitId: "ak-x",
                sourceKitId: "kit-1",
              },
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
          sourceKitId: null,
          id: "ba-standalone",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          sourceKitId: "kit-1",
          id: "ba-k-a",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          sourceKitId: "kit-1",
          id: "ba-k-b",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          sourceKitId: "kit-1",
          id: "ba-k-c",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-b",
            assetId: "kit-asset-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-c",
            assetId: "kit-asset-c",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
            asset: { type: AssetType.INDIVIDUAL, unitOfMeasure: null },
          },
          {
            id: "ak-qt",
            assetId: "qt-gloves",
            quantity: 5,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
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
      sourceKitId: string | null;
    }>;

    // 1 standalone + 4 kit-driven (incl. the new QT) = 5 total slices.
    expect(createdSlices).toHaveLength(5);

    // Standalone slice copied verbatim (quantity preserved, both kit
    // pointers NULL).
    expect(createdSlices).toEqual(
      expect.arrayContaining([
        {
          assetId: "asset-standalone",
          quantity: 1,
          assetKitId: null,
          sourceKitId: null,
        },
      ])
    );

    // Kit-driven slice for the newly-added QT carries AssetKit.quantity (5),
    // NOT a default of 1 — proves we read from AssetKit, not the source — and
    // stamps the owning kit read off that same AssetKit row.
    expect(createdSlices).toEqual(
      expect.arrayContaining([
        {
          assetId: "qt-gloves",
          quantity: 5,
          assetKitId: "ak-qt",
          sourceKitId: "kit-1",
        },
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

  it("drops assets that were removed from a kit instead of copying them in as standalone", async () => {
    // why: the reported customer bug. When an asset leaves a kit the DB
    // SET NULLs the slice's assetKitId, demoting it to standalone. Copying
    // standalone rows verbatim then re-adds the swapped-out asset to the
    // duplicate as a loose asset. `sourceKitId` is what tells the two apart.
    expect.assertions(4);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        // Genuine standalone — user added it by hand. MUST be copied.
        {
          asset: {
            id: "asset-loose",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [],
          },
          assetId: "asset-loose",
          quantity: 1,
          assetKitId: null,
          sourceKitId: null,
          id: "ba-loose",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        // Still in the kit — re-resolved from current membership.
        {
          asset: {
            id: "switch-b",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ id: "ak-b", kitId: "kit-1" }],
          },
          assetId: "switch-b",
          quantity: 1,
          assetKitId: "ak-b",
          sourceKitId: "kit-1",
          id: "ba-b",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        // Detached residue: was in kit-1, swapped out. The DB SET NULL'd
        // `assetKitId`; only `sourceKitId` remembers where it came from.
        // MUST NOT be copied.
        {
          asset: {
            id: "switch-a",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [],
          },
          assetId: "switch-a",
          quantity: 1,
          assetKitId: null,
          sourceKitId: "kit-1",
          id: "ba-a",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
      tags: [],
    };

    // `Once` throughout: `clearAllMocks` clears calls but NOT implementations,
    // so a persistent mock here would leak this fixture into later tests.
    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValueOnce(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValueOnce({
      ...originalBooking,
      id: "booking-2",
    });

    // kit-1's CURRENT membership: switch-a is gone, switch-b remains.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockImplementationOnce((args?: any) => {
      if (args?.where?.kitId?.in) {
        return Promise.resolve([
          {
            id: "ak-b",
            assetId: "switch-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
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

    const createArg = (
      db.booking.create as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0];
    const createdSlices = createArg?.data?.bookingAssets?.create as Array<{
      assetId: string;
      assetKitId: string | null;
      sourceKitId: string | null;
    }>;

    expect(createdSlices).toHaveLength(2);
    expect(createdSlices.map((s) => s.assetId).sort()).toEqual([
      "asset-loose",
      "switch-b",
    ]);
    expect(createdSlices.some((s) => s.assetId === "switch-a")).toBe(false);

    // The audit trail follows the create payload — no BOOKING_ASSETS_ADDED
    // event may claim the dropped asset was added to the duplicate.
    const eventRows = (
      activityEventService.recordEvents as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0] as Array<{ assetId: string }>;
    expect(eventRows.some((e) => e.assetId === "switch-a")).toBe(false);
  });

  it("re-resolves a kit whose members were ALL removed since the source booking", async () => {
    // why: every slice of `kit-1` is now detached residue, so there is no
    // remaining `assetKitId` to hop through. Deriving the kit set from
    // `sourceKitId` is what keeps the kit in the duplicate — it is
    // re-resolved to its CURRENT (replacement) member instead of vanishing.
    expect.assertions(2);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: {
            id: "switch-a",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [],
          },
          assetId: "switch-a",
          quantity: 1,
          assetKitId: null,
          sourceKitId: "kit-1",
          id: "ba-a",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
      tags: [],
    };

    // `Once` throughout — see the note in the preceding test.
    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValueOnce(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValueOnce({
      ...originalBooking,
      id: "booking-2",
    });

    // kit-1 was rebuilt around a replacement switch.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockImplementationOnce((args?: any) => {
      if (args?.where?.kitId?.in) {
        return Promise.resolve([
          {
            id: "ak-new",
            assetId: "switch-replacement",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
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

    const createArg = (
      db.booking.create as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0];
    const createdSlices = createArg?.data?.bookingAssets?.create as Array<{
      assetId: string;
      assetKitId: string | null;
      sourceKitId: string | null;
    }>;

    expect(createdSlices).toEqual([
      {
        assetId: "switch-replacement",
        quantity: 1,
        assetKitId: "ak-new",
        sourceKitId: "kit-1",
      },
    ]);
    // The kit really was looked up, despite no slice still being kit-driven.
    expect(db.assetKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kitId: { in: ["kit-1"] } },
      })
    );
  });

  it("still resolves the kit for a legacy kit-driven row that has no sourceKitId", async () => {
    // why: "assetKitId non-null => sourceKitId non-null" is enforced by code
    // alone — there is no CHECK constraint — and the migration necessarily
    // lands before the new code, so during a rolling deploy an older instance
    // can write a kit-driven row with a NULL sourceKitId. Such a row is in
    // NEITHER bucket (excluded from standalone by assetKitId, contributes no
    // kit id via sourceKitId), so without the legacy assetKitId -> AssetKit ->
    // kitId fallback the whole kit vanishes and a kit-only booking duplicates
    // to an EMPTY booking. Do not delete the fallback to "simplify" this.
    expect.assertions(2);

    const originalBooking = {
      ...mockBookingData,
      bookingAssets: [
        {
          asset: {
            id: "legacy-member",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            // The only surviving pointer to the kit for this row.
            assetKits: [{ id: "ak-1", kitId: "kit-1" }],
          },
          assetId: "legacy-member",
          quantity: 1,
          assetKitId: "ak-1",
          // Written before the column existed / by a pre-deploy instance.
          sourceKitId: null,
          id: "ba-legacy",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
      tags: [],
    };

    // `Once` throughout — see the note two tests above.
    //@ts-expect-error missing vitest type
    db.booking.findFirstOrThrow.mockResolvedValueOnce(originalBooking);
    //@ts-expect-error missing vitest type
    db.booking.create.mockResolvedValueOnce({
      ...originalBooking,
      id: "booking-2",
    });

    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockImplementationOnce((args?: any) => {
      if (args?.where?.kitId?.in) {
        return Promise.resolve([
          {
            id: "ak-1",
            assetId: "legacy-member",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            kitId: "kit-1",
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

    const createArg = (
      db.booking.create as ReturnType<typeof vitest.fn>
    ).mock.calls.at(-1)?.[0];
    const createdSlices = createArg?.data?.bookingAssets?.create as Array<{
      assetId: string;
      assetKitId: string | null;
      sourceKitId: string | null;
    }>;

    // The kit survives the duplicate — and the rebuilt row is upgraded to
    // carry `sourceKitId`, so the legacy shape doesn't propagate.
    expect(createdSlices).toEqual([
      {
        assetId: "legacy-member",
        quantity: 1,
        assetKitId: "ak-1",
        sourceKitId: "kit-1",
      },
    ]);
    expect(db.assetKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kitId: { in: ["kit-1"] } },
      })
    );
  });
});

describe("computeBookingKitDrift", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * `computeBookingKitDrift` hits `db.kit.findMany` TWICE: first through
   * `assertKitsBelongToOrg` (which only counts the returned rows against the
   * requested ids) and then for the kits' CURRENT membership. The module-level
   * mock echoes requested ids back as bare `{ id }` rows, which passes the
   * guard but carries no `assetKits` — so every drift test must queue a full
   * payload for both calls.
   *
   * `mockResolvedValueOnce` rather than `mockResolvedValue`: a persistent
   * implementation survives `clearAllMocks` and leaks into later tests.
   *
   * @param kits - Full `{ id, name, assetKits }` rows; ids must match the ids
   *   the function requests or `assertKitsBelongToOrg` throws.
   */
  function queueKitLookups(kits: unknown[]) {
    (db.kit.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce(kits)
      .mockResolvedValueOnce(kits);
  }

  it("reports an asset removed from the kit since the booking was created", async () => {
    // why: this is the half of drift that has never worked. The removed
    // asset's slice was demoted to standalone by the `assetKitId` SET NULL
    // cascade, so a snapshot keyed on `assetKitId` could never see it.
    // Keying on `sourceKitId` — which survives the detach — does.
    expect.assertions(2);

    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        assetId: "switch-b",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: "ak-b",
        asset: {
          id: "switch-b",
          title: "Switch B",
          type: AssetType.INDIVIDUAL,
        },
      },
      {
        // Detached residue — `assetKitId` already NULL'd by the cascade,
        // `sourceKitId` still points at the kit it arrived with.
        assetId: "switch-a",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: null,
        asset: {
          id: "switch-a",
          title: "Switch A",
          type: AssetType.INDIVIDUAL,
        },
      },
    ]);

    queueKitLookups([
      {
        id: "kit-1",
        name: "Rack 1",
        assetKits: [
          {
            assetId: "switch-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-b",
              title: "Switch B",
              type: AssetType.INDIVIDUAL,
            },
          },
        ],
      },
    ]);

    const drift = await computeBookingKitDrift({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(drift).toHaveLength(1);
    expect(drift[0].removed).toEqual([
      {
        assetId: "switch-a",
        title: "Switch A",
        type: AssetType.INDIVIDUAL,
        quantity: 1,
      },
    ]);
  });

  it("reports an asset added to the kit since the booking was created", async () => {
    // Pins the half of drift that already worked, so the snapshot-predicate
    // rewrite can't regress it.
    expect.assertions(2);

    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        assetId: "switch-b",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: "ak-b",
        asset: {
          id: "switch-b",
          title: "Switch B",
          type: AssetType.INDIVIDUAL,
        },
      },
    ]);

    queueKitLookups([
      {
        id: "kit-1",
        name: "Rack 1",
        assetKits: [
          {
            assetId: "switch-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-b",
              title: "Switch B",
              type: AssetType.INDIVIDUAL,
            },
          },
          {
            assetId: "switch-c",
            quantity: 5,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-c",
              title: "Switch C",
              type: AssetType.QUANTITY_TRACKED,
            },
          },
        ],
      },
    ]);

    const drift = await computeBookingKitDrift({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(drift[0].added).toEqual([
      {
        assetId: "switch-c",
        title: "Switch C",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 5,
      },
    ]);
    expect(drift[0].removed).toEqual([]);
  });

  it("reports both sides when a kit member was swapped out for another", async () => {
    // The reported customer scenario: Switch A was pulled from the kit and
    // Switch C put in its place. Before `sourceKitId` the modal showed only
    // the addition, so the user was never warned the duplicate would lose
    // Switch A.
    expect.assertions(3);

    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        assetId: "switch-a",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: null,
        asset: {
          id: "switch-a",
          title: "Switch A",
          type: AssetType.INDIVIDUAL,
        },
      },
      {
        assetId: "switch-b",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: "ak-b",
        asset: {
          id: "switch-b",
          title: "Switch B",
          type: AssetType.INDIVIDUAL,
        },
      },
    ]);

    queueKitLookups([
      {
        id: "kit-1",
        name: "Rack 1",
        assetKits: [
          {
            assetId: "switch-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-b",
              title: "Switch B",
              type: AssetType.INDIVIDUAL,
            },
          },
          {
            assetId: "switch-c",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-c",
              title: "Switch C",
              type: AssetType.INDIVIDUAL,
            },
          },
        ],
      },
    ]);

    const drift = await computeBookingKitDrift({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(drift).toHaveLength(1);
    expect(drift[0].added.map((a) => a.assetId)).toEqual(["switch-c"]);
    expect(drift[0].removed.map((a) => a.assetId)).toEqual(["switch-a"]);
  });

  it("omits kits whose membership still matches the booking snapshot", async () => {
    // Kits without drift are dropped entirely so the modal's banner stays
    // hidden when nothing changed.
    expect.assertions(1);

    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        assetId: "switch-b",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: "kit-1",
        assetKitId: "ak-b",
        asset: {
          id: "switch-b",
          title: "Switch B",
          type: AssetType.INDIVIDUAL,
        },
      },
    ]);

    queueKitLookups([
      {
        id: "kit-1",
        name: "Rack 1",
        assetKits: [
          {
            assetId: "switch-b",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-b",
              title: "Switch B",
              type: AssetType.INDIVIDUAL,
            },
          },
        ],
      },
    ]);

    const drift = await computeBookingKitDrift({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(drift).toEqual([]);
  });

  it("still resolves the kit for legacy rows written without a sourceKitId", async () => {
    // Rolling-deploy window: the migration lands before the code, so an old
    // instance can write a kit-driven row with `assetKitId` set and
    // `sourceKitId` NULL. Keying the snapshot on `sourceKitId` ALONE would
    // drop that kit silently — `duplicateBooking` would still re-resolve it
    // (it keeps the same `assetKitId -> kitId` fallback) and change the
    // booking's contents while the modal showed no warning at all.
    //
    // This covers BOTH halves of that fallback, and it takes both to pin it:
    // the returned-drift assertions cover the grouping hop
    // (`sourceKitId ?? kitIdByAssetKitId.get(assetKitId)`), and the explicit
    // call-args assertion at the end covers the QUERY predicate. The
    // module-level `db.bookingAsset.findMany` mock ignores `where` entirely,
    // so without that last assertion the `assetKitId` leg of the `OR` could be
    // deleted as "redundant now that sourceKitId is backfilled" and the whole
    // suite would stay green while the deploy-window hole silently reopened.
    expect.assertions(4);

    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([
      {
        assetId: "switch-b",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        sourceKitId: null,
        assetKitId: "ak-b",
        asset: {
          id: "switch-b",
          title: "Switch B",
          type: AssetType.INDIVIDUAL,
        },
      },
    ]);

    // why: the legacy fallback resolves `assetKitId -> kitId` through a
    // dedicated AssetKit lookup. The module-level mock echoes ids back with a
    // derived `kit-of-<id>` kitId, which wouldn't match the kit fixture below.
    (
      db.assetKit.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ id: "ak-b", kitId: "kit-1" }]);

    queueKitLookups([
      {
        id: "kit-1",
        name: "Rack 1",
        assetKits: [
          {
            assetId: "switch-c",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            asset: {
              id: "switch-c",
              title: "Switch C",
              type: AssetType.INDIVIDUAL,
            },
          },
        ],
      },
    ]);

    const drift = await computeBookingKitDrift({
      bookingId: "booking-1",
      organizationId: "org-1",
    });

    expect(drift).toHaveLength(1);
    expect(drift[0].added.map((a) => a.assetId)).toEqual(["switch-c"]);
    expect(drift[0].removed.map((a) => a.assetId)).toEqual(["switch-b"]);

    // The snapshot must select on provenance OR legacy live membership. Both
    // legs are load-bearing: `sourceKitId` is what makes detached residue (and
    // therefore `removed`) visible at all, `assetKitId` is what keeps
    // deploy-window rows from vanishing.
    expect(db.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ sourceKitId: { not: null } }, { assetKitId: { not: null } }],
        }),
      })
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
      hints: mockClientHints,
    });

    expect(db.booking.update).toHaveBeenCalledWith({
      where: { id: "booking-1" },
      data: { status: BookingStatus.DRAFT },
      include: expect.any(Object),
    });
    expect(result).toEqual(draftBooking);
  });

  it("should throw error when booking cannot be reverted", async () => {
    expect.assertions(1);

    const mockBooking = { ...mockBookingData, status: BookingStatus.COMPLETE };
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);

    await expect(
      revertBookingToDraft({
        id: "booking-1",
        organizationId: "org-1",
        hints: mockClientHints,
      })
    ).rejects.toThrow(ShelfError);
  });

  // why: regression — reverting a reservation used to be silent. The custodian
  // submitted a request, an admin sent it back, and no email went out (every
  // other lifecycle transition emails). This pins the notification in place.
  it("emails the resolved recipients when a reservation is reverted", async () => {
    const custodianUser = {
      id: "user-2",
      email: "custodian@example.com",
      firstName: "Custodian",
      lastName: "User",
      displayName: null,
      dateFormat: null,
      timeFormat: null,
      weekStart: null,
      timeZone: null,
    };
    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.RESERVED,
      custodianUserId: "user-2",
    };
    const draftBooking = {
      ...mockBooking,
      status: BookingStatus.DRAFT,
      custodianUser,
      custodianTeamMember: null,
      creator: custodianUser,
      notificationRecipients: [],
      organization: {
        name: "Test Org",
        customEmailFooter: null,
        owner: { email: "owner@example.com" },
      },
      _count: { bookingAssets: mockBooking.bookingAssets.length },
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue(draftBooking);
    vitest.mocked(getBookingNotificationRecipients).mockResolvedValueOnce([
      {
        email: custodianUser.email,
        firstName: custodianUser.firstName,
        lastName: custodianUser.lastName,
        userId: custodianUser.id,
        dateFormat: null,
        timeFormat: null,
        weekStart: null,
        timeZone: null,
        reason: "custodian",
      },
    ]);

    await revertBookingToDraft({
      id: "booking-1",
      organizationId: "org-1",
      userId: "admin-1",
      hints: mockClientHints,
    });

    expect(getBookingNotificationRecipients).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "REVERT_TO_DRAFT",
        editorUserId: "admin-1",
      })
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "custodian@example.com",
        subject: expect.stringContaining("reverted to draft"),
      })
    );
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t121",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("leaves originalTo on the deadline the booking was planned for", async () => {
    expect.assertions(2);

    // Extension is only allowed once a booking has started, so the plan is
    // already fixed: only the live `to` moves. Moving `originalTo` too would
    // let anyone clear a late return from Booking Compliance by extending it.
    const newEndDate = new Date("2025-01-02T17:00:00Z");

    const mockBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: { id: "asset-1", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-t130",
        },
      ],
      partialCheckins: [],
    };

    // why: extendBooking loads the booking (status guard + conflict window)
    // before writing; an ONGOING booking with checked-out assets passes both.
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(mockBooking);
    // why: the assertion targets the update's `data` payload; the resolved
    // value only feeds the post-update note and email path.
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({ ...mockBooking, to: newEndDate });

    await extendBooking({
      id: "booking-1",
      organizationId: "org-1",
      newEndDate,
      hints: mockClientHints,
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ to: newEndDate }),
      })
    );

    const updateCall = vitest.mocked(db.booking.update).mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(updateCall?.data).not.toHaveProperty("originalTo");
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t127",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t131",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-3", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t132",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t134",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.CHECKED_OUT },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t136",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-2", status: AssetStatus.AVAILABLE },
          assetId: "asset-2",
          quantity: 1,
          id: "ba-t138",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
        {
          asset: { id: "asset-3", status: AssetStatus.AVAILABLE },
          assetId: "asset-3",
          quantity: 1,
          id: "ba-t139",
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  /**
   * The zero-asset invariant, approached from the removal side.
   *
   * `reserveBooking` refuses to take an empty booking into RESERVED, but that
   * only guards the transition: emptying the booking afterwards reached the
   * same state — a booking that reserves nothing — from the other direction.
   */
  describe("refuses to leave a stock-holding booking empty", () => {
    const emptyingBooking = { id: "booking-1", assetIds: ["asset-1"] };

    /** Nothing left on the booking after the delete. */
    function nothingRemains(status: BookingStatus) {
      //@ts-expect-error missing vitest type
      db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...emptyingBooking,
        name: "Test Booking",
        status,
      });
      //@ts-expect-error missing vitest type
      db.bookingAsset.count.mockResolvedValue(0);
      //@ts-expect-error missing vitest type
      db.bookingModelRequest.count.mockResolvedValue(0);
    }

    const baseArgs = {
      firstName: "Test",
      lastName: "User",
      displayName: null,
      userId: "user-1",
      organizationId: "org-1",
    };

    it("refuses when the booking is RESERVED", async () => {
      expect.assertions(1);
      nothingRemains(BookingStatus.RESERVED);

      await expect(
        removeAssets({ booking: emptyingBooking, ...baseArgs })
      ).rejects.toThrow(BOOKING_EMPTY_RESERVED_MESSAGE);
    });

    // The guard is RESERVED-only on purpose. DRAFT is work-in-progress, and a
    // live booking must stay emptiable so a checked-out asset can be pulled
    // off it — the bug #99 describe below covers that reconciliation.
    it.each([
      BookingStatus.DRAFT,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ])("allows a %s booking to be emptied", async (status) => {
      nothingRemains(status);

      await expect(
        removeAssets({ booking: emptyingBooking, ...baseArgs })
      ).resolves.not.toThrow();
    });

    it("allows emptying the assets while a model reservation still holds the booking", async () => {
      nothingRemains(BookingStatus.RESERVED);
      // Model reservations survive asset removal, so the booking still holds
      // something and the guard must not fire.
      //@ts-expect-error missing vitest type
      db.bookingModelRequest.count.mockResolvedValue(1);

      await expect(
        removeAssets({ booking: emptyingBooking, ...baseArgs })
      ).resolves.not.toThrow();
    });

    afterEach(() => {
      // Restore the module-level defaults for the sibling tests below.
      //@ts-expect-error missing vitest type
      db.bookingAsset.count.mockResolvedValue(0);
      //@ts-expect-error missing vitest type
      db.bookingModelRequest.count.mockResolvedValue(0);
    });
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
      displayName: null,
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

  it("removes BOTH standalone and kit-driven rows when the caller mixes assets and kits", async () => {
    expect.assertions(1);

    // The booking-overview bulk-remove sends standalone asset ids AND kit ids
    // in ONE call. `asset-standalone` sits on the booking as a plain row
    // (assetKitId null); `asset-in-kit` sits on it via kit-1's AssetKit row.
    // No `standaloneAssetIds` here on purpose — this covers the inference
    // fallback used by callers that can't observe per-row selection.
    const mockBooking = {
      id: "booking-1",
      assetIds: ["asset-standalone", "asset-in-kit"],
    };

    // why: the shared assetKit.findMany mock only echoes `where.id.in`; this
    // query filters by kitId/assetId, so the kit-driven row must be supplied.
    (
      db.assetKit.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ id: "assetkit-1", assetId: "asset-in-kit" }]);
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
      displayName: null,
      userId: "user-1",
      organizationId: "org-1",
      kitIds: ["kit-1"],
      kits: [{ id: "kit-1", name: "Kit 1" }],
      assets: [{ id: "asset-standalone", title: "Standalone asset" }],
    });

    // The delete scope must cover the standalone slice too — scoping purely by
    // `assetKitId` leaves the standalone rows on the booking, which is what
    // made the bulk action look like it "only removed the kit".
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: "booking-1",
        OR: [
          { assetKitId: { in: ["assetkit-1"] } },
          { assetId: { in: ["asset-standalone"] }, assetKitId: null },
        ],
      },
    });
  });

  it("removes both rows of an asset booked standalone AND inside a removed kit", async () => {
    expect.assertions(1);

    // A qty-tracked asset can hold a standalone row AND a kit-driven row on
    // the same booking (the partial unique indexes allow exactly that). When
    // the user ticks the standalone row and the kit, both must go — inferring
    // standalone intent from kit membership would classify the asset as a kit
    // member only and leave its standalone row attached.
    const mockBooking = { id: "booking-1", assetIds: ["asset-both"] };

    // why: the shared assetKit.findMany mock only echoes `where.id.in`; this
    // query filters by kitId/assetId, so the kit-driven row must be supplied.
    (
      db.assetKit.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ id: "assetkit-1", assetId: "asset-both" }]);
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
      displayName: null,
      userId: "user-1",
      organizationId: "org-1",
      kitIds: ["kit-1"],
      kits: [{ id: "kit-1", name: "Kit 1" }],
      // The caller saw the user tick this asset's own row, so it says so
      // explicitly instead of letting the service infer.
      standaloneAssetIds: ["asset-both"],
      assets: [{ id: "asset-both", title: "Asset in both" }],
    });

    // Both predicates present: the kit-driven row AND the standalone row of
    // the very same asset.
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: "booking-1",
        OR: [
          { assetKitId: { in: ["assetkit-1"] } },
          { assetId: { in: ["asset-both"] }, assetKitId: null },
        ],
      },
    });
  });

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
  ])("refuses to delete rows from a %s booking", async (status) => {
    expect.assertions(2);

    // Backstop for the callers' own status gates. They read the booking BEFORE
    // calling, so a booking closed in the meantime would still have its rows
    // deleted. This check shares the transaction snapshot with the deleteMany.
    const mockBooking = { id: "booking-1", assetIds: ["asset-1"] };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBooking,
      name: "Test Booking",
      status,
    });

    await expect(
      removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      "Removing items is not allowed for the current status of the booking."
    );

    expect(db.bookingAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("reports removals only for assets that actually lost a booking row", async () => {
    expect.assertions(2);

    // The bulk handler passes every member of a selected kit, including
    // members added to the kit AFTER the booking was created — those have no
    // BookingAsset row and never left. Emitting a note/event for them forges
    // the audit trail.
    const mockBooking = {
      id: "booking-1",
      assetIds: ["asset-on-booking", "asset-never-on-booking"],
    };

    // why: this is the pre-delete snapshot of rows about to be dropped; only
    // the first asset has one, which is exactly the condition under test.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ assetId: "asset-on-booking", quantity: 3 }]);
    //@ts-expect-error missing vitest type
    db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
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
      displayName: null,
      userId: "user-1",
      organizationId: "org-1",
    });

    // Exactly one event, for the asset that genuinely left.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        action: "BOOKING_ASSETS_REMOVED",
        assetId: "asset-on-booking",
      }),
    ]);
    // And no asset-timeline note for the one that was never attached.
    expect(noteService.createNotes).not.toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-never-on-booking"] })
    );
  });

  it("keeps the delete scoped to kit-driven rows when only kits are removed", async () => {
    expect.assertions(1);

    // Guards the reason the kit-scoped branch exists: an asset can sit on the
    // booking BOTH via a kit slice and as a separately-added standalone slice.
    // Removing the kit must take only the kit's slice. The mixed-selection fix
    // above must not widen this back into a delete-by-assetId.
    const mockBooking = { id: "booking-1", assetIds: ["asset-in-kit"] };

    // why: the shared assetKit.findMany mock only echoes `where.id.in`; this
    // query filters by kitId/assetId, so the kit-driven row must be supplied.
    (
      db.assetKit.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ id: "assetkit-1", assetId: "asset-in-kit" }]);
    //@ts-expect-error missing vitest type
    db.bookingAsset.deleteMany.mockResolvedValue({ count: 1 });
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
      displayName: null,
      userId: "user-1",
      organizationId: "org-1",
      kitIds: ["kit-1"],
      kits: [{ id: "kit-1", name: "Kit 1" }],
      assets: [],
    });

    // No `OR`, no standalone clause — the asset is a member of the kit being
    // removed, so its standalone slice (if any) stays on the booking.
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: "booking-1",
        assetKitId: { in: ["assetkit-1"] },
      },
    });
  });

  // why: removing an assigned asset is the one path that reopens a fulfilled
  // model reservation without any operator edit. `fulfilledAt IS NULL` is the
  // outstanding-work predicate, so a consumer replaying the event stream
  // without this reversal reconstructs the reservation as still closed.
  describe("model-request fulfilledAt reversal", () => {
    // why: `clearAllMocks` resets call history but NOT implementations, so the
    // per-test overrides below would otherwise leak into every later describe
    // in this file. `db.asset.findMany` in particular carries an echo-the-ids
    // `mockImplementation` that the cross-org guard depends on; clobbering it
    // persistently broke the partial-checkin qty tests. Restore both.
    afterEach(() => {
      (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: { where?: { id?: { in?: string[] } } }) => {
          const ids = args?.where?.id?.in;
          return Promise.resolve(
            Array.isArray(ids) ? ids.map((id: string) => ({ id })) : []
          );
        }
      );
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockResolvedValue([]);
      (
        db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
      ).mockResolvedValue(null);
    });

    /**
     * Booking + asset fixture whose removed asset carries an AssetModel.
     *
     * `deletedRows` is the set of `BookingAsset` rows that were actually on
     * the booking and so actually got deleted. It defaults to "the asset was
     * there"; pass `[]` to model the caller REQUESTING an asset that never
     * had a row on this booking.
     */
    function arrangeModelRemoval(
      request: {
        quantity: number;
        fulfilledQuantity: number;
        fulfilledAt: Date | null;
      },
      deletedRows?: Array<{
        assetId: string;
        quantity: number;
        bookingModelRequestId: string | null;
      }>
    ) {
      const mockBooking = { id: "booking-1", assetIds: ["asset-1"] };
      (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
        {
          id: "asset-1",
          assetModelId: "model-1",
          title: "Laptop #1",
          type: AssetType.INDIVIDUAL,
          unitOfMeasure: null,
        },
      ]);
      // Rows actually on the booking and therefore actually deleted. Default
      // to the asset being present; `deletedRows: []` models the caller
      // requesting an asset that was never on this booking.
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockResolvedValue(
        deletedRows ?? [
          {
            assetId: "asset-1",
            quantity: 1,
            // Fixture default: this slice went out with the booking.
            checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
            checkedInAt: null,
            // The rollback counts rows that actually discharged THIS request,
            // read from the row's own provenance rather than a shared model.
            bookingModelRequestId: "req-1",
          },
        ]
      );
      //@ts-expect-error missing vitest type
      db.bookingAsset.deleteMany.mockResolvedValue({
        count: (deletedRows ?? [{}]).length,
      });
      (
        db.bookingModelRequest.findUnique as ReturnType<typeof vitest.fn>
      ).mockResolvedValue({
        ...request,
        // Ownership guard: the loop refuses a request on another booking.
        bookingId: "booking-1",
        assetModelId: "model-1",
        assetModel: { name: "Dell Latitude 5550" },
      });
      //@ts-expect-error missing vitest type
      db.booking.findUniqueOrThrow.mockResolvedValue({
        ...mockBooking,
        name: "Test Booking",
        status: BookingStatus.DRAFT,
      });
      return mockBooking;
    }

    /** Every BOOKING_MODEL_REQUEST_CHANGED payload recorded this test. */
    function modelRequestChangedEvents() {
      return (
        activityEventService.recordEvents as ReturnType<typeof vitest.fn>
      ).mock.calls
        .flatMap((call) => call[0] as Array<Record<string, unknown>>)
        .filter((event) => event?.action === "BOOKING_MODEL_REQUEST_CHANGED");
    }

    it("records the fulfilledAt reversal when a removal reopens a fulfilled request", async () => {
      expect.assertions(1);
      const fulfilledAt = new Date("2026-05-02T10:00:00Z");
      // 3 of 3 units assigned, so the request is closed. Removing one
      // reopens it.
      const mockBooking = arrangeModelRemoval({
        quantity: 3,
        fulfilledQuantity: 3,
        fulfilledAt,
      });

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(modelRequestChangedEvents()).toEqual([
        expect.objectContaining({
          action: "BOOKING_MODEL_REQUEST_CHANGED",
          entityType: "BOOKING",
          entityId: "booking-1",
          bookingId: "booking-1",
          field: "fulfilledAt",
          fromValue: fulfilledAt.toISOString(),
          toValue: null,
          meta: {
            assetModelId: "model-1",
            assetModelName: "Dell Latitude 5550",
          },
        }),
      ]);
    });

    it("leaves the reservation closed when the removed asset discharged nothing", async () => {
      expect.assertions(2);
      // Reserve 3, all satisfied. A fourth asset of the same model was added
      // directly — it shares `assetModelId` but answered no promise, so its
      // row carries no `bookingModelRequestId`. Counting by model reopened the
      // reservation here and hard-blocked check-out while all three
      // discharging assets were still on the booking.
      const mockBooking = arrangeModelRemoval(
        {
          quantity: 3,
          fulfilledQuantity: 3,
          fulfilledAt: new Date("2026-05-02T10:00:00Z"),
        },
        [{ assetId: "asset-4", quantity: 1, bookingModelRequestId: null }]
      );

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(modelRequestChangedEvents()).toEqual([]);
      expect(db.bookingModelRequest.update).not.toHaveBeenCalled();
    });

    it("touches nothing when the requested asset had no row on this booking", async () => {
      expect.assertions(2);
      // `assetIds` is the caller's REQUEST, not the outcome: the bulk-remove
      // handler passes every member of a selected kit, including members
      // added to the kit after the booking was created and therefore never
      // on it. Counting those would decrement a reservation and forge a
      // reopening event for units that never left.
      const mockBooking = arrangeModelRemoval(
        { quantity: 3, fulfilledQuantity: 3, fulfilledAt: new Date() },
        []
      );

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.bookingModelRequest.update).not.toHaveBeenCalled();
      expect(modelRequestChangedEvents()).toEqual([]);
    });

    it("records nothing when the request was never fulfilled", async () => {
      expect.assertions(1);
      // 2 of 3 assigned: already outstanding, so `fulfilledAt` was already
      // null and the removal changes nothing about it. Gating on the
      // computed next value alone would emit a spurious null → null event.
      const mockBooking = arrangeModelRemoval({
        quantity: 3,
        fulfilledQuantity: 2,
        fulfilledAt: null,
      });

      await removeAssets({
        booking: mockBooking,
        firstName: "Test",
        lastName: "User",
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(modelRequestChangedEvents()).toEqual([]);
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
      // The reconciler reads the whole batch in two set-based queries and keys
      // on the slice markers, so these model row PRESENCE per asset rather
      // than a count per asset.
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockImplementation((args?: any) => {
        // Only the reconciler's read carries a `checkedOutAt` filter; every
        // other `bookingAsset.findMany` on these paths keeps the default [].
        if (args?.where?.checkedOutAt === undefined) return Promise.resolve([]);
        const ids: string[] = args?.where?.assetId?.in ?? [];
        return Promise.resolve(
          ids
            .filter((id) => (otherActiveBookingsByAssetId[id] ?? 0) > 0)
            .map((assetId) => ({ assetId }))
        );
      });
      (db.custody.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: any) => {
          const ids: string[] = args?.where?.assetId?.in ?? [];
          return Promise.resolve(
            ids
              .filter((id) => (custodyByAssetId[id] ?? 0) > 0)
              .map((assetId) => ({ assetId }))
          );
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
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
        displayName: null,
        userId: "user-1",
        organizationId: "org-1",
      });

      expect(db.asset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["asset-1"] }, organizationId: "org-1" },
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
    // why: `clearAllMocks` clears call history but not `mockResolvedValue`
    // implementations, and the tests here drive four shared mocks between
    // them. Without a reset a value set by one test answers a read the next
    // test never stubbed, which fails it for a reason that is not in it.
    // Same pattern as the `partialCheckinBooking` block below.
    for (const mock of [
      db.bookingAsset.findMany,
      db.partialBookingCheckin.findMany,
      db.partialBookingCheckout.findMany,
    ] as Array<ReturnType<typeof vitest.fn>>) {
      mock.mockReset().mockResolvedValue([]);
    }
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
        },
        {
          assetId: "asset-2",
          quantity: 10,
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-2", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 10 }]);
    // why: asset-1 is in a session → individual-side reconciled.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-1"],
        checkinTimestamp: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);
    // Booked 10 − logged 10 → remaining 0 for asset-2.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });

  it("returns false when a slice went out, came back, and went out again", async () => {
    expect.assertions(1);

    // A booking that is still ONGOING can be checked out again: the guard only
    // refuses COMPLETE, ARCHIVED and CANCELLED. So a slice can be dispatched,
    // partially checked in, then dispatched a second time.
    //
    // why: a legacy row. Checkout now clears `checkedInAt` when a slice
    // re-departs, so new rows do not look like this — but rows written before
    // that, and any left by a path that stamps a departure without clearing
    // the marker, still do. The gate reads the two markers against each other
    // so those rows are judged correctly too, rather than trusting any
    // `checkedInAt` as proof the slice came back.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 1,
        assetKitId: null,
        // Out at 10:00, back at 12:00, out again at 14:00. The second
        // departure refreshes `checkedOutAt`, so it now sits after the
        // check-in that answered the first trip.
        checkedOutAt: new Date("2026-01-01T14:00:00.000Z"),
        checkedInAt: new Date("2026-01-01T12:00:00.000Z"),
        checkedOutQuantity: 2,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([]);

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    // The asset left the warehouse twice and came back once, so the booking
    // cannot be complete.
    expect(result).toBe(false);
  });

  it("does not let a first-trip check-in session reconcile a second departure", async () => {
    expect.assertions(1);

    // The asset was checked in through a scan session on its first trip, so
    // its id is in that session's `assetIds` for good. It then departed again,
    // which clears the slice's `checkedInAt`. The session is the only record
    // left claiming a return, and it answers a trip that already ended.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 1,
        assetKitId: null,
        // Second departure, stamped after the session below.
        checkedOutAt: new Date("2026-01-03T09:00:00.000Z"),
        checkedInAt: null,
        checkedOutQuantity: 2,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: the session names the asset but predates the current departure.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-1"],
        checkinTimestamp: new Date("2026-01-02T17:00:00.000Z"),
      },
    ]);

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(false);
  });

  it("still accepts a check-in session that answers the current departure", async () => {
    expect.assertions(1);

    // The mirror of the case above, so the guard cannot be satisfied by simply
    // refusing every session. Here the session comes AFTER the departure, so it
    // is the record of this trip's return.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 1,
        assetKitId: null,
        checkedOutAt: new Date("2026-01-02T09:00:00.000Z"),
        checkedInAt: null,
        checkedOutQuantity: 1,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-1"],
        checkinTimestamp: new Date("2026-01-02T17:00:00.000Z"),
      },
    ]);

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });

  it("returns false when qty-tracked units went out, came back, and went out again", async () => {
    expect.assertions(1);

    // Same second-departure story on the quantity-tracked side. 5 units went
    // out, all 5 came back, then all 5 went out again.
    //
    // why: the marker is refreshed by the fix, so the slice reads as dispatched
    // and not reconciled. What decides the answer is the arithmetic: obligated
    // units are capped at the booked quantity, while the units already logged
    // as returned are the 5 from the FIRST trip. Capped obligation minus those
    // logged returns lands on zero, so the second departure has to be carried
    // by the cumulative counter rather than by the booked quantity.
    // why: one response, not a queued pair. The gate reads the slice rows and
    // then aggregates the check-in log directly, so it makes a single
    // `bookingAsset.findMany` call; a second queued value would go unconsumed
    // and fire inside the next test instead.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        id: "ba-1",
        assetId: "asset-1",
        quantity: 5,
        assetKitId: null,
        checkedOutAt: new Date("2026-01-02T10:00:00.000Z"),
        checkedInAt: null,
        checkedOutQuantity: 10,
        asset: { id: "asset-1", type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([]);
    // The 5 units returned from the first trip are logged.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 5 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    // 10 units have left across two trips and 5 have come back.
    expect(result).toBe(false);
  });

  it("returns false when an individual asset is missing from every session", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-2",
        quantity: 1,
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: { id: "asset-2", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: only asset-1 is reconciled; asset-2 is still pending.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-1"],
        checkinTimestamp: new Date("2026-01-01T12:00:00.000Z"),
      },
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("keeps the booking open while button-checked-out qty units are unreturned, even with a progressive checkout row present", async () => {
    expect.assertions(1);

    // The mixed-mode shape: a button checkout stamped every slice (writing
    // no PartialBookingCheckout rows), one late-added individual was scanned
    // out progressively (the booking's single session row), and every
    // individual was scanned back in — but a button-checked-out QT asset
    // never was. One session row must not strip the return obligation off
    // the other assets.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
        {
          assetId: "asset-ind",
          quantity: 1,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: new Date("2026-01-04T10:00:00.000Z"),
          asset: { id: "asset-ind", type: AssetType.INDIVIDUAL },
        },
        {
          assetId: "asset-scanned",
          quantity: 1,
          checkedOutAt: new Date("2026-01-01T12:00:00.000Z"),
          checkedInAt: new Date("2026-01-04T10:05:00.000Z"),
          asset: { id: "asset-scanned", type: AssetType.INDIVIDUAL },
        },
        {
          assetId: "asset-qty",
          quantity: 8,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 8 }]);
    // why: both individuals are reconciled via checkin sessions, so only the
    // qty asset's outstanding units can (and must) block completion.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-ind", "asset-scanned"],
        checkinTimestamp: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);
    // why: the booking's single progressive session — the row that used to
    // flip completion into session-only accounting for every asset.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      { assetIds: ["asset-scanned"], quantities: [1], bookingAssetIds: [""] },
    ]);
    // why: no returns logged for the qty asset — its 8 units are still out.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(false);
  });

  it("keeps a mixed multi-slice qty asset's button obligation when a sibling slice was scanned progressively", async () => {
    expect.assertions(1);

    // One QT asset, two slices: 8 units stamped by the button (no session
    // record) plus a 1-unit sibling scanned progressively (tagged session).
    // The sibling's session row must not erase the button slice's obligation.
    // why: first response = the booking's slices; second = the rows
    // `computeBookingAssetRemaining` aggregates for the same asset.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
        {
          id: "slice-button",
          assetId: "asset-qty",
          quantity: 8,
          assetKitId: null,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
        {
          id: "slice-scanned",
          assetId: "asset-qty",
          quantity: 1,
          assetKitId: null,
          checkedOutAt: new Date("2026-01-01T12:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 8 }, { quantity: 1 }]);
    // why: no full-asset reconciliation recorded — only unit returns below.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    // why: the progressive session names its exact slice, so attribution must
    // put its 1 unit on `slice-scanned` and leave the button slice untouched.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      {
        assetIds: ["asset-qty"],
        quantities: [1],
        bookingAssetIds: ["slice-scanned"],
      },
    ]);
    // why: only the scanned unit came back — booked 9 − logged 1 → 8 of the 9
    // obligated units are outstanding, so completion must be refused.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(false);
  });

  it("completes the mixed multi-slice qty asset once all dispatched units are reconciled", async () => {
    expect.assertions(1);

    // why: same two-slice shape as above; this time every dispatched unit has
    // a logged return.
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
        {
          id: "slice-button",
          assetId: "asset-qty",
          quantity: 8,
          assetKitId: null,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
        {
          id: "slice-scanned",
          assetId: "asset-qty",
          quantity: 1,
          assetKitId: null,
          checkedOutAt: new Date("2026-01-01T12:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 8 }, { quantity: 1 }]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([]);
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      {
        assetIds: ["asset-qty"],
        quantities: [1],
        bookingAssetIds: ["slice-scanned"],
      },
    ]);
    // why: booked 9 − logged 9 → zero remaining, all obligated units back.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 9 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });

  it("completes the mixed-mode booking once the button-checked-out qty units are reconciled", async () => {
    expect.assertions(1);

    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockResolvedValueOnce([
        {
          assetId: "asset-scanned",
          quantity: 1,
          checkedOutAt: new Date("2026-01-01T12:00:00.000Z"),
          checkedInAt: new Date("2026-01-04T10:05:00.000Z"),
          asset: { id: "asset-scanned", type: AssetType.INDIVIDUAL },
        },
        {
          assetId: "asset-qty",
          quantity: 8,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: { id: "asset-qty", type: AssetType.QUANTITY_TRACKED },
        },
      ])
      .mockResolvedValueOnce([{ quantity: 8 }]);
    // why: the individual is reconciled via its checkin session.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-scanned"],
        checkinTimestamp: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);
    // why: the same single progressive session as the blocking case above.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckout.findMany.mockResolvedValue([
      { assetIds: ["asset-scanned"], quantities: [1], bookingAssetIds: [""] },
    ]);
    // why: booked 8 − logged 8 → remaining 0, the qty obligation is settled.
    //@ts-expect-error missing vitest type
    db.consumptionLog.aggregate.mockResolvedValue({ _sum: { quantity: 8 } });

    const result = await isBookingFullyCheckedIn(db, "booking-1");

    expect(result).toBe(true);
  });

  it("ignores never-dispatched slices (added onto an ONGOING booking)", async () => {
    expect.assertions(1);

    // A slice with no `checkedOutAt` cannot be checked in (the eligibility
    // guard reads the same marker), so it must not gate completion either.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        assetId: "asset-1",
        quantity: 1,
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: new Date("2026-01-04T10:00:00.000Z"),
        asset: { id: "asset-1", type: AssetType.INDIVIDUAL },
      },
      {
        assetId: "asset-late",
        quantity: 1,
        checkedOutAt: null,
        checkedInAt: null,
        asset: { id: "asset-late", type: AssetType.INDIVIDUAL },
      },
    ]);
    // why: only the dispatched asset has a checkin session — the undispatched
    // one has nothing to reconcile and must not be waited for.
    //@ts-expect-error missing vitest type
    db.partialBookingCheckin.findMany.mockResolvedValue([
      {
        assetIds: ["asset-1"],
        checkinTimestamp: new Date("2026-01-01T12:00:00.000Z"),
      },
    ]);

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
    // `asset.findMany` is the check-in guard's title lookup. Nothing in this
    // block set it, so it inherited whatever an earlier describe left behind —
    // assets that are not on this booking at all. Echo the requested ids so the
    // lookup always describes the batch under test.
    (db.asset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockImplementation((args: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve(
          (args?.where?.id?.in ?? []).map((assetId) => ({
            id: assetId,
            title: assetId,
          }))
        )
      );
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
    (db.assetLocation.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.assetLocation.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({});
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
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
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

  it("records the canonical BOOKING_STATUS_CHANGED → COMPLETE event when qty dispositions complete the booking", async () => {
    expect.assertions(1);

    setupQtyMocks();

    // Full return of the only asset → the qty-disposition path completes the
    // booking itself (it does not delegate to `checkinBooking`). The Booking
    // Compliance report resolves check-in moments from this event, so the
    // completion must record it. Recorded after the transaction commits, like
    // every other BOOKING_STATUS_CHANGED write, so a failed analytics insert
    // cannot roll back a check-in the user already performed.
    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 10 }],
    });

    expect(activityEventService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "BOOKING_STATUS_CHANGED",
        bookingId: mockQtyBookingId,
        field: "status",
        toValue: BookingStatus.COMPLETE,
      })
    );
  });

  it("rewrites `to` to the return moment when an OVERDUE booking completes, keeping the planned end", async () => {
    expect.assertions(2);

    setupQtyMocks();

    // why: the completion path reads the booking's own row for its pre-flip
    // status and dates. An OVERDUE booking is the case that rewrites `to`, and
    // this asserts the qty path matches `checkinBooking` instead of leaving
    // the booking sitting on its blown deadline.
    const plannedEnd = new Date("2026-04-10T17:00:00Z");
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...makeQtyBooking(),
      status: BookingStatus.OVERDUE,
      from: new Date("2026-04-01T09:00:00Z"),
      to: plannedEnd,
      originalTo: plannedEnd,
    });

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 10 }],
    });

    const completeCall = vitest
      .mocked(db.booking.update)
      .mock.calls.map((call) => call[0] as { data?: Record<string, unknown> })
      .find((call) => call.data?.status === BookingStatus.COMPLETE);

    expect(completeCall?.data?.to).toBeInstanceOf(Date);
    expect(completeCall?.data?.originalTo).toBeUndefined();
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          assetId: "asset-individual-2",
          quantity: 1,
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("emits an ASSET_QUANTITY_CHANGED event for the pool decrement (from pool → pool − decrement)", async () => {
    expect.assertions(1);

    // pool = 100 (lock stub). lost(3) + damaged(2) = 5 units leave the pool,
    // so the audit event must capture 100 → 95.
    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 5, lost: 3, damaged: 2 }],
    });

    // recordEvents is called more than once in this flow (pool decrements +
    // BOOKING_PARTIAL_CHECKIN); assert one call carried the quantity event.
    const emittedQuantityChange = (
      activityEventService.recordEvents as ReturnType<typeof vitest.fn>
    ).mock.calls.some(([events]) =>
      (events as Array<Record<string, unknown>>).some(
        (e) =>
          e.action === "ASSET_QUANTITY_CHANGED" &&
          e.assetId === mockQtyAssetId &&
          e.field === "quantity" &&
          e.fromValue === 100 &&
          e.toValue === 95
      )
    );
    expect(emittedQuantityChange).toBe(true);
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
        // Fixture default: this slice went out with the booking.
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
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

  it("trims the single placement when a partial CONSUME pushes it above the new total", async () => {
    expect.assertions(1);

    // Same invariant as full check-in, different code path: the partial
    // check-in loop decrements the pool per disposition, so it drifts the
    // location axis exactly the same way if left unreconciled.
    setupQtyMocks();
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "al-pens", locationId: "loc-store", quantity: 100 },
    ]);

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, consumed: 10 }],
    });

    expect(db.assetLocation.update).toHaveBeenCalledWith({
      where: { id: "al-pens" },
      data: { quantity: 90 },
    });
  });

  it("writes no placement when a partial CONSUME is absorbed by the unplaced residual", async () => {
    expect.assertions(1);

    setupQtyMocks();
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "al-pens", locationId: "loc-store", quantity: 40 },
    ]);

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, consumed: 10 }],
    });

    expect(db.assetLocation.update).not.toHaveBeenCalled();
  });

  it("runs the low-stock notifier for the asset whose pool a CONSUME decremented", async () => {
    expect.assertions(1);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, consumed: 10 }],
    });

    // Decrement happened (consumed 10) → notifier fires post-tx with the
    // acting user + org so it can debounce + email owner/admins.
    expect(lowStockService.checkAndNotifyLowStock).toHaveBeenCalledWith({
      assetId: mockQtyAssetId,
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("does NOT run the low-stock notifier for a RETURN-only check-in (no pool decrement)", async () => {
    expect.assertions(1);

    setupQtyMocks();

    await partialCheckinBooking({
      ...baseParams,
      checkins: [{ assetId: mockQtyAssetId, returned: 10 }],
    });

    // RETURN puts units back in the pool — availability can only go UP, so the
    // decrement-triggered low-stock check must not fire.
    expect(lowStockService.checkAndNotifyLowStock).not.toHaveBeenCalled();
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
    // why: eligibility is judged per slice, so the booking has to actually
    // hold the two slices these dispositions name. Both are out.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...makeQtyBooking(),
      bookingAssets: ["ba-A", "ba-B"].map((sliceId) => ({
        id: sliceId,
        assetId: mockQtyAssetId,
        quantity: 50,
        checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
        checkedInAt: null,
        asset: {
          id: mockQtyAssetId,
          type: AssetType.QUANTITY_TRACKED,
          assetKits: [],
        },
      })),
    });

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

  it("refuses a disposition tagged with a slice that never went out", async () => {
    // The multi-slice hole: slice A is out, slice B was added to the ONGOING
    // booking afterwards and never scanned. Judging eligibility per ASSET lets
    // A's marker authorise B, and the per-slice cap starts from B's booked
    // units — so units that never left could be returned, consumed, lost or
    // damaged, permanently decrementing the pool.
    setupQtyMocks();
    // why: `computeBookingAssetSliceRemaining` reads the slice's booked
    // quantity for the per-slice cap. Giving it ample headroom proves the
    // rejection comes from the eligibility guard and not from the cap.
    (
      db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({ quantity: 50 });
    // why: eligibility is judged per slice, so the booking must actually hold
    // the slice the disposition names.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      ...makeQtyBooking(),
      bookingAssets: [
        {
          id: "ba-out",
          assetId: mockQtyAssetId,
          quantity: 50,
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
        {
          id: "ba-never-out",
          assetId: mockQtyAssetId,
          quantity: 50,
          checkedOutAt: null,
          checkedInAt: null,
          asset: {
            id: mockQtyAssetId,
            type: AssetType.QUANTITY_TRACKED,
            assetKits: [],
          },
        },
      ],
    });

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [
          {
            assetId: mockQtyAssetId,
            bookingAssetId: "ba-never-out",
            returned: 5,
          },
        ],
      })
    ).rejects.toThrow(/never checked out/i);
  });

  it("refuses a bookingAssetId that is not on this booking", async () => {
    // The slice id is request-supplied. Judging it against the booking's own
    // rows means a foreign or invented id is ineligible by construction.
    setupQtyMocks();

    await expect(
      partialCheckinBooking({
        ...baseParams,
        checkins: [
          {
            assetId: mockQtyAssetId,
            bookingAssetId: "ba-from-another-booking",
            returned: 1,
          },
        ],
      })
    ).rejects.toThrow(/does not belong to this booking/i);
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
    (db.assetLocation.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.assetLocation.update as ReturnType<typeof vitest.fn>)
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
          // Fixture default: this slice went out with the booking.
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
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

  it("trims the single placement when a CONSUME check-in pushes it above the new total", async () => {
    expect.assertions(1);

    // All 100 owned units sit in one location, so destroying 10 on check-in
    // would leave SUM(AssetLocation) = 100 against Asset.quantity = 90. The
    // location trigger never fires on an `Asset` write, so nothing else
    // catches this — the next legitimate placement edit is what gets refused.
    setupCheckinMocks(ConsumptionType.ONE_WAY);
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "al-pens", locationId: "loc-store", quantity: 100 },
    ]);

    await checkinBooking(baseParams);

    expect(db.assetLocation.update).toHaveBeenCalledWith({
      where: { id: "al-pens" },
      data: { quantity: 90 },
    });
  });

  it("leaves placements alone on a CONSUME check-in the unplaced residual absorbs", async () => {
    expect.assertions(1);

    // 40 of 100 placed, so consuming 10 shrinks the residual from 60 to 50.
    // Nothing is asserted about the location, so nothing is written to it.
    setupCheckinMocks(ConsumptionType.ONE_WAY);
    (
      db.assetLocation.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { id: "al-pens", locationId: "loc-store", quantity: 40 },
    ]);

    await checkinBooking(baseParams);

    expect(db.assetLocation.update).not.toHaveBeenCalled();
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
      role: OrganizationRoles.OWNER,
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
      userId: "user-1",
      role: OrganizationRoles.OWNER,
    });

    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["b1", "b2"] },
        organizationId: "org-1",
        status: BookingStatus.COMPLETE,
      },
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

  it("throws if any selected booking is not archivable (e.g. ONGOING)", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        status: BookingStatus.ONGOING,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await expect(
      bulkArchiveBookings({
        bookingIds: ["b1"],
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationRoles.OWNER,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("archives a past-due RESERVED booking and flags it archivedWithoutCheckin", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "r1",
        status: BookingStatus.RESERVED,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await bulkArchiveBookings({
      bookingIds: ["r1"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
    });

    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["r1"] },
        organizationId: "org-1",
        status: BookingStatus.RESERVED,
      },
      data: {
        status: BookingStatus.ARCHIVED,
        archivedWithoutCheckin: true,
      },
    });
  });

  it("rejects a RESERVED booking whose end date has not passed", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "r1",
        status: BookingStatus.RESERVED,
        to: new Date("2999-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await expect(
      bulkArchiveBookings({
        bookingIds: ["r1"],
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationRoles.OWNER,
      })
    ).rejects.toThrow(ShelfError);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  it("rejects OVERDUE bookings even when past their end date (assets still checked out)", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "o1",
        status: BookingStatus.OVERDUE,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await expect(
      bulkArchiveBookings({
        bookingIds: ["o1"],
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationRoles.OWNER,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("flags only the never-returned RESERVED rows when archiving a mixed selection", async () => {
    expect.assertions(2);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "c1",
        status: BookingStatus.COMPLETE,
        to: new Date("2999-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
      {
        id: "r1",
        status: BookingStatus.RESERVED,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await bulkArchiveBookings({
      bookingIds: ["c1", "r1"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
    });

    // COMPLETE rows archive without the flag…
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["c1"] },
        organizationId: "org-1",
        status: BookingStatus.COMPLETE,
      },
      data: { status: BookingStatus.ARCHIVED },
    });
    // …RESERVED rows archive WITH the never-returned flag.
    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["r1"] },
        organizationId: "org-1",
        status: BookingStatus.RESERVED,
      },
      data: {
        status: BookingStatus.ARCHIVED,
        archivedWithoutCheckin: true,
      },
    });
  });

  it("emits a BOOKING_ARCHIVED event per booking (parity with single archive)", async () => {
    expect.assertions(1);
    //@ts-expect-error mock setup
    db.booking.findMany.mockResolvedValue([
      {
        id: "b1",
        status: BookingStatus.COMPLETE,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
      {
        id: "b2",
        status: BookingStatus.COMPLETE,
        to: new Date("2020-01-01T00:00:00Z"),
        custodianUserId: null,
        activeSchedulerReference: null,
      },
    ]);

    await bulkArchiveBookings({
      bookingIds: ["b1", "b2"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
    });

    expect(activityEventService.recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "BOOKING_ARCHIVED",
          bookingId: "b1",
        }),
        expect.objectContaining({
          action: "BOOKING_ARCHIVED",
          bookingId: "b2",
        }),
      ])
    );
  });

  // Regression for the phantom-archive race: the status-guarded updateMany can
  // skip a row whose status changed between the findMany and the write (e.g. a
  // RESERVED booking checked out mid-batch). The follow-up events + notes must
  // reflect only the rows actually flipped — never the originally-fetched set —
  // or we'd log a booking as archived while it is still ONGOING.
  it("emits events + notes only for bookings the status guard actually archived", async () => {
    expect.assertions(3);

    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany
      // main fetch: b1 (COMPLETE) + r1 (past-due RESERVED) both look eligible
      .mockResolvedValueOnce([
        {
          id: "b1",
          status: BookingStatus.COMPLETE,
          to: new Date("2020-01-01T00:00:00Z"),
          custodianUserId: null,
          activeSchedulerReference: null,
        },
        {
          id: "r1",
          status: BookingStatus.RESERVED,
          to: new Date("2020-01-01T00:00:00Z"),
          custodianUserId: null,
          activeSchedulerReference: null,
        },
      ])
      // reconcile read: only b1 ended up ARCHIVED — r1 was checked out and its
      // RESERVED-guarded updateMany matched no row.
      .mockResolvedValueOnce([{ id: "b1" }]);

    const updateMany = db.booking.updateMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    updateMany
      .mockResolvedValueOnce({ count: 1 }) // completeIds → b1 archived
      .mockResolvedValueOnce({ count: 0 }); // reservedIds → r1 skipped

    await bulkArchiveBookings({
      bookingIds: ["b1", "r1"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
    });

    // Exactly one BOOKING_ARCHIVED event, for the archived booking only.
    expect(activityEventService.recordEvents).toHaveBeenCalledWith([
      expect.objectContaining({ action: "BOOKING_ARCHIVED", bookingId: "b1" }),
    ]);
    // Status note for the archived booking …
    expect(bookingNoteService.createSystemBookingNote).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "b1" })
    );
    // … but never for the concurrently-skipped one.
    expect(bookingNoteService.createSystemBookingNote).not.toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "r1" })
    );
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
      role: OrganizationRoles.OWNER,
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

  /**
   * An asset can sit on two live bookings at once. Cancelling one of them says
   * nothing about the other, so the exit has to ask what commitment is left
   * rather than blanket-writing AVAILABLE. Marking it available while a
   * borrower still holds it for the other booking puts it back in the pool for
   * someone else to book.
   */
  it("leaves an asset CHECKED_OUT when another live booking still holds it", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([
      {
        id: "bk-ongoing",
        name: "Ongoing booking",
        status: BookingStatus.ONGOING,
        custodianUserId: null,
        activeSchedulerReference: null,
        bookingAssets: [{ asset: { id: "asset-shared", assetKits: [] } }],
        from: new Date("2025-01-01T09:00:00Z"),
        to: new Date("2025-01-02T17:00:00Z"),
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 1 },
      },
    ]);
    // The asset is still on one OTHER ONGOING booking, outside this selection.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation((args?: any) =>
      Promise.resolve(
        args?.where?.checkedOutAt === undefined
          ? []
          : [{ assetId: "asset-shared" }]
      )
    );
    (db.custody.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([]);

    await bulkCancelBookings({
      bookingIds: ["bk-ongoing"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
      hints: mockClientHints,
    });

    const assetWrites = (
      db.asset.updateMany as ReturnType<typeof vitest.fn>
    ).mock.calls.filter((c: any) => c[0]?.data?.status !== undefined);

    expect(
      assetWrites.some((c: any) => c[0].data.status === AssetStatus.AVAILABLE),
      "no write may free an asset another live booking still holds"
    ).toBe(false);
    expect(
      assetWrites.some(
        (c: any) => c[0].data.status === AssetStatus.CHECKED_OUT
      ),
      "the remaining commitment should keep it checked out"
    ).toBe(true);
  });

  /**
   * A live booking is not by itself evidence that it holds the asset. A slice
   * added after that booking checked out has never left, and one already
   * reconciled has come back. Counting either pins the asset to CHECKED_OUT
   * with nothing in the field, and no later exit can clear it.
   *
   * Asserted on the query rather than the outcome: the filter is what the
   * database applies, so a mocked result cannot demonstrate it.
   */
  it("counts only slices that are genuinely still out", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([
      {
        id: "bk-marker",
        name: "Ongoing booking",
        status: BookingStatus.ONGOING,
        custodianUserId: null,
        activeSchedulerReference: null,
        bookingAssets: [{ asset: { id: "asset-shared", assetKits: [] } }],
        from: new Date("2025-01-01T09:00:00Z"),
        to: new Date("2025-01-02T17:00:00Z"),
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 1 },
      },
    ]);
    (db.custody.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([]);

    await bulkCancelBookings({
      bookingIds: ["bk-marker"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
      hints: mockClientHints,
    });

    const reconcileRead = (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mock.calls
      .map((call: any) => call[0])
      .find((args: any) => args?.where?.assetId?.in && args?.select?.assetId);

    expect(
      reconcileRead?.where?.checkedOutAt,
      "a slice that never left must not count as holding the asset"
    ).toEqual({ not: null });
    expect(
      reconcileRead?.where?.checkedInAt,
      "a slice already reconciled must not count as holding the asset"
    ).toBeNull();
  });

  /**
   * Every booking in the selection must be invisible to the reconciliation,
   * not just one. Two bookings on their way out that share an asset would
   * otherwise vouch for each other and pin it to CHECKED_OUT against nothing.
   */
  it("excludes every booking in the selection, not just one", async () => {
    expect.assertions(1);

    const twoBookings = ["bk-a", "bk-b"].map((id) => ({
      id,
      name: id,
      status: BookingStatus.ONGOING,
      custodianUserId: null,
      activeSchedulerReference: null,
      bookingAssets: [{ asset: { id: "asset-shared", assetKits: [] } }],
      from: new Date("2025-01-01T09:00:00Z"),
      to: new Date("2025-01-02T17:00:00Z"),
      organization: { customEmailFooter: null },
      custodianUser: null,
      custodianTeamMember: null,
      _count: { bookingAssets: 1 },
    }));
    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue(twoBookings);
    (db.custody.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([]);

    await bulkCancelBookings({
      bookingIds: ["bk-a", "bk-b"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
      hints: mockClientHints,
    });

    const reconcileRead = (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mock.calls
      .map((call: any) => call[0])
      .find((args: any) => args?.where?.assetId?.in && args?.select?.assetId);

    expect(
      [...(reconcileRead?.where?.bookingId?.notIn ?? [])].sort(),
      "both exiting bookings must be excluded from the held-elsewhere read"
    ).toEqual(["bk-a", "bk-b"]);
  });
});

describe("bulkDeleteBookings", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * Same rule as the bulk cancel: deleting a booking says nothing about the
   * other commitments on its assets. This path deletes the bookings first, so
   * their own rows are already gone by the time the reconciliation reads.
   */
  it("leaves an asset CHECKED_OUT when another live booking still holds it", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.booking.findMany.mockResolvedValue([
      {
        id: "bk-del-ongoing",
        name: "Ongoing booking",
        status: BookingStatus.ONGOING,
        custodianUserId: null,
        activeSchedulerReference: null,
        bookingAssets: [{ asset: { id: "asset-shared", assetKits: [] } }],
        from: new Date("2025-01-01T09:00:00Z"),
        to: new Date("2025-01-02T17:00:00Z"),
        organization: { customEmailFooter: null },
        custodianUser: null,
        custodianTeamMember: null,
        _count: { bookingAssets: 1 },
      },
    ]);
    // Still on one OTHER ONGOING booking, outside this selection.
    (
      db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
    ).mockImplementation((args?: any) =>
      Promise.resolve(
        args?.where?.checkedOutAt === undefined
          ? []
          : [{ assetId: "asset-shared" }]
      )
    );
    (db.custody.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([]);

    await bulkDeleteBookings({
      bookingIds: ["bk-del-ongoing"],
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.OWNER,
      hints: mockClientHints,
    });

    const assetWrites = (
      db.asset.updateMany as ReturnType<typeof vitest.fn>
    ).mock.calls.filter((c: any) => c[0]?.data?.status !== undefined);

    expect(
      assetWrites.some((c: any) => c[0].data.status === AssetStatus.AVAILABLE),
      "no write may free an asset another live booking still holds"
    ).toBe(false);
    expect(
      assetWrites.some(
        (c: any) => c[0].data.status === AssetStatus.CHECKED_OUT
      ),
      "the remaining commitment should keep it checked out"
    ).toBe(true);
  });
});

describe("addScannedAssetsToBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
  ])("refuses to add scanned assets to a %s booking", async (status) => {
    // This path had no booking-status check anywhere before: the route action
    // only called requirePermission, and the loader's canUserManageBookingAssets
    // decided what to RENDER, not what to accept. A direct POST could therefore
    // append assets to a closed booking. (detail.dev D097)
    //
    // Asserting through the public service function rather than the assertion
    // helper directly, so this fails if the guard is ever unwired from the path.
    // why: the guard takes a row lock via raw SQL, so this is the read it
    // asserts on. Once, not persistent: clearAllMocks clears call history but
    // NOT implementations, so a persistent closed status would answer every
    // later test in this describe and fail them for the wrong reason.
    (db.$queryRaw as ReturnType<typeof vitest.fn>).mockResolvedValueOnce([
      { status },
    ]);

    await expect(
      addScannedAssetsToBooking({
        assetIds: ["asset-1"],
        kitIds: [],
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow(/closed records/);

    // The booking must be untouched — the guard runs before any write.
    expect(db.booking.update).not.toHaveBeenCalled();
  });

  describe("QUANTITY_TRACKED pool", () => {
    const QT_ID = "asset-qty-scan";
    const from = new Date("2026-07-01T09:00:00Z");
    const to = new Date("2026-07-01T17:00:00Z");

    /**
     * One quantity-tracked asset with a fixed pool, answering every
     * `asset.findMany` this path drives (the org-scope check, the conflict
     * candidates, the scanned-asset metadata and the availability read — one
     * mock, different `select` shapes, which the stub does not project).
     */
    /**
     * Order of the two steps that matter, appended as they happen.
     *
     * No delegate belongs to the pool read alone — `asset.findMany` serves the
     * org-scope check, the conflict candidates, the scanned metadata and the
     * note builder as well — so invocation counters cannot separate them.
     * The pool read is identifiable by its projection instead: `id` and
     * `quantity` and nothing else.
     */
    let sequence: string[] = [];

    function mockPool(
      total: number,
      type: AssetType = AssetType.QUANTITY_TRACKED
    ) {
      (db.asset.findMany as ReturnType<typeof vitest.fn>).mockImplementation(
        (args?: {
          where?: { id?: { in?: string[] } };
          select?: Record<string, boolean>;
        }) => {
          const select = args?.select ?? {};
          const keys = Object.keys(select).sort();
          if (keys.length === 2 && keys[0] === "id" && keys[1] === "quantity") {
            sequence.push("measure");
          }
          return Promise.resolve(
            (args?.where?.id?.in ?? []).map((id) => ({
              id,
              type,
              title: "Folding Chairs",
              unitOfMeasure: "chairs",
              quantity: total,
              status: AssetStatus.AVAILABLE,
              bookingAssets: [],
            }))
          );
        }
      );
    }

    beforeEach(() => {
      sequence = [];
      // why: the lock is a module mock, so it records its own turn in the
      // sequence and still resolves the minimal asset stub its callers expect.
      (
        quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
      ).mockImplementation(() => {
        sequence.push("lock");
        return Promise.resolve({
          id: QT_ID,
          title: "Folding Chairs",
          quantity: 2,
        });
      });
      mockPool(2);
      // No rows anywhere: nothing already on this booking, nothing reserved
      // elsewhere, nothing checked out.
      (
        db.bookingAsset.findMany as ReturnType<typeof vitest.fn>
      ).mockResolvedValue([]);
      (db.booking.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
        from,
        to,
      });
    });

    it("refuses to scan more units than the pool can cover", async () => {
      // The conflict guard above this one is INDIVIDUAL semantics — one asset,
      // one booking at a time. A quantity-tracked asset legitimately sits in
      // many bookings at once, so nothing there measures the pool and the
      // units could be promised twice.
      await expect(
        addScannedAssetsToBooking({
          assetIds: [QT_ID],
          kitIds: [],
          bookingId: "booking-1",
          organizationId: "org-1",
          userId: "user-1",
          quantities: { [QT_ID]: 5 },
        })
      ).rejects.toThrow(ShelfError);

      expect(db.booking.update).not.toHaveBeenCalled();
    });

    it("locks each quantity-tracked asset before measuring the pool", async () => {
      await addScannedAssetsToBooking({
        assetIds: [QT_ID],
        kitIds: [],
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "user-1",
        quantities: { [QT_ID]: 1 },
      }).catch(() => undefined);

      // Measuring an unclaimed pool is the race: a plain SELECT takes no lock
      // under READ COMMITTED, so two scans read the same free count.
      expect(quantityLock.lockAssetForQuantityUpdate).toHaveBeenCalledWith(
        expect.anything(),
        QT_ID,
        "org-1"
      );

      // Taking the lock is only half of it — taking it AFTER the measurement
      // leaves the race exactly as it was.
      expect(sequence).toEqual(["lock", "measure"]);
    });

    it("leaves INDIVIDUAL assets to the conflict guard", async () => {
      mockPool(2, AssetType.INDIVIDUAL);

      await addScannedAssetsToBooking({
        assetIds: ["asset-individual"],
        kitIds: [],
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "user-1",
      }).catch(() => undefined);

      // An INDIVIDUAL asset has no pool to draw on — locking it here would
      // serialize scans that never compete.
      expect(quantityLock.lockAssetForQuantityUpdate).not.toHaveBeenCalled();
    });
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

  it("resolves a kit slice's sourceKitId from the AssetKit row, ignoring the client-supplied kitId", async () => {
    // The scan drawer's `kitId` is untrusted JSON and `BookingAsset.sourceKitId`
    // has an FK that accepts ANY kit — including another org's. The server must
    // re-resolve it from the `assetKitId`, which `assertAssetKitsBelongToOrg`
    // has already proven in-org. Here the caller sends a foreign kit id; the
    // persisted value must be the AssetKit's own kit.
    expect.assertions(1);

    // why: the first test in this describe leaves a booking window on
    // findFirst; null skips the overlap-conflict guard so this test can focus
    // on the write payload.
    //@ts-expect-error missing vitest type
    db.booking.findFirst.mockResolvedValue(null);

    // why: serves both assertAssetsBelongToOrg (count check) and the
    // scanned-asset metadata fetch. `assetModelId: null` keeps the
    // materialize-model-request loop a no-op.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-kit-member",
        title: "Kit Member",
        type: AssetType.QUANTITY_TRACKED,
        assetModelId: null,
      },
    ]);

    // why: one mock serves both assetKit reads — assertAssetKitsBelongToOrg
    // (which only counts rows) and the quantity/kitId resolution. `kit-real`
    // is the AssetKit's true owner and must win over the caller's value.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      { id: "ak-1", quantity: 7, kitId: "kit-real" },
    ]);

    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      id: "booking-scan",
      name: "Scan Booking",
      status: BookingStatus.DRAFT,
    });

    await addScannedAssetsToBooking({
      assetIds: [],
      kitIds: [],
      bookingId: "booking-scan",
      organizationId: "org-1",
      userId: "user-1",
      kitSlices: [
        {
          assetId: "asset-kit-member",
          assetKitId: "ak-1",
          // A foreign / tampered value from the client payload.
          kitId: "kit-from-another-org",
        },
      ],
    });

    expect(db.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          bookingAssets: {
            create: [
              {
                assetId: "asset-kit-member",
                // Falls back to the AssetKit's quantity (no explicit slice qty).
                quantity: 7,
                assetKitId: "ak-1",
                sourceKitId: "kit-real",
                // A kit-driven row never discharges a model reservation.
                bookingModelRequestId: null,
              },
            ],
          },
        },
      })
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

describe("getAvailableAssetsIdsForBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("returns the ids of assets that don't belong to a kit", async () => {
    // why: stub the org-scoped asset lookup so the function resolves against
    // deterministic rows without a real DB; neither asset belongs to a kit.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "asset-1", status: AssetStatus.AVAILABLE, assetKits: [] },
      { id: "asset-2", status: AssetStatus.AVAILABLE, assetKits: [] },
    ]);

    await expect(
      getAvailableAssetsIdsForBooking(["asset-1", "asset-2"], "org-1")
    ).resolves.toEqual(["asset-1", "asset-2"]);
  });

  it("returns a QUANTITY_TRACKED kit member — its free pool stays directly bookable", async () => {
    // A QT asset allocates only a slice of its pool per kit (and may sit in
    // several kits at once), so the remaining units are legitimately bookable
    // on their own. Rejecting on mere membership 400'd the "Book" actions on
    // the asset overview page for a customer with free standalone units.
    // why: stub the org-scoped lookup to return one QT asset that IS a kit
    // member — the branch that must NOT reject.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        status: AssetStatus.AVAILABLE,
        type: AssetType.QUANTITY_TRACKED,
        assetKits: [{ kitId: "kit-1" }, { kitId: "kit-2" }],
      },
    ]);

    await expect(
      getAvailableAssetsIdsForBooking(["asset-1"], "org-1")
    ).resolves.toEqual(["asset-1"]);
  });

  it("rejects an INDIVIDUAL kit-member asset as a handled 400, not a captured 500 (SHELF-WEBAPP-21Y)", async () => {
    // A selected asset that belongs to a kit is user-input validation, not a
    // server fault, so it must be a 400 kept out of the Sentry error pipeline.
    // why: stub the org-scoped lookup to return one asset that IS a kit member
    // (assetKits non-empty) — the rejection branch under test.
    (db.asset.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "asset-1",
        status: AssetStatus.AVAILABLE,
        type: AssetType.INDIVIDUAL,
        assetKits: [{ kitId: "kit-1" }],
      },
    ]);

    let thrown: unknown;
    try {
      await getAvailableAssetsIdsForBooking(["asset-1"], "org-1");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const err = thrown as ShelfError;
    expect(err.message).toContain("belong to a kit");
    // The outer catch re-wraps, but ShelfError inherits status/shouldBeCaptured
    // from the cause, so the handled-client classification survives.
    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
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
      displayName: null,
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

  it("scopes to both custody links when restricted to the custodian", async () => {
    // Custody sits on the user link OR on a team-member link, and a booking
    // assigned to a team member before a user was attached to it keeps
    // `custodianUserId` NULL. Matching the user link alone hides exactly the
    // bookings those users own.
    // why: stub the query so the where-clause is observable without a database.
    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany.mockResolvedValueOnce([]);
    // why: this is the lookup `resolveCustodianScope` performs; the user holds
    // two team-member rows, which the schema permits (no unique on
    // `(userId, organizationId)`).
    (
      db.teamMember.findMany as unknown as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([{ id: "tm-1" }, { id: "tm-2" }]);

    await getMinimalBookings({
      organizationId: "org-1",
      userId: "user-1",
      restrictToCustodian: true,
    });

    const arg = findMany.mock.calls[0][0];
    // AND-ed, not merged into a top-level OR where another clause could widen
    // it away.
    expect(arg.where.custodianUserId).toBeUndefined();
    expect(arg.where.AND).toContainEqual({
      OR: [
        { custodianUserId: "user-1" },
        { custodianTeamMemberId: { in: ["tm-1", "tm-2"] } },
      ],
    });
  });

  it("falls back to the user link when the user holds no team-member row", async () => {
    const findMany = db.booking.findMany as unknown as ReturnType<
      typeof vitest.fn
    >;
    findMany.mockResolvedValueOnce([]);
    // why: a user with no team member in the org — the clause has nothing to
    // add, and must not degrade into matching everything.
    (
      db.teamMember.findMany as unknown as ReturnType<typeof vitest.fn>
    ).mockResolvedValueOnce([]);

    await getMinimalBookings({
      organizationId: "org-1",
      userId: "user-1",
      restrictToCustodian: true,
    });

    const arg = findMany.mock.calls[0][0];
    expect(arg.where.AND).toContainEqual({ custodianUserId: "user-1" });
  });
});

describe("cancelBooking — handled validation (SHELF-WEBAPP-222)", () => {
  it("rejects a non-cancellable booking as a handled 400, not a captured 500", async () => {
    // why: the guard loads the booking fresh; return a COMPLETE booking (not in
    // the allowed-to-cancel set) so cancelBooking hits the status guard.
    (
      db.booking.findUniqueOrThrow as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "booking-1",
      status: BookingStatus.COMPLETE,
      bookingAssets: [],
    });

    let thrown: unknown;
    try {
      await cancelBooking({
        id: "booking-1",
        organizationId: "org-1",
        hints: { timeZone: "UTC", locale: "en-US" } as never,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const err = thrown as ShelfError;
    expect(err.message).toContain("cannot be cancelled");
    // The outer catch re-wraps, but ShelfError inherits status/shouldBeCaptured
    // from the cause, so the handled-client classification survives.
    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
    // ...and additionalData is forwarded through the wrapper (not inherited by
    // ShelfError automatically), so the debug context survives.
    expect(err.additionalData).toMatchObject({
      bookingId: "booking-1",
      status: BookingStatus.COMPLETE,
    });
  });
});

/**
 * Kit release resolves from the booking's own slices as well as from live
 * membership.
 *
 * Membership alone cannot see a kit whose member was detached while the
 * booking ran, so nothing releases it and `Kit.status` stays CHECKED_OUT with
 * nothing out. The booking's rows still remember the kit, so they answer where
 * membership cannot — and the two are UNIONED, never substituted: a standalone
 * slice carries no provenance even when its asset is a live kit member.
 */
describe("getKitIdsByBookingSlices", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("resolves a kit from sourceKitId with no membership left", async () => {
    const result = await getKitIdsByBookingSlices({
      slices: [
        { assetId: "asset-1", assetKitId: null, sourceKitId: "kit-1" },
        { assetId: "asset-2", assetKitId: null, sourceKitId: "kit-1" },
        { assetId: "asset-3", assetKitId: null, sourceKitId: "kit-2" },
      ],
      organizationId: "org-1",
    });

    expect([...result.keys()].sort()).toEqual(["kit-1", "kit-2"]);
    expect([...(result.get("kit-1") ?? [])].sort()).toEqual([
      "asset-1",
      "asset-2",
    ]);
    // No legacy rows, so the AssetKit hop is skipped entirely.
    expect(db.assetKit.findMany).not.toHaveBeenCalled();
  });

  it("falls back to assetKitId for rows written before sourceKitId existed", async () => {
    // why: overrides the module default, which derives a kitId from the input
    // (`kit-of-<id>`). A fixed row instead, so the assertion names the kit this
    // leg must resolve `ak-1` to rather than a value echoed back from the id.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([{ id: "ak-1", kitId: "kit-9" }]);

    const result = await getKitIdsByBookingSlices({
      slices: [{ assetId: "asset-1", assetKitId: "ak-1", sourceKitId: null }],
      organizationId: "org-1",
    });

    expect([...result.keys()]).toEqual(["kit-9"]);
    // Org-scoped, so the lookup cannot reach another workspace's memberships.
    expect(db.assetKit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ak-1"] }, organizationId: "org-1" },
      select: { id: true, kitId: true },
    });
  });

  it("ignores a standalone slice, which carries no kit provenance", async () => {
    const result = await getKitIdsByBookingSlices({
      slices: [{ assetId: "asset-1", assetKitId: null, sourceKitId: null }],
      organizationId: "org-1",
    });

    expect(result.size).toBe(0);
  });

  it("resolves nothing rather than throwing when a membership has vanished", async () => {
    // A concurrent detach legitimately removes the row between the two reads.
    // That means "no kit to release", never "reject the check-in".
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([]);

    const result = await getKitIdsByBookingSlices({
      slices: [
        { assetId: "asset-1", assetKitId: "ak-gone", sourceKitId: null },
      ],
      organizationId: "org-1",
    });

    expect(result.size).toBe(0);
  });

  it("prefers sourceKitId and skips the lookup when every row carries it", async () => {
    const result = await getKitIdsByBookingSlices({
      slices: [
        { assetId: "asset-1", assetKitId: "ak-stale", sourceKitId: "kit-1" },
      ],
      organizationId: "org-1",
    });

    expect([...result.keys()]).toEqual(["kit-1"]);
    expect(db.assetKit.findMany).not.toHaveBeenCalled();
  });
});

/**
 * A kit whose members were detached while the booking ran is still released.
 *
 * The detach leaves the slices on the booking with their kit provenance
 * intact, but the assets themselves no longer name the kit — so membership
 * alone resolves nothing and the kit keeps reading CHECKED_OUT after the
 * booking ends. A kit in that state cannot be added to a live booking and has
 * no way out of the UI.
 */
describe("checkinBooking - releases a kit detached mid-booking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("releases the kit from slice provenance when membership is gone", async () => {
    expect.assertions(1);

    // why: the slices still carry `sourceKitId`, but `assetKits` is empty —
    // exactly what a mid-booking detach leaves behind. Membership-based
    // resolution finds no kit here, so nothing would release it.
    const detachedKitBooking = {
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          asset: {
            id: "asset-1",
            type: AssetType.INDIVIDUAL,
            assetKits: [],
            status: AssetStatus.CHECKED_OUT,
            bookingAssets: [
              { booking: { id: "booking-1", status: BookingStatus.ONGOING } },
            ],
          },
          assetId: "asset-1",
          quantity: 1,
          id: "ba-detached",
          assetKitId: null,
          sourceKitId: "kit-1",
          checkedOutAt: new Date("2026-01-01T10:00:00.000Z"),
          checkedInAt: null,
        },
      ],
      partialCheckins: [],
    };

    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue(detachedKitBooking);
    //@ts-expect-error missing vitest type
    db.booking.update.mockResolvedValue({
      ...detachedKitBooking,
      status: BookingStatus.COMPLETE,
    });

    await checkinBooking({
      id: "booking-1",
      organizationId: "org-1",
      hints: mockClientHints,
    });

    expect(db.kit.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1"] }, organizationId: "org-1" },
      data: { status: KitStatus.AVAILABLE },
    });
  });
});

/**
 * Kit release on partial check-in is decided per `BookingAsset` SLICE.
 *
 * A QUANTITY_TRACKED asset holds a standalone slice plus one slice per kit it
 * belongs to on the same booking, so an asset-keyed answer lets one kit's slice
 * speak for its siblings: it released a kit whose units were still in the field,
 * and stranded a kit whose units had all come back.
 */
describe("partialCheckinBooking — slice-grained kit release", () => {
  const ORG = "org-1";
  /** An instant a slice left on. */
  const OUT = new Date("2026-01-01T10:00:00.000Z");
  /** An instant an earlier session reconciled a slice on. */
  const BACK = new Date("2026-01-02T10:00:00.000Z");

  beforeEach(() => {
    vitest.clearAllMocks();
    (db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.partialBookingCheckin.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.partialBookingCheckin.count as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue(1);
    (db.consumptionLog.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (db.consumptionLog.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
    (db.custody.aggregate as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ _sum: { quantity: 0 } });
    (db.booking.update as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockResolvedValue({ ...mockBookingData, bookingAssets: [] });
    // The check-in guard's title lookup. Echo the requested ids so it always
    // describes the batch under test.
    (db.asset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockImplementation((args?: any) =>
        Promise.resolve(
          (args?.where?.id?.in ?? []).map((assetId: string) => ({
            id: assetId,
            title: assetId,
            status: AssetStatus.CHECKED_OUT,
            assetKits: [],
          }))
        )
      );
    (
      quantityLock.lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>
    ).mockResolvedValue({
      id: "asset-x",
      title: "Gaffer tape",
      quantity: 100,
      type: AssetType.QUANTITY_TRACKED,
      unitOfMeasure: null,
      consumptionType: ConsumptionType.TWO_WAY,
    });
  });

  /**
   * Routes the three `bookingAsset.findMany` shapes this path issues, which one
   * model-shaped mock cannot tell apart:
   *   - `where.assetId`   -> `computeBookingAssetRemaining` (asset-level booked)
   *   - `where.checkedOutAt` -> the kit gate's still-out veto read
   *   - otherwise         -> `isBookingFullyCheckedIn`, and the post-transaction
   *     toast read, which shares the bookingId-only shape but reads just
   *     `assetId` and `asset.type` — the slice markers below are inert for it.
   */
  function mockSliceReads(args: { slices: any[]; stillOutNow?: any[] }) {
    (db.bookingAsset.findMany as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockImplementation((q?: any) => {
        // `computeBookingAssetsSliceRemainingToCheckOut`, read (1): the slices
        // it was asked about. Keyed on `where.id.in`, which no other read here
        // uses.
        if (q?.where?.id?.in) {
          return Promise.resolve(
            args.slices
              .filter((s) => q.where.id.in.includes(s.id))
              .map((s) => ({
                id: s.id,
                assetId: s.assetId,
                quantity: s.quantity,
                assetKitId: s.assetKitId,
                asset: { status: AssetStatus.CHECKED_OUT },
              }))
          );
        }
        // Same helper, read (2): every sibling slice of the involved assets, so
        // its greedy fill sees the full set. `where.assetId` is an `in` filter
        // here and a scalar in the asset-level read below.
        if (q?.where?.assetId?.in) {
          return Promise.resolve(
            args.slices
              .filter((s) => q.where.assetId.in.includes(s.assetId))
              .map((s) => ({
                id: s.id,
                assetId: s.assetId,
                quantity: s.quantity,
                assetKitId: s.assetKitId,
              }))
          );
        }
        if (q?.where?.assetId) {
          return Promise.resolve(
            args.slices
              .filter((s) => s.assetId === q.where.assetId)
              .map((s) => ({ quantity: s.quantity }))
          );
        }
        if (q?.where?.checkedOutAt) {
          return Promise.resolve(args.stillOutNow ?? []);
        }
        // `isBookingFullyCheckedIn`: keep the booking incomplete so the test
        // exercises the progressive path rather than the COMPLETE branch.
        //
        // The slice markers are what make that true, so they have to be here.
        // The helper judges dispatch per slice, and a row without
        // `checkedOutAt` reads as never dispatched — every slice skipped, no
        // obligation left, and the booking completes. `id` matters for the
        // same reason: session units are attributed by slice id, so a row
        // without one cannot be matched by a tagged checkout session either.
        return Promise.resolve(
          args.slices.map((s) => ({
            id: s.id,
            assetId: s.assetId,
            quantity: s.quantity,
            assetKitId: s.assetKitId,
            checkedOutAt: s.checkedOutAt,
            checkedInAt: s.checkedInAt,
            asset: {
              id: s.assetId,
              type: s.asset.type,
              status: AssetStatus.CHECKED_OUT,
            },
          }))
        );
      });
    (db.bookingAsset.findUnique as ReturnType<typeof vitest.fn>)
      .mockReset()
      .mockImplementation((q?: any) =>
        Promise.resolve(args.slices.find((s) => s.id === q?.where?.id) ?? null)
      );
  }

  /** Kit ids the transaction released, flattened across calls. */
  const releasedKitIds = () =>
    (db.kit.updateMany as ReturnType<typeof vitest.fn>).mock.calls.flatMap(
      (call: any[]) => call[0]?.where?.id?.in ?? []
    );

  const params = (overrides: Record<string, unknown>) => ({
    id: "booking-1",
    organizationId: ORG,
    userId: "user-1",
    hints: mockClientHints,
    ...overrides,
  });

  function arrangeBooking(bookingAssets: unknown[]) {
    //@ts-expect-error missing vitest type
    db.booking.findUniqueOrThrow.mockResolvedValue({
      ...mockBookingData,
      status: BookingStatus.ONGOING,
      bookingAssets,
    });
  }

  /** One kit-driven slice of the shared qty-tracked asset. */
  const tapeSlice = (
    id: string,
    kitId: string,
    quantity: number,
    checkedInAt: Date | null = null
  ) => ({
    id,
    assetId: "asset-x",
    quantity,
    assetKitId: `ak-${kitId}`,
    sourceKitId: kitId,
    checkedOutAt: OUT,
    checkedInAt,
    asset: {
      id: "asset-x",
      type: AssetType.QUANTITY_TRACKED,
      assetKits: [{ kitId: "kit-a" }, { kitId: "kit-b" }],
    },
  });

  /**
   * A loose INDIVIDUAL slice on no kit, left outstanding and out of every batch
   * below. Without it a batch covering everything still out takes the "all
   * remaining scanned" early exit into `checkinBooking` and never reaches the
   * progressive gate under test.
   */
  const fillerSlice = {
    id: "ba-filler",
    assetId: "asset-filler",
    quantity: 1,
    assetKitId: null,
    sourceKitId: null,
    checkedOutAt: OUT,
    checkedInAt: null,
    asset: {
      id: "asset-filler",
      type: AssetType.INDIVIDUAL,
      assetKits: [],
    },
  };

  it("releases only the kit whose slice came back", async () => {
    expect.assertions(1);

    // 6 units booked through kit A, 4 through kit B. The claim names kit A's
    // slice and returns its six; kit B's four are still in the field.
    const slices = [
      tapeSlice("ba-kit-a", "kit-a", 6),
      tapeSlice("ba-kit-b", "kit-b", 4),
      fillerSlice,
    ];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 6 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 6 },
        ],
      })
    );

    expect(releasedKitIds()).toEqual(["kit-a"]);
  });

  it("stamps the returned slice and leaves its sibling out", async () => {
    expect.assertions(1);

    const slices = [
      tapeSlice("ba-kit-a", "kit-a", 6),
      tapeSlice("ba-kit-b", "kit-b", 4),
      fillerSlice,
    ];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 6 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 6 },
        ],
      })
    );

    const markerCall = vitest
      .mocked(db.bookingAsset.updateMany)
      .mock.calls.find(([q]) => "checkedInAt" in (q?.data ?? {}))?.[0];

    expect(markerCall?.where).toEqual(
      expect.objectContaining({
        id: { in: ["ba-kit-a"] },
        checkedOutAt: { not: null },
        checkedInAt: null,
      })
    );
  });

  it("releases a kit whose last slice comes back, whatever a shared asset's other kit still owes", async () => {
    expect.assertions(1);

    // Kit A holds the tape's six units (reconciled by an earlier session) and
    // an INDIVIDUAL stand. Kit B holds the tape's other four, still out.
    const slices = [
      tapeSlice("ba-kit-a", "kit-a", 6, BACK),
      tapeSlice("ba-kit-b", "kit-b", 4),
      {
        id: "ba-stand",
        assetId: "asset-stand",
        quantity: 1,
        assetKitId: "ak-kit-a",
        sourceKitId: "kit-a",
        checkedOutAt: OUT,
        checkedInAt: null,
        asset: {
          id: "asset-stand",
          type: AssetType.INDIVIDUAL,
          assetKits: [{ kitId: "kit-a" }],
        },
      },
      fillerSlice,
    ];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });

    await partialCheckinBooking(params({ assetIds: ["asset-stand"] }));

    expect(releasedKitIds()).toEqual(["kit-a"]);
  });

  it("keeps a kit CHECKED_OUT while its slice still owes units", async () => {
    expect.assertions(1);

    // Two of kit A's six units are back; four are still out.
    const slices = [
      tapeSlice("ba-kit-a", "kit-a", 6),
      tapeSlice("ba-kit-b", "kit-b", 4),
      fillerSlice,
    ];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 2 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 2 },
        ],
      })
    );

    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  it("holds a kit back for a slice checked out after this request loaded the booking", async () => {
    expect.assertions(1);

    const slices = [
      tapeSlice("ba-kit-a", "kit-a", 6),
      tapeSlice("ba-kit-b", "kit-b", 4),
      fillerSlice,
    ];
    arrangeBooking(slices);
    // `ba-added-late` is kit A's, checked out by another session while this
    // request ran, so the pre-transaction snapshot cannot see it.
    mockSliceReads({
      slices,
      stillOutNow: [
        {
          id: "ba-added-late",
          assetKitId: "ak-kit-a",
          sourceKitId: "kit-a",
          asset: { assetKits: [{ kitId: "kit-a" }] },
        },
      ],
    });
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 6 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 6 },
        ],
      })
    );

    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  it("still releases a kit whose member was detached mid-booking", async () => {
    expect.assertions(1);

    // Membership is gone, so only the slice's own `sourceKitId` names the kit.
    // The per-slice release gate must still resolve it from that provenance
    // alone: detaching a member mid-booking cannot cost the kit its release.
    const slices = [
      {
        id: "ba-detached",
        assetId: "asset-d",
        quantity: 1,
        assetKitId: null,
        sourceKitId: "kit-z",
        checkedOutAt: OUT,
        checkedInAt: null,
        asset: {
          id: "asset-d",
          type: AssetType.INDIVIDUAL,
          assetKits: [],
        },
      },
      fillerSlice,
    ];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });

    await partialCheckinBooking(params({ assetIds: ["asset-d"] }));

    expect(releasedKitIds()).toEqual(["kit-z"]);
  });

  /**
   * Progressive checkout stamps `checkedOutAt` as soon as ANY unit leaves, so a
   * slice booked at 10 with 3 in the field is an ordinary state, not a broken
   * one. What settles it is those 3 coming back. Measuring against the booked
   * 10 leaves the kit checked out with nothing of it anywhere, and once the
   * booking completes no later check-in can release it.
   */
  it("releases a kit once every unit its slice actually sent out is back", async () => {
    expect.assertions(1);

    const slices = [tapeSlice("ba-kit-a", "kit-a", 10), fillerSlice];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    // Only 3 of the booked 10 ever left.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetIds: ["asset-x"], quantities: [3], bookingAssetIds: ["ba-kit-a"] },
    ]);
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 3 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 3 },
        ],
      })
    );

    expect(releasedKitIds()).toEqual(["kit-a"]);
  });

  it("holds the kit while a unit its slice sent out is still in the field", async () => {
    expect.assertions(1);

    const slices = [tapeSlice("ba-kit-a", "kit-a", 10), fillerSlice];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetIds: ["asset-x"], quantities: [3], bookingAssetIds: ["ba-kit-a"] },
    ]);
    // 3 went out, 2 came back.
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: "ba-kit-a", quantity: 2 },
    ]);

    await partialCheckinBooking(
      params({
        checkins: [
          { assetId: "asset-x", bookingAssetId: "ba-kit-a", returned: 2 },
        ],
      })
    );

    expect(db.kit.updateMany).not.toHaveBeenCalled();
  });

  /**
   * The mobile check-in sends no slice id, so its units are spread across the
   * asset's slices in `compareSlicesForGreedyFill` order — standalone first.
   * A standalone slice that never left must not absorb that return: it owes
   * nothing, and every unit it swallows is one the kit-driven slice needs to
   * settle. Capacity has to be what a slice SENT, the same measure the
   * threshold uses.
   */
  it("does not let a slice that never left absorb an untagged return owed to a kit", async () => {
    expect.assertions(1);

    const looseSlice = {
      id: "ba-loose",
      assetId: "asset-x",
      quantity: 5,
      assetKitId: null,
      sourceKitId: null,
      // Never went out on this booking.
      checkedOutAt: null,
      checkedInAt: null,
      asset: {
        id: "asset-x",
        type: AssetType.QUANTITY_TRACKED,
        assetKits: [{ kitId: "kit-a" }, { kitId: "kit-b" }],
      },
    };
    const slices = [looseSlice, tapeSlice("ba-kit-a", "kit-a", 5), fillerSlice];
    arrangeBooking(slices);
    mockSliceReads({ slices, stillOutNow: [] });
    // All 5 units that left did so on the kit's slice.
    (
      db.partialBookingCheckout.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetIds: ["asset-x"], quantities: [5], bookingAssetIds: ["ba-kit-a"] },
    ]);
    // The mobile payload names no slice.
    (
      db.consumptionLog.findMany as ReturnType<typeof vitest.fn>
    ).mockResolvedValue([
      { assetId: "asset-x", bookingAssetId: null, quantity: 5 },
    ]);

    await partialCheckinBooking(
      params({ checkins: [{ assetId: "asset-x", returned: 5 }] })
    );

    expect(releasedKitIds()).toEqual(["kit-a"]);
  });
});
