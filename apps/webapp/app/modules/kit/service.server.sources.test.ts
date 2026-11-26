/**
 * How the kit service keeps booking source rows right.
 *
 * Kit quantity propagation and its guards touch active bookings only (DRAFT,
 * RESERVED, ONGOING, OVERDUE); finished slices are frozen. Converted kit
 * slices are guarded and resized through their KIT row, LEGACY slices keep
 * the check-in floor guard. Every detach path hands its kit slices to the
 * sources module before they are merged or lose their kit, and converted
 * slices are deleted under their pool's asset lock.
 *
 * The sources module itself is covered by
 * `booking/sources/kit-sources.server.test.ts`; here it is a spy, and the
 * tests pin which kit path calls it, with which slices, and in what order.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://../booking/sources/kit-sources.server.ts}
 */
import { AssetType, BookingStatus } from "@prisma/client";

import { db } from "~/database/db.server";
import type * as AssetUtilsModule from "~/modules/asset/utils.server";
import type * as KitSourcesModule from "~/modules/booking/sources/kit-sources.server";

import {
  deleteKit,
  mergeStandaloneCollisionsForKitDetachment,
  moveAssetKitUnits,
  removeDestroyedUnitsFromKits,
  removeKitSlicesFromPlanningBookings,
  updateKitAssets,
} from "./service.server";
import { lockAssetsForArchiveGuard } from "../asset/archive-lock.server";
import {
  detachKitSliceSources,
  lockKitDetachPools,
  probeKitDetachPools,
  resizeKitSourceRows,
} from "../booking/sources/kit-sources.server";
import { lockAssetForQuantityUpdate } from "../consumption-log/quantity-lock.server";

// @vitest-environment node

// Mock dependencies
// why: testing kit service logic without executing actual database operations
// why: lockAssetsForArchiveGuard runs a raw SELECT ... FOR UPDATE that a
// mocked tx cannot execute. Stub the lock itself, NOT the archived guard:
// the guard's own behaviour runs for real. The calls record the lock set.
vitest.mock("~/modules/asset/archive-lock.server", () => ({
  lockAssetsForArchiveGuard: vitest.fn(),
}));

vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    // why: `updateKitAssets` locks each live booking row via
    // `lockBookingForStatusCheck` before trusting the status it read outside
    // the transaction. Answers "still ONGOING" by default so the existing
    // cases keep their arranged booking state; a test overrides it to model a
    // check-in that committed first.
    $queryRaw: vitest.fn().mockResolvedValue([{ status: "ONGOING" }]),
    kit: {
      create: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      findFirstOrThrow: vitest.fn().mockResolvedValue({}),
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      findUnique: vitest.fn().mockResolvedValue(null),
      findUniqueOrThrow: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      count: vitest.fn().mockResolvedValue(0),
    },
    asset: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
      update: vitest.fn().mockResolvedValue({}),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: updateKitAssets runs assertAssetsAreNotArchived, which counts
      // archived assets. Default 0 = none archived.
      count: vitest.fn().mockResolvedValue(0),
    },
    assetKit: {
      create: vitest.fn().mockResolvedValue({}),
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      update: vitest.fn().mockResolvedValue({}),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      // why: `moveAssetKitUnits` reads the source AssetKit
      // row via `findFirst({ assetId, kitId })`, deletes-on-zero or
      // updates the source, and upserts the destination on the
      // `assetId_kitId` partial unique. Defaults to null/no-op so tests
      // opt in to the allocation state they need.
      findFirst: vitest.fn().mockResolvedValue(null),
      delete: vitest.fn().mockResolvedValue({}),
      upsert: vitest.fn().mockResolvedValue({}),
      // why: `removeDestroyedUnitsFromKits` sums each asset's kit units before
      // writing, to stay clear of the kit-sum trigger. Defaults to no rows.
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    // Location mutations go through this delegate instead of asset.updateMany,
    // since placement lives on the AssetLocation pivot. Includes
    // `updateMany` for kit-driven qty sync; the cascade also calls
    // `findMany` to re-read the just-inserted AssetKit ids before
    // creating the kit-driven AssetLocation rows.
    assetLocation: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: the detach guard (`preserveKitDrivenPlacements`) converts each
      // INDIVIDUAL member's kit-driven row to a manual placement, or drops it
      // when one already exists, one row at a time with single-row
      // `update` / `delete`.
      update: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
      // why: `removeDestroyedUnitsFromKits` sums the hand-placed units of an
      // asset whose kit has a location, to stay clear of the location-sum
      // trigger. Defaults to no rows.
      groupBy: vitest.fn().mockResolvedValue([]),
    },
    // why: the location activity log lines for moved members are written in
    // one batch; the rows handed over are asserted by the cascade tests.
    locationNote: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: createKit/updateKit run a cross-org ownership guard that calls
    // db.location.findFirst before connecting a location.
    location: {
      update: vitest.fn().mockResolvedValue({}),
      findUnique: vitest.fn().mockResolvedValue(null),
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
    teamMember: {
      // bulkAssignKitCustody resolves the custodian via findFirst scoped to
      // { id, organizationId } (cross-org IDOR guard).
      findUnique: vitest.fn().mockResolvedValue(null),
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    kitCustody: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    custody: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      // why: `moveAssetKitUnits` blocks the move when the source kit is
      // in operator custody: it looks up the inherited Custody row via
      // `findFirst({ assetId, kitCustody: { kitId: fromKitId } })`.
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    note: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // `updateKitAssets` / `bulkRemoveAssetsFromKits` pre-fetch kit-driven
    // BookingAsset rows that will be SET-NULL'd by the DB cascade, and
    // the live-link path runs `bookingAsset.updateMany` to sync kit
    // slice qty edits.
    bookingAsset: {
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: `removeKitSlicesFromPlanningBookings` deletes the kit-driven
      // slices held by DRAFT/RESERVED bookings before the AssetKit rows go,
      // and `mergeStandaloneCollisionsForKitDetachment` folds a kit-driven
      // row's units into a colliding standalone row via `update`.
      update: vitest.fn().mockResolvedValue({}),
      // why: `updateKitAssets` propagates a newly-added kit member into the
      // bookings that already hold this kit, one `createMany` per booking.
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: the same helper re-opens any `BookingModelRequest` the deleted
    // slice was fulfilling, mirroring `removeAssets`.
    bookingModelRequest: {
      findUnique: vitest.fn().mockResolvedValue(null),
      update: vitest.fn().mockResolvedValue({}),
    },
    // check-in floor guard sums per-slice check-ins before shrinking a
    // kit-driven slice's quantity.
    consumptionLog: {
      groupBy: vitest.fn().mockResolvedValue([]),
      // why: `mergeStandaloneCollisionsForKitDetachment` re-tags a merged-away
      // slice's dispositions onto the survivor before the delete nulls them.
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    // why: the same merge re-points session entries naming a merged-away
    // slice that went out. No sessions by default.
    partialBookingCheckout: {
      findMany: vitest.fn().mockResolvedValue([]),
      update: vitest.fn().mockResolvedValue({}),
    },
    // why: createKit/updateKit run cross-org ownership guards that call
    // db.category.findFirst before connecting a category. Mocked so the guard
    // can resolve the referenced category for valid test ids.
    category: {
      findFirst: vitest.fn().mockResolvedValue(null),
    },
    // why: `moveAssetKitUnits` loads the actor's firstName/lastName via
    // `tx.user.findUnique` inside the tx to carry forward to the
    // post-tx note write. Default returns a generic actor so the
    // happy-path tests don't have to set it up every time.
    user: {
      findUnique: vitest
        .fn()
        .mockResolvedValue({ firstName: "John", lastName: "Doe" }),
      // why: `bulkRemoveAssetsFromKits` resolves the acting user's timezone via
      // resolveUserFormatPrefsById (db.user.findFirst) to truncate date
      // filters in the user's tz on the select-all path. null: the resolver
      // falls back to default prefs.
      findFirst: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: `moveAssetKitUnits` runs a raw SELECT ... FOR UPDATE via the
// shared `lockAssetForQuantityUpdate` helper. We can't execute the raw
// query against a mocked tx, so the helper is stubbed and each test returns
// a controlled asset snapshot.
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn(),
}));

// why: the booking sources facade reads, locks and writes source rows through
// raw SQL and its own repository, which this model-shaped db mock cannot
// serve; its behaviour is covered by `booking-sources.server.test.ts`. Every
// picked slice is reported LEGACY unless a case says otherwise.
vitest.mock("~/modules/booking/sources/booking-sources.server", () => ({
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

// why: ensuring predictable ID generation for consistent test assertions
vitest.mock("~/utils/id/id.server", () => ({
  id: vitest.fn(() => "mock-id"),
}));

// why: avoiding QR code generation during kit service tests
vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

// why: testing kit barcode operations without triggering barcode validation and updates
vitest.mock("~/modules/barcode/service.server", () => ({
  updateBarcodes: vitest.fn(),
  validateBarcodeUniqueness: vitest.fn(),
}));

// why: preventing database lookups for user data during kit tests
vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "John",
    lastName: "Doe",
  }),
}));

