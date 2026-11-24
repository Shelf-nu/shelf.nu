/**
 * How the booking writers call the booking sources facade.
 *
 * Every path that adds pool units to a booking, reschedules it or reserves it
 * hands the facade all of its affected slices in one call, inside the
 * transaction that writes the slices, after the booking lock. Only
 * quantity-tracked slices (standalone and kit-driven) reach it: an INDIVIDUAL
 * asset never has source rows.
 *
 * The facade itself (allocation, admission, conversion) is covered by
 * `sources/booking-sources.server.test.ts`; here it is a spy, and the tests
 * pin which writer calls which facade function, with which slices, window and
 * kind, and where in the transaction.
 *
 * @see {@link file://./service.server.ts} the writers
 * @see {@link file://./sources/booking-sources.server.ts} the facade
 */
import {
  AssetStatus,
  AssetType,
  BookingStatus,
  OrganizationRoles,
} from "@prisma/client";
import { allocateSources } from "@shelf/quantity-control";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { accessFor } from "@helpers/role-access";

import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import { db } from "~/database/db.server";
import type * as availabilityModule from "~/modules/asset/availability.server";
import { lockEveryAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { ShelfError } from "~/utils/error";

import {
  addScannedAssetsToBooking,
  checkoutBooking,
  createBooking,
  duplicateBooking,
  reserveBooking,
  revertBookingToDraft,
  updateBasicBooking,
  updateBookingAssets,
} from "./service.server";
import {
  admitWindowChange,
  allocateNewSlices,
  resizeSlices,
} from "./sources/booking-sources.server";

// @vitest-environment node

/** A slice row the fake `bookingAsset.findMany` serves. */
type FakeSlice = {
  id: string;
  assetId: string;
  assetKitId: string | null;
  quantity: number;
};

/**
 * What the fake database holds for one test. Hoisted so the module factories
 * below can read it.
 */
const store = vitest.hoisted(() => ({
  /** Asset type by id; anything absent is INDIVIDUAL. */
  assetTypes: {} as Record<string, string>,
  /** Every slice of the booking under test, pool and INDIVIDUAL alike. */
  slices: [] as Array<{
    id: string;
    assetId: string;
    assetKitId: string | null;
    quantity: number;
  }>,
  /** The status the booking lock reads. */
  lockedStatus: "DRAFT",
}));

/** True when a fake slice matches one `where` clause of a findMany. */
function sliceMatches(
  slice: FakeSlice,
  where: Record<string, unknown> | undefined
): boolean {
  if (!where) return true;
  const assetId = where.assetId as { in?: string[] } | string | undefined;
  if (typeof assetId === "string" && slice.assetId !== assetId) return false;
  if (
    assetId &&
    typeof assetId === "object" &&
    assetId.in &&
    !assetId.in.includes(slice.assetId)
  ) {
    return false;
  }
  if ("assetKitId" in where) {
    const kit = where.assetKitId as { in?: string[] } | null;
    if (kit === null && slice.assetKitId !== null) return false;
    if (kit && kit.in && !kit.in.includes(slice.assetKitId ?? "")) {
      return false;
    }
  }
  const asset = where.asset as { type?: string } | undefined;
  if (asset?.type) {
    const type = store.assetTypes[slice.assetId] ?? AssetType.INDIVIDUAL;
    if (type !== asset.type) return false;
  }
  const or = where.OR as Record<string, unknown>[] | undefined;
  if (or && !or.some((clause) => sliceMatches(slice, clause))) return false;
  return true;
}

// why: the database is the boundary for every writer here. The fake serves
// the few reads each writer makes from `store`, and `$transaction` hands its
// callback a client of its own (see `openTx`), so a facade call made through
// the outer `db` instead of `tx` would be visible.
vitest.mock("~/database/db.server", () => {
  const echoIds = (args: { where?: { id?: { in?: string[] } } }) =>
    (args?.where?.id?.in ?? []).map((id) => ({ id }));
  return {
    db: {
      $transaction: vitest.fn(),
      $executeRaw: vitest.fn().mockResolvedValue(0),
      // why: `lockBookingForStatusCheck` is a raw `SELECT … FOR UPDATE` that
      // returns the status it locked.
      $queryRaw: vitest
        .fn()
        .mockImplementation(() =>
          Promise.resolve([{ status: store.lockedStatus }])
        ),
      booking: {
        findUniqueOrThrow: vitest.fn(),
        findFirstOrThrow: vitest.fn(),
        findFirst: vitest.fn(),
        create: vitest.fn(),
        update: vitest.fn(),
      },
      bookingAsset: {
        // Served by `fakeSliceFindMany`, installed in `beforeEach`.
        findMany: vitest.fn(),
        count: vitest.fn().mockResolvedValue(1),
        findFirst: vitest.fn().mockResolvedValue(null),
        groupBy: vitest.fn().mockResolvedValue([]),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      bookingModelRequest: { count: vitest.fn().mockResolvedValue(1) },
      asset: {
        // why: the org guards compare the row count against the ids asked
        // for, and the writers read `type` to tell pool assets apart. Every
        // asked id exists and none is archived.
        findMany: vitest
          .fn()
          .mockImplementation(
            (args: {
              where?: { id?: { in?: string[] }; archivedAt?: unknown };
            }) =>
              Promise.resolve(
                args?.where?.archivedAt && args.where.archivedAt !== null
                  ? []
                  : (args?.where?.id?.in ?? []).map((id) => ({
                      id,
                      title: id,
                      type: store.assetTypes[id] ?? "INDIVIDUAL",
                      status: "AVAILABLE",
                      unitOfMeasure: null,
                      assetModelId: null,
                      bookingAssets: [],
                    }))
              )
          ),
        count: vitest.fn().mockResolvedValue(0),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      assetKit: {
        findMany: vitest
          .fn()
          .mockImplementation((args: { where?: { id?: { in?: string[] } } }) =>
            Promise.resolve(
              echoIds(args).map((row) => ({
                ...row,
                kitId: "kit-1",
                quantity: 2,
              }))
            )
          ),
      },
      kit: {
        findMany: vitest.fn().mockResolvedValue([]),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      tag: { findMany: vitest.fn().mockResolvedValue([]) },
      teamMember: {
        findFirst: vitest.fn().mockResolvedValue({ id: "team-1" }),
      },
      userOrganization: {
        findFirst: vitest.fn().mockResolvedValue({ id: "user-org-1" }),
      },
      partialBookingCheckout: {
        create: vitest.fn().mockResolvedValue({}),
        findMany: vitest.fn().mockResolvedValue([]),
      },
      bookingSettings: { findUnique: vitest.fn().mockResolvedValue(null) },
    },
  };
});

// why: the facade is the collaborator under observation; its own suite covers
// what it does with the slices.
vitest.mock("~/modules/booking/sources/booking-sources.server", () => ({
  allocateNewSlices: vitest.fn().mockResolvedValue(undefined),
  resizeSlices: vitest.fn().mockResolvedValue(undefined),
  admitWindowChange: vitest.fn().mockResolvedValue(undefined),
  // Every picked slice is reported LEGACY: the LEGACY source path runs as it
  // did before dispatch existed.
  dispatchUnits: vitest
    .fn()
    .mockImplementation(
      (_tx: unknown, args: { picks: { sliceId: string }[] }) =>
        Promise.resolve({
          dispatched: [],
          legacySliceIds: args.picks.map((pick) => pick.sliceId),
        })
    ),
}));

// why: the archive lock is a raw `SELECT … FOR UPDATE` a fake client cannot
// run; the archived guard itself still runs.
vitest.mock("~/modules/asset/archive-lock.server", () => ({
  lockAssetsForArchiveGuard: vitest.fn().mockResolvedValue(undefined),
}));

// why: the legacy pool locks are raw SQL too; their placement has its own tests.
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn().mockResolvedValue({ id: "a" }),
  lockEveryAssetForQuantityUpdate: vitest.fn().mockResolvedValue(undefined),
  lockAssetsForQuantityUpdate: vitest.fn().mockResolvedValue([]),
}));

// why: the legacy pool-wide guard reads availability through queries this fake
// does not serve; it is covered in `asset/availability.server.test.ts`. The
// status constants stay real.
vitest.mock("~/modules/asset/availability.server", async (importOriginal) => ({
  ...(await importOriginal<typeof availabilityModule>()),
  assertAssetQuantitiesAvailable: vitest.fn().mockResolvedValue(undefined),
}));

// why: the model reservation guards and fulfilment have their own suite; here
// everything fits and nothing is fulfilled.
vitest.mock("~/modules/booking-model-request/service.server", () => ({
  assertOutstandingModelRequestsFit: vitest.fn().mockResolvedValue(undefined),
  assertModelUnitsNotReservedElsewhere: vitest
    .fn()
    .mockResolvedValue(undefined),
  assertReservationBatchWithinLimit: vitest.fn(),
  claimUnstampedBookingRows: vitest.fn().mockResolvedValue(new Map()),
  fulfilModelRequestsForAssets: vitest.fn().mockResolvedValue(new Map()),
  lockModelsForOutstandingRequests: vitest.fn().mockResolvedValue(undefined),
  loadActorBestEffort: vitest.fn().mockResolvedValue(null),
  reserveModelsUpToAvailability: vitest.fn().mockResolvedValue([]),
  writeBookingModelRequestInTx: vitest.fn(),
  RESERVATION_BATCH_TX_TIMEOUT_MS: 15_000,
}));

// why: the kit-membership scan guard and the kit conflict read have their own
// suites; no fixture here is a loose kit member or a booked kit.
vitest.mock("./kit-member-scan-guard.server", () => ({
  assertScannedUnitsAreNotKitMembers: vitest.fn().mockResolvedValue(undefined),
}));
vitest.mock("./kit-conflicts.server", () => ({
  findConflictingKits: vitest.fn().mockResolvedValue([]),
}));

// why: notes, events, recipients, mail and jobs each have their own suites.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createSystemBookingNotes: vitest.fn().mockResolvedValue({}),
}));
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue({}),
}));
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Test",
    lastName: "User",
    displayName: null,
  }),
}));
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn().mockResolvedValue([]),
}));
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn().mockResolvedValue(undefined),
}));
vitest.mock("~/utils/scheduler.server", () => ({
  scheduler: {
    cancel: vitest.fn().mockResolvedValue(undefined),
    schedule: vitest.fn().mockResolvedValue(undefined),
    sendAfter: vitest.fn().mockResolvedValue(undefined),
  },
  QueueNames: {
    BOOKING_UPDATES: "booking-updates",
    bookingQueue: "booking-queue",
  },
}));
vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

const ORG_ID = "org-1";
const BOOKING_ID = "booking-1";
const hints = { timeZone: "UTC", locale: "en-US" } as never;
const admin = accessFor([OrganizationRoles.ADMIN]);

/** A window comfortably in the future, so no reminder fires inline. */
const from = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const to = new Date(from.getTime() + 8 * 60 * 60 * 1000);

/**
 * Hands every `$transaction` callback a client of its own, built on the same
 * spies (so call order is comparable) but a distinct object (so a facade
 * call made with the outer `db` fails the `tx` assertion).
 */
function openTx() {
  const tx = { ...db, booking: { ...db.booking } };
  vitest
    .mocked(db.$transaction)
    .mockImplementation(((callbackOrArray: unknown) =>
      typeof callbackOrArray === "function"
        ? (callbackOrArray as (client: unknown) => unknown)(tx)
        : Promise.all(callbackOrArray as Promise<unknown>[])) as never);
  return tx;
}

/** Call order of a mock's first invocation, for before/after assertions. */
function firstCallOrder(mock: unknown) {
  return (mock as ReturnType<typeof vitest.fn>).mock.invocationCallOrder[0];
}

/** Call order of the booking lock: the first raw query of the test. */
function bookingLockOrder() {
  return firstCallOrder(db.$queryRaw);
}