// why: testing kit custody operations without creating actual notes
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
  createNotes: vitest.fn().mockResolvedValue({}),
  createBulkKitChangeNotes: vitest.fn().mockResolvedValue({}),
  // why: `moveAssetKitUnits` writes a paired "moved N units from
  // {KitX} to {KitY}" note via `createKitMoveNote` after the tx
  // commits. Stubbed so the move tests don't depend on note formatting.
  createKitMoveNote: vitest.fn().mockResolvedValue({}),
}));

// why: `bulkUpdateKitLocation` writes per-kit location notes via
// `createSystemLocationNote` after the tx commits; stubbed so tests don't
// depend on that pipeline. The per-asset move lines run for real and are
// asserted from the rows handed to `db.locationNote.createMany`.
vitest.mock(
  "~/modules/location-note/service.server",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createSystemLocationNote: vitest.fn().mockResolvedValue({}),
  })
);

// why: testing kit service without executing actual activity event recording
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: the kit-to-booking detach helpers write booking system notes. Stubbing the
// note module keeps the tests off the real pipeline (booking ownership check +
// bookingNote.createMany) while still letting us assert the rendered content,
// which is where the Markdoc sanitisation lives.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createSystemBookingNotes: vitest.fn().mockResolvedValue(undefined),
}));

// why: isolating kit service logic from asset utility dependencies
// why: the note text is not under test; the real where-builders stay so a
// select-all expansion runs as it does in production.
vitest.mock("~/modules/asset/utils.server", async (importOriginal) => ({
  ...(await importOriginal<typeof AssetUtilsModule>()),
  getKitLocationUpdateNoteContent: vitest
    .fn()
    .mockReturnValue("Mock note content"),
}));

// why: the sources module locks, reads and writes source rows through raw
// SQL and its own repository, which this model-shaped db mock cannot serve;
// its behaviour is covered by `kit-sources.server.test.ts`. The spies answer
// "nothing refused, nothing converted"; the status list and the mode test
// stay real so the queries are built as in production.
vitest.mock(
  "~/modules/booking/sources/kit-sources.server",
  async (importOriginal) => ({
    ...(await importOriginal<typeof KitSourcesModule>()),
    resizeKitSourceRows: vitest.fn(
      (
        _tx: unknown,
        args: { slices: Array<{ sliceId: string; quantity: number }> }
      ) =>
        Promise.resolve({
          refused: [],
          quantities: new Map(args.slices.map((s) => [s.sliceId, s.quantity])),
        })
    ),
    detachKitSliceSources: vitest.fn(() =>
      Promise.resolve({ convertedSliceIds: new Set<string>() })
    ),
    lockKitDetachPools: vitest.fn(() => Promise.resolve(new Set<string>())),
    probeKitDetachPools: vitest.fn(() => Promise.resolve([] as string[])),
  })
);