/** The `where` of the pool-slice read, the one filtering on asset type. */
function poolSliceReads() {
  return vitest
    .mocked(db.bookingAsset.findMany)
    .mock.calls.map(([args]) => args as { where?: Record<string, unknown> })
    .filter((args) => (args?.where?.asset as { type?: string })?.type);
}

/**
 * The fake `bookingAsset.findMany`: the booking's slices matching the `where`
 * on asset ids, kit memberships, asset type and `OR`. A read filtering on
 * anything else (check-out departures, for one) finds nothing, as on a booking
 * that has sent nothing out.
 */
function fakeSliceFindMany(args: { where?: Record<string, unknown> }) {
  const where = args?.where ?? {};
  const known = [
    "bookingId",
    "booking",
    "assetId",
    "assetKitId",
    "asset",
    "OR",
  ];
  if (Object.keys(where).some((key) => !known.includes(key))) {
    return Promise.resolve([]);
  }
  const or = where.OR as Record<string, unknown>[] | undefined;
  if (
    or?.some((clause) =>
      Object.keys(clause).some((key) => !known.includes(key))
    )
  ) {
    return Promise.resolve([]);
  }
  return Promise.resolve(
    store.slices
      .filter((slice) => sliceMatches(slice, where))
      .map((slice) => ({
        ...slice,
        asset: { id: slice.assetId, title: slice.assetId },
      }))
  );
}

beforeEach(() => {
  vitest.clearAllMocks();
  store.assetTypes = {};
  store.slices = [];
  store.lockedStatus = BookingStatus.DRAFT;
  // `clearAllMocks` keeps implementations, so the spies a case reprograms are
  // reset to their defaults here.
  vitest
    .mocked(db.bookingAsset.findMany)
    .mockImplementation(fakeSliceFindMany as never);
  vitest
    .mocked(db.$executeRaw)
    .mockReset()
    .mockResolvedValue(0 as never);
  for (const spy of Object.values(db.booking)) {
    vitest.mocked(spy as ReturnType<typeof vitest.fn>).mockReset();
  }
  vitest.mocked(admitWindowChange).mockResolvedValue(undefined);
  vitest.mocked(allocateNewSlices).mockResolvedValue(undefined);
  vitest.mocked(resizeSlices).mockResolvedValue(undefined);
});

describe("createBooking", () => {
  const params = {
    booking: {
      name: "New",
      description: null,
      creatorId: "user-1",
      custodianUserId: null,
      custodianTeamMemberId: "team-1",
      organizationId: ORG_ID,
      from,
      to,
      tags: [],
    },
    hints,
  };

  it("allocates every pool slice of the new draft in one call, without holding", async () => {
    store.assetTypes = {
      "qt-1": "QUANTITY_TRACKED",
      "qt-2": "QUANTITY_TRACKED",
    };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 1 },
      { id: "ba-qt-2", assetId: "qt-2", assetKitId: "ak-1", quantity: 2 },
      { id: "ba-ind-1", assetId: "ind-1", assetKitId: null, quantity: 1 },
    ];
    const tx = openTx();
    vitest
      .mocked(tx.booking.create)
      .mockResolvedValue({ id: BOOKING_ID, from, to } as never);

    await createBooking({
      ...params,
      assetIds: ["qt-1", "ind-1"],
      kitSlices: [
        { assetId: "qt-2", assetKitId: "ak-1", kitId: "kit-1", quantity: 2 },
      ],
    });

    expect(allocateNewSlices).toHaveBeenCalledTimes(1);
    expect(allocateNewSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      // The standalone and the kit slice of the pools; never the INDIVIDUAL one.
      sliceIds: ["ba-qt-1", "ba-qt-2"],
      window: { from, to },
      holdsNow: false,
    });
    expect(firstCallOrder(tx.booking.create)).toBeLessThan(
      firstCallOrder(allocateNewSlices)
    );
  });

  it("never calls the facade for a booking of INDIVIDUAL assets only", async () => {
    store.slices = [
      { id: "ba-ind-1", assetId: "ind-1", assetKitId: null, quantity: 1 },
    ];
    const tx = openTx();
    vitest
      .mocked(tx.booking.create)
      .mockResolvedValue({ id: BOOKING_ID, from, to } as never);

    await createBooking({ ...params, assetIds: ["ind-1"] });

    expect(allocateNewSlices).not.toHaveBeenCalled();
  });
});

describe("updateBasicBooking", () => {
  const oldFrom = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const oldTo = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  function stageBooking(status: BookingStatus) {
    vitest.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
      id: BOOKING_ID,
      status,
      name: "Booking",
      description: null,
      from: oldFrom,
      to: oldTo,
      custodianUserId: null,
      custodianTeamMemberId: "team-1",
      custodianTeamMember: { id: "team-1", name: "Team", user: null },
      custodianUser: null,
      tags: [],
    } as never);
  }

  const params = {
    id: BOOKING_ID,
    organizationId: ORG_ID,
    name: "Booking",
    custodianTeamMemberId: "team-1",
    tags: [],
  };

  it("re-allocates a draft's pools for its new dates, in the date write's transaction, after the booking lock", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 3 },
    ];
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID, from, to } as never);

    await updateBasicBooking({ ...params, from, to });

    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
      previous: { from: oldFrom, to: oldTo },
      kind: "dates",
    });
    expect(bookingLockOrder()).toBeLessThan(firstCallOrder(admitWindowChange));
  });

  it("touches no sources when the dates do not change", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 3 },
    ];
    openTx();
    vitest
      .mocked(db.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await updateBasicBooking({ ...params, from: oldFrom, to: oldTo });

    expect(admitWindowChange).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses new dates when the booking stopped being a draft before the lock", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.lockedStatus = BookingStatus.RESERVED;
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 3 },
    ];
    const tx = openTx();

    await expect(
      updateBasicBooking({ ...params, from, to })
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(admitWindowChange).not.toHaveBeenCalled();
  });

  it("does not call the facade for a draft with no pool slices", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.slices = [
      { id: "ba-ind-1", assetId: "ind-1", assetKitId: null, quantity: 1 },
    ];
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID, from, to } as never);

    await updateBasicBooking({ ...params, from, to });

    expect(admitWindowChange).not.toHaveBeenCalled();
  });
});

/** One slice in the shape `reserveBooking` and `checkoutBooking` load. */
function loadedSlice(assetId: string, type: AssetType) {
  return {
    id: `ba-${assetId}`,
    assetId,
    quantity: 2,
    assetKitId: null,
    sourceKitId: null,
    checkedOutAt: null,
    checkedInAt: null,
    asset: {
      id: assetId,
      title: assetId,
      type,
      status: AssetStatus.AVAILABLE,
      availableToBook: true,
      unitOfMeasure: null,
      assetModelId: null,
      bookingAssets: [],
      assetKits: [],
    },
  };
}

/** The booking as the outer reads return it. */
function bookingRow(
  status: BookingStatus,
  slices: ReturnType<typeof loadedSlice>[]
) {
  return {
    id: BOOKING_ID,
    name: "Booking",
    description: null,
    status,
    organizationId: ORG_ID,
    creatorId: "user-1",
    custodianUserId: "user-1",
    custodianTeamMemberId: "team-1",
    custodianUser: null,
    custodianTeamMember: { name: "Team Member" },
    from,
    to,
    activeSchedulerReference: null,
    bookingAssets: slices,
    modelRequests: [],
    notificationRecipients: [],
    tags: [],
    organization: { customEmailFooter: null },
    _count: { bookingAssets: slices.length },
  };
}