/** The active booking statuses kit propagation is scoped to. */
const ACTIVE_STATUSES = [
  BookingStatus.DRAFT,
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/** A mocked delegate method. */
function mocked(fn: unknown) {
  return fn as ReturnType<typeof vitest.fn>;
}

/** The kit-driven slice read of the quantity guard, by its `assetKitId: { in }`. */
function guardReadArgs() {
  return mocked(db.bookingAsset.findMany).mock.calls.find(
    ([args]) =>
      (args as { where?: { assetKitId?: { in?: string[] } } })?.where
        ?.assetKitId?.in !== undefined
  )?.[0] as { where: Record<string, unknown> } | undefined;
}

/**
 * Pens (AssetKit qty 60) in kit-1. The guard read answers `drivenRows`; the
 * standalone reservations read (`assetKitId: null`) answers nothing.
 */
function arrangeKitQuantityChange(
  drivenRows: Array<Record<string, unknown>>,
  checkedIn = 0
) {
  mocked(db.kit.findUniqueOrThrow).mockResolvedValue({
    id: "kit-1",
    location: null,
    assetKits: [
      {
        kitId: "kit-1",
        asset: {
          id: "pens",
          title: "Pens",
          assetKits: [{ kitId: "kit-1" }],
          bookingAssets: [],
        },
      },
    ],
    custody: null,
  });
  mocked(db.asset.findMany).mockResolvedValue([
    {
      id: "pens",
      title: "Pens",
      type: AssetType.QUANTITY_TRACKED,
      quantity: 100,
      assetKits: [{ kitId: "kit-1", quantity: 60 }],
      custody: [],
      bookingAssets: [],
      location: null,
    },
  ]);
  mocked(db.assetKit.findMany).mockResolvedValue([
    { id: "ak-pens", assetId: "pens", quantity: 60 },
  ]);
  mocked(db.bookingAsset.findMany).mockImplementation(
    (args?: { where?: { assetKitId?: unknown } }) =>
      Promise.resolve(args?.where?.assetKitId === null ? [] : drivenRows)
  );
  mocked(db.consumptionLog.groupBy).mockResolvedValue(
    drivenRows.map((row) => ({
      bookingAssetId: row.id,
      _sum: { quantity: checkedIn },
    }))
  );
}

/** Submits a new kit quantity for Pens. */
function changePensTo(quantity: number) {
  return updateKitAssets({
    kitId: "kit-1",
    assetIds: ["pens"],
    assetQuantities: { pens: quantity },
    userId: "user-1",
    organizationId: "org-1",
    request: new Request("http://test.com"),
  });
}

/** A converted kit slice of Pens on an ongoing booking. */
const convertedSlice = {
  id: "ba-kit",
  assetId: "pens",
  assetKitId: "ak-pens",
  sourceAllocation: "KIT",
  asset: { title: "Pens" },
  booking: { name: "Spring Shoot" },
};

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("updateKitAssets: kit quantity change", () => {
  it("dispatch 10 kit units, cancel, resize kit to 5: allowed, the cancelled slice is left as it was", async () => {
    // The guard and the propagation read active bookings only, so the
    // cancelled slice with 10 units out is never read or rewritten.
    arrangeKitQuantityChange([]);

    await changePensTo(5);

    expect(guardReadArgs()?.where).toEqual({
      assetKitId: { in: ["ak-pens"] },
      booking: { status: { in: ACTIVE_STATUSES } },
    });
    expect(db.bookingAsset.updateMany).toHaveBeenCalledWith({
      where: {
        assetKitId: "ak-pens",
        booking: { status: { in: ACTIVE_STATUSES } },
      },
      data: { quantity: 5 },
    });
    expect(resizeKitSourceRows).not.toHaveBeenCalled();
  });

  it("a converted KIT slice is guarded by its KIT row: raise to 6 is allowed and resizes the row", async () => {
    arrangeKitQuantityChange([convertedSlice]);

    await changePensTo(6);

    expect(resizeKitSourceRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      slices: [{ sliceId: "ba-kit", assetId: "pens", quantity: 6 }],
      belowOut: "refuse",
    });
    // The check-in floor (log sums) is not consulted for a converted slice.
    expect(
      mocked(db.consumptionLog.groupBy).mock.calls.some(
        ([args]) =>
          (args as { where?: { bookingAssetId?: unknown } })?.where
            ?.bookingAssetId !== undefined
      )
    ).toBe(false);
    expect(db.bookingAsset.updateMany).toHaveBeenCalledWith({
      where: {
        assetKitId: "ak-pens",
        booking: { status: { in: ACTIVE_STATUSES } },
      },
      data: { quantity: 6 },
    });
    // The row is resized before the slice quantity is written.
    expect(
      mocked(resizeKitSourceRows).mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocked(db.bookingAsset.updateMany).mock.invocationCallOrder[0]
    );
  });

  it("a converted KIT slice lowered to 5 hands the new quantity to the KIT row resize", async () => {
    arrangeKitQuantityChange([convertedSlice]);

    await changePensTo(5);

    expect(resizeKitSourceRows).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slices: [{ sliceId: "ba-kit", assetId: "pens", quantity: 5 }],
      })
    );
  });

  it("a converted KIT slice below its units out is refused with the floor, and nothing propagates", async () => {
    arrangeKitQuantityChange([convertedSlice]);
    mocked(resizeKitSourceRows).mockResolvedValueOnce({
      refused: [{ sliceId: "ba-kit", out: 6 }],
      quantities: new Map(),
    });

    await expect(changePensTo(5)).rejects.toThrow(
      'Cannot reduce kit quantity below units still checked out: "Pens" on booking "Spring Shoot" (6 still checked out).'
    );
    expect(db.bookingAsset.updateMany).not.toHaveBeenCalled();
  });

  it("a LEGACY slice keeps the check-in floor guard", async () => {
    arrangeKitQuantityChange(
      [{ ...convertedSlice, id: "ba-legacy", sourceAllocation: "LEGACY" }],
      40
    );

    await expect(changePensTo(30)).rejects.toThrow(/already checked in/i);
    expect(resizeKitSourceRows).not.toHaveBeenCalled();
    expect(db.bookingAsset.updateMany).not.toHaveBeenCalled();
  });
});