describe("reserveBooking", () => {
  const params = {
    id: BOOKING_ID,
    name: "Booking",
    organizationId: ORG_ID,
    custodianUserId: "user-1",
    custodianTeamMemberId: "team-1",
    from,
    to,
    description: "",
    hints,
    alertsOrgOnReservation: false,
    tags: [],
  };
  const reservedRow = {
    id: BOOKING_ID,
    status: BookingStatus.RESERVED,
    from,
    to,
    custodianUserId: "user-1",
  };

  /** The slices the in-transaction read finds, after the booking lock. */
  function stageSlices(...ids: Array<"qt-1" | "qt-kit" | "ind-1">) {
    store.assetTypes = {
      "qt-1": "QUANTITY_TRACKED",
      "qt-kit": "QUANTITY_TRACKED",
    };
    store.slices = ids.map((assetId) => ({
      id: `ba-${assetId}`,
      assetId,
      assetKitId: assetId === "qt-kit" ? "ak-1" : null,
      quantity: 2,
    }));
  }

  it("admits every pool slice over the reserved window, after the booking lock and before the status flip", async () => {
    vitest
      .mocked(db.booking.findUniqueOrThrow)
      .mockResolvedValue(
        bookingRow(BookingStatus.DRAFT, [
          loadedSlice("qt-1", AssetType.QUANTITY_TRACKED),
          loadedSlice("ind-1", AssetType.INDIVIDUAL),
        ]) as never
      );
    stageSlices("qt-1", "qt-kit", "ind-1");
    const tx = openTx();
    vitest.mocked(tx.booking.update).mockResolvedValue(reservedRow as never);

    await reserveBooking(params);

    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
      previous: { from, to },
      kind: "reserve",
    });
    expect(bookingLockOrder()).toBeLessThan(firstCallOrder(admitWindowChange));
    expect(firstCallOrder(admitWindowChange)).toBeLessThan(
      firstCallOrder(tx.booking.update)
    );
    // Standalone and kit pool assets are locked in the one sorted statement
    // before the facade, so its own lock only re-takes rows already held.
    expect(lockEveryAssetForQuantityUpdate).toHaveBeenCalledTimes(1);
    expect(lockEveryAssetForQuantityUpdate).toHaveBeenCalledWith(
      tx,
      ["qt-1", "qt-kit"],
      ORG_ID
    );
    expect(firstCallOrder(lockEveryAssetForQuantityUpdate)).toBeLessThan(
      firstCallOrder(admitWindowChange)
    );
  });

  it("decides from the slices read under the lock, not from the earlier read", async () => {
    // The outer read saw only an INDIVIDUAL asset; a pool slice joined before
    // the lock was taken.
    vitest
      .mocked(db.booking.findUniqueOrThrow)
      .mockResolvedValue(
        bookingRow(BookingStatus.DRAFT, [
          loadedSlice("ind-1", AssetType.INDIVIDUAL),
        ]) as never
      );
    stageSlices("ind-1", "qt-1");
    const tx = openTx();
    vitest.mocked(tx.booking.update).mockResolvedValue(reservedRow as never);

    await reserveBooking(params);

    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(bookingLockOrder()).toBeLessThan(
      firstCallOrder(db.bookingAsset.findMany)
    );
  });

  it("refuses with the facade's reason and leaves the booking a draft when a MANUAL slice does not fit", async () => {
    vitest
      .mocked(db.booking.findUniqueOrThrow)
      .mockResolvedValue(
        bookingRow(BookingStatus.DRAFT, [
          loadedSlice("qt-1", AssetType.QUANTITY_TRACKED),
        ]) as never
      );
    stageSlices("qt-1");
    const tx = openTx();
    vitest.mocked(tx.booking.update).mockResolvedValue(reservedRow as never);
    vitest.mocked(admitWindowChange).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
        message: "Short at Demo Warehouse: 3 free.",
      })
    );

    await expect(reserveBooking(params)).rejects.toMatchObject({
      message: "Short at Demo Warehouse: 3 free.",
      status: 400,
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it("does not call the facade for a booking of INDIVIDUAL assets only", async () => {
    vitest
      .mocked(db.booking.findUniqueOrThrow)
      .mockResolvedValue(
        bookingRow(BookingStatus.DRAFT, [
          loadedSlice("ind-1", AssetType.INDIVIDUAL),
        ]) as never
      );
    stageSlices("ind-1");
    const tx = openTx();
    vitest.mocked(tx.booking.update).mockResolvedValue(reservedRow as never);

    await reserveBooking(params);

    expect(admitWindowChange).not.toHaveBeenCalled();
  });
});

describe("checkoutBooking source admission", () => {
  /** A pool slice the in-transaction read finds. */
  function stagePool() {
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 2 },
    ];
  }

  /**
   * The outer read. Its slice is INDIVIDUAL so the legacy pool guard stays
   * out of the way; the pool slice is read in the transaction (`stagePool`).
   */
  function stageBooking(
    status: BookingStatus,
    window: { from: Date; to: Date } = { from, to }
  ) {
    store.lockedStatus = status;
    vitest.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
      ...bookingRow(status, [loadedSlice("ind-1", AssetType.INDIVIDUAL)]),
      ...window,
    } as never);
  }

  /** The window the check-out wrote onto the booking row. */
  function writtenWindow(stored: { from: Date; to: Date }) {
    const write = vitest
      .mocked(db.booking.update)
      .mock.calls.map(([args]) => args as { data?: Record<string, unknown> })
      .find((args) => args?.data?.status);
    return {
      from: (write?.data?.from as Date | undefined) ?? stored.from,
      to: (write?.data?.to as Date | undefined) ?? stored.to,
    };
  }

  const checkout = (
    extra: Partial<Parameters<typeof checkoutBooking>[0]> = {}
  ) =>
    checkoutBooking({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      hints,
      from,
      to,
      userId: "user-1",
      ...extra,
    });

  it("admits a draft's pool slices as a reservation over its window, after the locks", async () => {
    stageBooking(BookingStatus.DRAFT);
    stagePool();
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await checkout();

    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from,
      to,
      previous: { from, to },
      kind: "reserve",
    });
    expect(bookingLockOrder()).toBeLessThan(firstCallOrder(admitWindowChange));
    expect(lockEveryAssetForQuantityUpdate).toHaveBeenCalledWith(
      tx,
      ["qt-1"],
      ORG_ID
    );
    expect(firstCallOrder(lockEveryAssetForQuantityUpdate)).toBeLessThan(
      firstCallOrder(admitWindowChange)
    );
  });

  it("admits a draft's early check-out over the window it writes", async () => {
    stageBooking(BookingStatus.DRAFT);
    stagePool();
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await checkout({ intentChoice: CheckoutIntentEnum["with-adjusted-date"] });

    const written = writtenWindow({ from, to });
    expect(written.from.getTime()).toBeLessThan(from.getTime());
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from: written.from,
      to,
      previous: { from, to },
      kind: "reserve",
    });
  });

  it("admits a reservation's early check-out as a date change from its stored window", async () => {
    stageBooking(BookingStatus.RESERVED);
    stagePool();
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await checkout({ intentChoice: CheckoutIntentEnum["with-adjusted-date"] });

    const written = writtenWindow({ from, to });
    expect(written.from.getTime()).toBeLessThan(from.getTime());
    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from: written.from,
      to,
      previous: { from, to },
      kind: "dates",
    });
  });

  it("admits a rescheduled expired reservation as a date change to its new window", async () => {
    const pastFrom = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const pastTo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const newEndDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    stageBooking(BookingStatus.RESERVED, { from: pastFrom, to: pastTo });
    stagePool();
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await checkout({
      from: pastFrom,
      to: pastTo,
      intentChoice: CheckoutIntentEnum["with-new-end-date"],
      newEndDate,
    });

    const written = writtenWindow({ from: pastFrom, to: pastTo });
    expect(written.to).toEqual(newEndDate);
    expect(admitWindowChange).toHaveBeenCalledTimes(1);
    expect(admitWindowChange).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      from: written.from,
      to: newEndDate,
      previous: { from: pastFrom, to: pastTo },
      kind: "dates",
    });
  });

  it("admits nothing when a reservation checks out on its own window", async () => {
    stageBooking(BookingStatus.RESERVED);
    stagePool();
    const tx = openTx();
    vitest
      .mocked(tx.booking.update)
      .mockResolvedValue({ id: BOOKING_ID } as never);

    await checkout();

    expect(admitWindowChange).not.toHaveBeenCalled();
  });
});