describe("mergeStandaloneCollisionsForKitDetachment: source rows", () => {
  it("hands every kit slice to the sources detach before any merge write", async () => {
    const kitRows = [
      {
        id: "ba-kit",
        bookingId: "b-1",
        assetId: "pens",
        quantity: 5,
        bookingModelRequestId: null,
        checkedOutQuantity: 3,
        sourceAllocation: "KIT",
      },
    ];
    mocked(db.bookingAsset.findMany)
      .mockResolvedValueOnce(kitRows)
      .mockResolvedValueOnce([
        {
          id: "ba-standalone",
          bookingId: "b-1",
          assetId: "pens",
          quantity: 4,
          bookingModelRequestId: null,
          checkedOutQuantity: 2,
          sourceAllocation: "AUTO",
        },
      ]);
    mocked(detachKitSliceSources).mockResolvedValueOnce({
      convertedSliceIds: new Set(["ba-kit"]),
    });

    await mergeStandaloneCollisionsForKitDetachment(db, ["ak-1"], "org-1");

    expect(detachKitSliceSources).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      kitSlices: kitRows,
    });
    // A converted merge carries `checkedOutQuantity` even with no markers.
    expect(db.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "ba-standalone" },
      data: { quantity: 9, checkedOutQuantity: 5 },
    });
    expect(
      mocked(detachKitSliceSources).mock.invocationCallOrder[0]
    ).toBeLessThan(mocked(db.bookingAsset.update).mock.invocationCallOrder[0]);
    expect(
      mocked(detachKitSliceSources).mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocked(db.bookingAsset.deleteMany).mock.invocationCallOrder[0]
    );
  });

  it("detaches a kit slice with no standalone sibling too (it becomes AUTO)", async () => {
    const kitRows = [
      {
        id: "ba-kit",
        bookingId: "b-1",
        assetId: "pens",
        quantity: 5,
        bookingModelRequestId: null,
        sourceAllocation: "KIT",
      },
    ];
    mocked(db.bookingAsset.findMany)
      .mockResolvedValueOnce(kitRows)
      .mockResolvedValueOnce([]);

    await mergeStandaloneCollisionsForKitDetachment(db, ["ak-1"], "org-1");

    expect(detachKitSliceSources).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      kitSlices: kitRows,
    });
    expect(db.bookingAsset.update).not.toHaveBeenCalled();
  });

  it("kit delete: every kit slice of every deleted membership goes to the detach, one call", async () => {
    const kitRows = [
      {
        id: "ba-1",
        bookingId: "b-1",
        assetId: "pens",
        quantity: 2,
        sourceAllocation: "KIT",
      },
      {
        id: "ba-2",
        bookingId: "b-2",
        assetId: "tape",
        quantity: 3,
        sourceAllocation: "KIT",
      },
    ];
    mocked(db.bookingAsset.findMany)
      .mockResolvedValueOnce(kitRows)
      .mockResolvedValueOnce([]);

    await mergeStandaloneCollisionsForKitDetachment(
      db,
      ["ak-1", "ak-2"],
      "org-1"
    );

    expect(detachKitSliceSources).toHaveBeenCalledTimes(1);
    expect(detachKitSliceSources).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      kitSlices: kitRows,
    });
  });

  it("a LEGACY merge writes exactly what it always has", async () => {
    mocked(db.bookingAsset.findMany)
      .mockResolvedValueOnce([
        {
          id: "ba-kit",
          bookingId: "b-1",
          assetId: "pens",
          quantity: 5,
          bookingModelRequestId: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "ba-standalone",
          bookingId: "b-1",
          assetId: "pens",
          quantity: 4,
          bookingModelRequestId: null,
        },
      ]);

    await mergeStandaloneCollisionsForKitDetachment(db, ["ak-1"], "org-1");

    expect(db.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "ba-standalone" },
      data: { quantity: 9 },
    });
  });
});

describe("removeKitSlicesFromPlanningBookings: converted slices", () => {
  it("takes the one detach lock before it reads or deletes any slice", async () => {
    const rows = [
      {
        id: "ba-kit",
        bookingId: "b-1",
        assetId: "pens",
        quantity: 5,
        assetKitId: "ak-1",
        bookingModelRequestId: null,
        sourceAllocation: "KIT",
        booking: {
          id: "b-1",
          name: "Shoot",
          organizationId: "org-1",
          status: "RESERVED",
        },
        asset: {
          id: "pens",
          title: "Pens",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: null,
        },
      },
    ];
    mocked(db.bookingAsset.findMany).mockResolvedValueOnce(rows);
    mocked(db.assetKit.findMany).mockResolvedValueOnce([
      { id: "ak-1", kitId: "kit-1", kit: { name: "Kit" } },
    ]);

    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    expect(lockKitDetachPools).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      assetKitIds: ["ak-1"],
    });
    const lockOrder = mocked(lockKitDetachPools).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(
      mocked(db.bookingAsset.findMany).mock.invocationCallOrder[0]
    );
    expect(lockOrder).toBeLessThan(
      mocked(db.bookingAsset.deleteMany).mock.invocationCallOrder[0]
    );
  });
});

describe("moveAssetKitUnits: converted destination slices", () => {
  it("grows a converted destination slice's KIT row with clamp, never a refusal", async () => {
    mocked(lockAssetForQuantityUpdate).mockResolvedValue({
      id: "pens",
      title: "Pens",
      organizationId: "org-1",
      type: AssetType.QUANTITY_TRACKED,
      quantity: 100,
      unitOfMeasure: null,
    });
    // why: `assertAssetsBelongToOrg` echoes the ids it was asked about.
    mocked(db.asset.findMany).mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id })))
    );
    mocked(db.kit.findFirst).mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, name: where.id, locationId: null })
    );
    mocked(db.assetKit.findFirst).mockResolvedValue({
      id: "ak-src",
      quantity: 50,
    });
    mocked(db.assetKit.upsert).mockResolvedValue({
      id: "ak-dst",
      quantity: 15,
    });
    // The source has no active slices; the destination has one converted.
    mocked(db.bookingAsset.findMany).mockImplementation(
      (args?: { where?: { sourceAllocation?: string } }) =>
        Promise.resolve(
          args?.where?.sourceAllocation === "KIT"
            ? [{ id: "ba-dst", assetId: "pens" }]
            : []
        )
    );

    await moveAssetKitUnits({
      assetId: "pens",
      organizationId: "org-1",
      userId: "user-1",
      fromKitId: "kit-from",
      toKitId: "kit-to",
      quantity: 10,
    });

    expect(resizeKitSourceRows).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      slices: [{ sliceId: "ba-dst", assetId: "pens", quantity: 15 }],
      belowOut: "clamp",
    });
  });
});