describe("updateBookingAssets", () => {
  /** The booking as the in-transaction read returns it. */
  function stageBooking(status: BookingStatus) {
    store.lockedStatus = status;
    vitest.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
      id: BOOKING_ID,
      name: "Booking",
      status,
      from,
      to,
    } as never);
  }

  it("resizes existing pool slices before the upsert and allocates new pool slices after it, one call each", async () => {
    stageBooking(BookingStatus.RESERVED);
    store.assetTypes = {
      "qt-old": "QUANTITY_TRACKED",
      "qt-new": "QUANTITY_TRACKED",
      "qt-kit": "QUANTITY_TRACKED",
    };
    store.slices = [
      { id: "ba-qt-old", assetId: "qt-old", assetKitId: null, quantity: 2 },
    ];
    const tx = openTx();
    // The inserts land the new rows; the next read sees them.
    vitest.mocked(tx.$executeRaw).mockImplementation((() => {
      if (!store.slices.some((s) => s.id === "ba-qt-new")) {
        store.slices.push(
          { id: "ba-qt-new", assetId: "qt-new", assetKitId: null, quantity: 4 },
          {
            id: "ba-qt-kit",
            assetId: "qt-kit",
            assetKitId: "ak-1",
            quantity: 2,
          },
          { id: "ba-ind", assetId: "ind-1", assetKitId: null, quantity: 1 }
        );
      }
      return Promise.resolve(1);
    }) as never);

    await updateBookingAssets({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      assetIds: ["qt-old", "qt-new", "ind-1"],
      quantities: { "qt-old": 5, "qt-new": 4 },
      kitSlices: [
        { assetId: "qt-kit", assetKitId: "ak-1", kitId: "kit-1", quantity: 2 },
      ],
      userId: "user-1",
      access: admin,
      skipBookingNote: true,
    });

    expect(resizeSlices).toHaveBeenCalledTimes(1);
    expect(resizeSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      changes: [{ sliceId: "ba-qt-old", quantity: 5 }],
      window: { from, to },
    });
    expect(allocateNewSlices).toHaveBeenCalledTimes(1);
    expect(allocateNewSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      sliceIds: ["ba-qt-new", "ba-qt-kit"],
      window: { from, to },
      holdsNow: true,
    });
    // The facade reads the stored quantity as the pre-change value.
    expect(firstCallOrder(resizeSlices)).toBeLessThan(
      firstCallOrder(tx.$executeRaw)
    );
    expect(firstCallOrder(tx.$executeRaw)).toBeLessThan(
      firstCallOrder(allocateNewSlices)
    );
    expect(bookingLockOrder()).toBeLessThan(firstCallOrder(resizeSlices));
  });

  it("allocates a draft's new pool slices without holding", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.assetTypes = { "qt-new": "QUANTITY_TRACKED" };
    const tx = openTx();
    vitest.mocked(tx.$executeRaw).mockImplementation((() => {
      if (store.slices.length === 0) {
        store.slices.push({
          id: "ba-qt-new",
          assetId: "qt-new",
          assetKitId: null,
          quantity: 1,
        });
      }
      return Promise.resolve(1);
    }) as never);

    await updateBookingAssets({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      assetIds: ["qt-new"],
      access: admin,
      skipBookingNote: true,
    });

    expect(resizeSlices).not.toHaveBeenCalled();
    expect(allocateNewSlices).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ sliceIds: ["ba-qt-new"], holdsNow: false })
    );
  });

  it("never hands the facade INDIVIDUAL slices", async () => {
    stageBooking(BookingStatus.RESERVED);
    openTx();

    await updateBookingAssets({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      assetIds: ["ind-1", "ind-2"],
      access: admin,
      skipBookingNote: true,
    });

    expect(resizeSlices).not.toHaveBeenCalled();
    expect(allocateNewSlices).not.toHaveBeenCalled();
  });

  it("propagates a facade refusal as the user's error", async () => {
    stageBooking(BookingStatus.RESERVED);
    store.assetTypes = { "qt-old": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-old", assetId: "qt-old", assetKitId: null, quantity: 2 },
    ];
    const tx = openTx();
    vitest.mocked(resizeSlices).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
        message: "Short at Demo Warehouse: 1 free.",
      })
    );

    await expect(
      updateBookingAssets({
        id: BOOKING_ID,
        organizationId: ORG_ID,
        assetIds: ["qt-old"],
        quantities: { "qt-old": 9 },
        access: admin,
        skipBookingNote: true,
      })
    ).rejects.toMatchObject({
      message: "Short at Demo Warehouse: 1 free.",
      status: 400,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("addScannedAssetsToBooking", () => {
  /** The booking the scan targets, as the in-transaction read returns it. */
  function stageBooking(status: BookingStatus) {
    store.lockedStatus = status;
    vitest
      .mocked(db.booking.findFirst)
      .mockResolvedValue({ from, to } as never);
  }

  /** The nested create lands the new rows, as the database would. */
  function landCreatedRows(tx: ReturnType<typeof openTx>) {
    vitest.mocked(tx.booking.update).mockImplementation(((args: {
      data: {
        bookingAssets: {
          create: Array<{
            assetId: string;
            assetKitId: string | null;
            quantity: number;
          }>;
        };
      };
    }) => {
      for (const row of args.data.bookingAssets.create) {
        store.slices.push({
          id: `ba-${row.assetId}-${row.assetKitId ?? "loose"}`,
          assetId: row.assetId,
          assetKitId: row.assetKitId,
          quantity: row.quantity,
        });
      }
      return Promise.resolve({
        id: BOOKING_ID,
        name: "Booking",
        status: store.lockedStatus,
      });
    }) as never);
  }

  it("allocates every pool slice the scan created in one call, after the booking lock", async () => {
    stageBooking(BookingStatus.RESERVED);
    store.assetTypes = {
      "qt-1": "QUANTITY_TRACKED",
      "qt-kit": "QUANTITY_TRACKED",
    };
    const tx = openTx();
    landCreatedRows(tx);

    await addScannedAssetsToBooking({
      assetIds: ["qt-1", "ind-1"],
      kitSlices: [{ assetId: "qt-kit", assetKitId: "ak-1", kitId: "kit-1" }],
      bookingId: BOOKING_ID,
      organizationId: ORG_ID,
      userId: "user-1",
      quantities: { "qt-1": 3 },
      access: admin,
    });

    expect(allocateNewSlices).toHaveBeenCalledTimes(1);
    expect(allocateNewSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      sliceIds: ["ba-qt-1-loose", "ba-qt-kit-ak-1"],
      window: { from, to },
      holdsNow: true,
    });
    expect(bookingLockOrder()).toBeLessThan(firstCallOrder(allocateNewSlices));
    expect(firstCallOrder(tx.booking.update)).toBeLessThan(
      firstCallOrder(allocateNewSlices)
    );
  });

  it("allocates nothing for a rescan of a unit already on the booking", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    store.slices = [
      { id: "ba-qt-1", assetId: "qt-1", assetKitId: null, quantity: 3 },
    ];
    const tx = openTx();
    landCreatedRows(tx);

    await addScannedAssetsToBooking({
      assetIds: ["qt-1"],
      bookingId: BOOKING_ID,
      organizationId: ORG_ID,
      userId: "user-1",
      access: admin,
    });

    expect(allocateNewSlices).not.toHaveBeenCalled();
  });

  it("allocates a pool with no placements silently: no source choice is asked or returned", async () => {
    stageBooking(BookingStatus.DRAFT);
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    const tx = openTx();
    landCreatedRows(tx);

    const result = await addScannedAssetsToBooking({
      assetIds: ["qt-1"],
      bookingId: BOOKING_ID,
      organizationId: ORG_ID,
      userId: "user-1",
      access: admin,
    });

    // The writer passes no source choice: the facade allocates by the rule.
    expect(allocateNewSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: BOOKING_ID,
      sliceIds: ["ba-qt-1-loose"],
      window: { from, to },
      holdsNow: false,
    });
    // And the scan result carries no question for the operator to answer.
    expect(Object.keys(result).sort()).toEqual([
      "addedAssetIds",
      "archivedKitMembersLeftOut",
      "booking",
      "claimedAssetIds",
    ]);
  });
});