describe("removeDestroyedUnitsFromKits: converted planning slices", () => {
  it("caps a converted kit slice through its KIT row, never below its units out", async () => {
    mocked(db.assetKit.findMany).mockResolvedValueOnce([
      {
        id: "ak-1",
        assetId: "asset-pool",
        kitId: "kit-1",
        quantity: 5,
        kit: { name: "Kit" },
        asset: {
          title: "Cables",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: null,
          quantity: 20,
        },
      },
    ]);
    mocked(db.assetKit.groupBy).mockResolvedValueOnce([
      { assetId: "asset-pool", _sum: { quantity: 5 } },
    ]);
    mocked(db.bookingAsset.findMany).mockResolvedValueOnce([
      {
        id: "ba-converted",
        bookingId: "booking-next-week",
        assetId: "asset-pool",
        assetKitId: "ak-1",
        quantity: 5,
        sourceAllocation: "KIT",
      },
    ]);
    // The KIT row has 3 units out, so the slice keeps 3, not 2.
    mocked(resizeKitSourceRows).mockResolvedValueOnce({
      refused: [],
      quantities: new Map([["ba-converted", 3]]),
    });

    await removeDestroyedUnitsFromKits(db, {
      destroyedUnitsByAssetKitId: new Map([["ak-1", 3]]),
      organizationId: "org-1",
      actorUserId: "user-1",
      bookingId: "booking-1",
    });

    expect(resizeKitSourceRows).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      slices: [{ sliceId: "ba-converted", assetId: "asset-pool", quantity: 2 }],
      belowOut: "clamp",
    });
    expect(db.bookingAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-converted"] } },
      data: { quantity: 3 },
    });
  });
});

describe("kit detach paths: one asset lock, workspace-scoped", () => {
  /** Pens in kit-1 through membership `ak-pens`, with one kit slice. */
  function arrangeRemoval(sourceAllocation: string) {
    mocked(db.kit.findUniqueOrThrow).mockResolvedValue({
      id: "kit-1",
      name: "Kit",
      location: null,
      custody: null,
      assetKits: [
        {
          id: "ak-pens",
          kitId: "kit-1",
          quantity: 5,
          asset: {
            id: "pens",
            title: "Pens",
            type: AssetType.QUANTITY_TRACKED,
            unitOfMeasure: null,
            archivedAt: null,
            assetKits: [{ kitId: "kit-1" }],
            bookingAssets: [
              {
                id: "ba-kit",
                assetKitId: "ak-pens",
                sourceAllocation,
                // A finished booking: the edit propagates nothing to it.
                booking: { id: "b-1", status: BookingStatus.COMPLETE },
              },
            ],
          },
        },
      ],
    });
    mocked(db.asset.findMany).mockResolvedValue([]);
    mocked(db.assetKit.findMany).mockResolvedValue([{ id: "ak-pens" }]);
    mocked(db.bookingAsset.findMany).mockImplementation(() =>
      Promise.resolve([])
    );
  }

  /** Removes every member of kit-1. */
  function removeEveryMember() {
    return updateKitAssets({
      kitId: "kit-1",
      assetIds: [],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });
  }

  it("updateKitAssets removing a converted asset locks it in the first statement, before the detach lock", async () => {
    arrangeRemoval("KIT");
    // The probe finds a converted kit slice on the removed membership.
    mocked(probeKitDetachPools).mockResolvedValueOnce(["pens"]);

    await removeEveryMember();

    // The probe opens the transaction, over the removed memberships.
    expect(probeKitDetachPools).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      assetKitIds: ["ak-pens"],
    });
    expect(
      mocked(probeKitDetachPools).mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocked(lockAssetsForArchiveGuard).mock.invocationCallOrder[0]
    );
    expect(lockAssetsForArchiveGuard).toHaveBeenCalledWith(
      expect.anything(),
      ["pens"],
      "org-1"
    );
    expect(lockKitDetachPools).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      assetKitIds: ["ak-pens"],
    });
    expect(
      mocked(lockAssetsForArchiveGuard).mock.invocationCallOrder[0]
    ).toBeLessThan(mocked(lockKitDetachPools).mock.invocationCallOrder[0]);
  });

  it("updateKitAssets removing a LEGACY asset with adoption off leaves the first lock as it was", async () => {
    arrangeRemoval("LEGACY");
    // The probe finds nothing: no converted slice and adoption off.
    mocked(probeKitDetachPools).mockResolvedValueOnce([]);

    await removeEveryMember();

    expect(lockAssetsForArchiveGuard).toHaveBeenCalledWith(
      expect.anything(),
      [],
      "org-1"
    );
  });

  it("kit delete takes the detach lock over its memberships before any slice read or detach", async () => {
    mocked(db.kit.findUniqueOrThrow).mockResolvedValue({
      id: "kit-1",
      name: "Kit",
      organizationId: "org-1",
      custody: null,
      assetKits: [
        {
          quantity: 5,
          asset: {
            id: "pens",
            title: "Pens",
            type: AssetType.QUANTITY_TRACKED,
            unitOfMeasure: null,
          },
        },
      ],
    });
    mocked(db.assetKit.findMany).mockResolvedValue([
      { id: "ak-pens", kitId: "kit-1", kit: { name: "Kit" } },
    ]);
    const kitSlice = {
      id: "ba-kit",
      bookingId: "b-1",
      assetId: "pens",
      quantity: 5,
      bookingModelRequestId: null,
      sourceAllocation: "KIT",
    };
    // The merge's kit-slice read is the only one with no status filter; no
    // standalone sibling exists.
    mocked(db.bookingAsset.findMany).mockImplementation(
      (args?: {
        where?: { assetKitId?: unknown; booking?: { status?: unknown } };
      }) =>
        Promise.resolve(
          args?.where?.assetKitId === null || args?.where?.booking?.status
            ? []
            : [kitSlice]
        )
    );
    mocked(db.custody.findMany).mockResolvedValue([]);

    await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
      actorUserId: "user-1",
    });

    expect(lockKitDetachPools).toHaveBeenCalledTimes(1);
    expect(lockKitDetachPools).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      assetKitIds: ["ak-pens"],
    });
    const lockOrder = mocked(lockKitDetachPools).mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(
      mocked(db.bookingAsset.findMany).mock.invocationCallOrder[0]
    );
    expect(lockOrder).toBeLessThan(
      mocked(detachKitSliceSources).mock.invocationCallOrder[0]
    );
    expect(detachKitSliceSources).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-1",
      kitSlices: [kitSlice],
    });
  });

  it("the merge reads only slices of bookings in the acting workspace", async () => {
    mocked(db.bookingAsset.findMany).mockResolvedValueOnce([]);

    await mergeStandaloneCollisionsForKitDetachment(
      db,
      ["ak-foreign"],
      "org-1"
    );

    expect(db.bookingAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetKitId: { in: ["ak-foreign"] },
          booking: { organizationId: "org-1" },
        },
      })
    );
    // A foreign membership has no slice here: nothing is detached or written.
    expect(detachKitSliceSources).not.toHaveBeenCalled();
    expect(db.bookingAsset.update).not.toHaveBeenCalled();
    expect(db.bookingAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("a check-in completing its booking hands it to the detach as finishing", async () => {
    mocked(db.assetKit.findMany).mockResolvedValueOnce([
      {
        id: "ak-1",
        assetId: "asset-pool",
        kitId: "kit-1",
        quantity: 3,
        kit: { name: "Kit" },
        asset: {
          title: "Cables",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: null,
          quantity: 20,
        },
      },
    ]);
    mocked(db.assetKit.groupBy).mockResolvedValueOnce([
      { assetId: "asset-pool", _sum: { quantity: 3 } },
    ]);
    const kitSlice = {
      id: "ba-own",
      bookingId: "booking-1",
      assetId: "asset-pool",
      quantity: 3,
      bookingModelRequestId: null,
      sourceAllocation: "KIT",
    };
    mocked(db.bookingAsset.findMany).mockImplementation(
      (args?: {
        where?: { assetKitId?: unknown; booking?: { status?: unknown } };
      }) =>
        Promise.resolve(
          args?.where?.assetKitId === null || args?.where?.booking?.status
            ? []
            : [kitSlice]
        )
    );

    await removeDestroyedUnitsFromKits(db, {
      destroyedUnitsByAssetKitId: new Map([["ak-1", 3]]),
      organizationId: "org-1",
      actorUserId: "user-1",
      bookingId: "booking-1",
      finishingBookingIds: ["booking-1"],
    });

    expect(detachKitSliceSources).toHaveBeenCalledWith(db, {
      organizationId: "org-1",
      kitSlices: [kitSlice],
      finishingBookingIds: ["booking-1"],
    });
  });
});