describe("allocation rule for a pool with no placements", () => {
  it("puts every unit on Unplaced", () => {
    expect(
      allocateSources({
        quantity: 7,
        sources: [
          { kind: "UNPLACED", locationId: null, free: 10, createdOrder: 0 },
        ],
      })
    ).toEqual({
      ok: true,
      parts: [{ kind: "UNPLACED", locationId: null, quantity: 7 }],
    });
  });
});

describe("duplicateBooking", () => {
  it("gives the copy a fresh allocation of its pool slices and copies no source rows", async () => {
    vitest
      .mocked(db.booking.findFirstOrThrow)
      .mockResolvedValue(
        bookingRow(BookingStatus.COMPLETE, [
          loadedSlice("qt-1", AssetType.QUANTITY_TRACKED),
          loadedSlice("ind-1", AssetType.INDIVIDUAL),
        ]) as never
      );
    store.assetTypes = { "qt-1": "QUANTITY_TRACKED" };
    const tx = openTx();
    vitest.mocked(tx.booking.create).mockImplementation(((args: {
      data: { bookingAssets: { create: Array<{ assetId: string }> } };
    }) => {
      store.slices = args.data.bookingAssets.create.map((row) => ({
        id: `copy-${row.assetId}`,
        assetId: row.assetId,
        assetKitId: null,
        quantity: 2,
      }));
      return Promise.resolve({ id: "booking-copy", from, to });
    }) as never);

    await duplicateBooking({
      bookingId: BOOKING_ID,
      organizationId: ORG_ID,
      userId: "user-1",
      from,
      to,
      request: new Request("https://example.com"),
      access: admin,
    });

    expect(allocateNewSlices).toHaveBeenCalledTimes(1);
    expect(allocateNewSlices).toHaveBeenCalledWith(tx, {
      organizationId: ORG_ID,
      bookingId: "booking-copy",
      sliceIds: ["copy-qt-1"],
      window: { from, to },
      holdsNow: false,
    });
    // The copy's slices carry booking data only: no source rows ride along.
    const [createArgs] = vitest.mocked(tx.booking.create).mock
      .calls[0] as unknown as [
      { data: { bookingAssets: { create: Record<string, unknown>[] } } },
    ];
    for (const row of createArgs.data.bookingAssets.create) {
      expect(Object.keys(row).sort()).toEqual([
        "assetId",
        "assetKitId",
        "quantity",
        "sourceKitId",
      ]);
    }
    expect(poolSliceReads()).toHaveLength(1);
  });
});

describe("revertBookingToDraft", () => {
  it("writes no sources: a draft holds nothing and its rows stay", async () => {
    vitest.mocked(db.booking.findUniqueOrThrow).mockResolvedValue({
      id: BOOKING_ID,
      status: BookingStatus.RESERVED,
    } as never);
    vitest
      .mocked(db.booking.update)
      .mockResolvedValue(bookingRow(BookingStatus.DRAFT, []) as never);

    await revertBookingToDraft({
      id: BOOKING_ID,
      organizationId: ORG_ID,
      userId: "user-1",
      hints,
    });

    expect(allocateNewSlices).not.toHaveBeenCalled();
    expect(resizeSlices).not.toHaveBeenCalled();
    expect(admitWindowChange).not.toHaveBeenCalled();
  });
});
