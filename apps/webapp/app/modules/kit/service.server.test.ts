import Markdoc from "@markdoc/markdoc";
import {
  AssetType,
  BarcodeType,
  BookingStatus,
  KitStatus,
  AssetStatus,
  ErrorCorrection,
} from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { ALL_SELECTED_KEY } from "~/utils/list";

import {
  createKit,
  updateKit,
  getKit,
  deleteKit,
  bulkDeleteKits,
  bulkAssignKitCustody,
  bulkReleaseKitCustody,
  releaseCustody,
  createKitsIfNotExists,
  updateKitQrCode,
  relinkKitQrCode,
  getAvailableKitAssetForBooking,
  updateKitsWithBookingCustodians,
  bulkRemoveAssetsFromKits,
  moveAssetKitUnits,
} from "./service.server";
import { recordEvents } from "../activity-event/service.server";
import { createSystemBookingNotes } from "../booking-note/service.server";
import { lockAssetForQuantityUpdate } from "../consumption-log/quantity-lock.server";
import { createNote, createNotes } from "../note/service.server";
import { getQr } from "../qr/service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock dependencies
// why: testing kit service logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
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
    },
    assetKit: {
      create: vitest.fn().mockResolvedValue({}),
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      update: vitest.fn().mockResolvedValue({}),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      // why: `moveAssetKitUnits` (Phase 4c) reads the source AssetKit
      // row via `findFirst({ assetId, kitId })`, deletes-on-zero or
      // updates the source, and upserts the destination on the
      // `assetId_kitId` partial unique. Defaults to null/no-op so tests
      // opt in to the allocation state they need.
      findFirst: vitest.fn().mockResolvedValue(null),
      delete: vitest.fn().mockResolvedValue({}),
      upsert: vitest.fn().mockResolvedValue({}),
    },
    // Location mutations go through this delegate instead of asset.updateMany,
    // since placement lives on the AssetLocation pivot. Includes
    // `updateMany` for kit-driven qty sync — the cascade also calls
    // `findMany` to re-read the just-inserted AssetKit ids before
    // creating the kit-driven AssetLocation rows.
    assetLocation: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
      updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      // why: the kit-location cascade trims overflowing manual placements
      // per-row, and the detach guard converts/merges kit-driven rows
      // one at a time — both need single-row `update` / `delete`.
      update: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
    },
    // why: createKit/updateKit now run a cross-org ownership guard that calls
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
      // bulkAssignKitCustody now resolves the custodian via findFirst scoped
      // to { id, organizationId } (cross-org IDOR guard), not findUnique.
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
      // in operator custody — it looks up the inherited Custody row via
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
    },
    // why: createKit/updateKit now run cross-org ownership guards that call
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
      // resolveUserFormatPrefsById (→ db.user.findFirst) to truncate date
      // filters in the user's tz on the select-all path. null → the resolver
      // falls back to default prefs.
      findFirst: vitest.fn().mockResolvedValue(null),
    },
  },
}));

// why: `moveAssetKitUnits` runs a raw SELECT ... FOR UPDATE via the
// shared `lockAssetForQuantityUpdate` helper. We can't execute the raw
// query against a mocked tx — stub the helper so each test can return
// a controlled asset snapshot.
vitest.mock("~/modules/consumption-log/quantity-lock.server", () => ({
  lockAssetForQuantityUpdate: vitest.fn(),
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

// why: `bulkUpdateKitLocation` writes per-location system notes via
// `createSystemLocationNote` after the tx commits. Stubbed so tests
// don't depend on the real note pipeline (which calls into db.note
// + markdoc helpers and would unmask unrelated mock gaps).
vitest.mock("~/modules/location-note/service.server", () => ({
  createSystemLocationNote: vitest.fn().mockResolvedValue({}),
}));

// why: testing kit service without executing actual activity event recording
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

// why: the kit→booking detach helpers write booking system notes. Stubbing the
// note module keeps the tests off the real pipeline (booking ownership check +
// bookingNote.createMany) while still letting us assert the rendered content,
// which is where the Markdoc sanitisation lives.
vitest.mock("~/modules/booking-note/service.server", () => ({
  createSystemBookingNote: vitest.fn().mockResolvedValue({}),
  createSystemBookingNotes: vitest.fn().mockResolvedValue(undefined),
}));

// why: isolating kit service logic from asset utility dependencies
vitest.mock("~/modules/asset/utils.server", () => ({
  getKitLocationUpdateNoteContent: vitest
    .fn()
    .mockReturnValue("Mock note content"),
}));

const mockKitData = {
  id: "kit-1",
  name: "Test Kit",
  description: "Test Description",
  status: KitStatus.AVAILABLE,
  createdById: "user-1",
  organizationId: "org-1",
  categoryId: "category-1",
  image: null,
  imageExpiration: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCreateParams = {
  name: "Test Kit",
  description: "Test Description",
  createdById: "user-1",
  organizationId: "org-1",
  categoryId: "category-1",
  locationId: null,
};

describe("createKit", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: the cross-org ownership guard in createKit queries
    // db.category.findFirst({ where: { id, organizationId } }) and
    // db.location.findFirst(...) before connecting. Echo back { id: where.id }
    // so valid test ids resolve and the guard passes (returns null only when
    // no id is supplied, preserving the not-found behavior).
    //@ts-expect-error missing vitest type
    db.category.findFirst.mockImplementation(({ where }) =>
      where?.id ? Promise.resolve({ id: where.id }) : Promise.resolve(null)
    );
    //@ts-expect-error missing vitest type
    db.location.findFirst.mockImplementation(({ where }) =>
      where?.id
        ? Promise.resolve({ id: where.id, name: where.id })
        : Promise.resolve(null)
    );
  });

  it("should create a kit successfully with category", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.kit.create.mockResolvedValue(mockKitData);

    const result = await createKit(mockCreateParams);

    expect(db.kit.create).toHaveBeenCalledWith({
      data: {
        name: "Test Kit",
        description: "Test Description",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
        qrCodes: {
          create: [
            {
              id: "mock-id",
              version: 0,
              errorCorrection: ErrorCorrection.L,
              user: { connect: { id: "user-1" } },
              organization: { connect: { id: "org-1" } },
            },
          ],
        },
        category: { connect: { id: "category-1" } },
      },
    });
    expect(result).toEqual(mockKitData);
  });

  it("should create a kit without category when categoryId is null", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.create.mockResolvedValue(mockKitData);

    await createKit({
      ...mockCreateParams,
      categoryId: null,
      locationId: null,
    });

    expect(db.kit.create).toHaveBeenCalledWith({
      data: {
        name: "Test Kit",
        description: "Test Description",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
        qrCodes: {
          create: [
            {
              id: "mock-id",
              version: 0,
              errorCorrection: ErrorCorrection.L,
              user: { connect: { id: "user-1" } },
              organization: { connect: { id: "org-1" } },
            },
          ],
        },
        category: undefined,
      },
    });
  });

  it("should create a kit with barcodes", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.create.mockResolvedValue(mockKitData);

    const barcodes = [
      { type: BarcodeType.Code128, value: "TEST123" },
      { type: BarcodeType.Code39, value: "ABC456" },
    ];

    await createKit({
      ...mockCreateParams,
      barcodes,
      locationId: null,
    });

    expect(db.kit.create).toHaveBeenCalledWith({
      data: {
        name: "Test Kit",
        description: "Test Description",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
        qrCodes: {
          create: [
            {
              id: "mock-id",
              version: 0,
              errorCorrection: ErrorCorrection.L,
              user: { connect: { id: "user-1" } },
              organization: { connect: { id: "org-1" } },
            },
          ],
        },
        category: { connect: { id: "category-1" } },
        barcodes: {
          create: [
            {
              type: BarcodeType.Code128,
              value: "TEST123",
              organizationId: "org-1",
            },
            {
              type: BarcodeType.Code39,
              value: "ABC456",
              organizationId: "org-1",
            },
          ],
        },
      },
    });
  });

  it("should filter out invalid barcodes", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.create.mockResolvedValue(mockKitData);

    const barcodes = [
      { type: BarcodeType.Code128, value: "TEST123" },
      { type: BarcodeType.Code39, value: "" }, // Empty value
      { type: null, value: "ABC456" }, // No type
    ];

    await createKit({
      ...mockCreateParams,
      //@ts-expect-error testing invalid barcodes
      barcodes,
    });

    expect(db.kit.create).toHaveBeenCalledWith({
      data: {
        name: "Test Kit",
        description: "Test Description",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
        qrCodes: {
          create: [
            {
              id: "mock-id",
              version: 0,
              errorCorrection: ErrorCorrection.L,
              user: { connect: { id: "user-1" } },
              organization: { connect: { id: "org-1" } },
            },
          ],
        },
        category: { connect: { id: "category-1" } },
        barcodes: {
          create: [
            {
              type: BarcodeType.Code128,
              value: "TEST123",
              organizationId: "org-1",
            },
          ],
        },
      },
    });
  });

  it("should handle barcode constraint violations", async () => {
    expect.assertions(1);

    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.kit.create.mockRejectedValue(constraintError);

    const barcodes = [{ type: BarcodeType.Code128, value: "DUPLICATE123" }];

    await expect(
      createKit({
        ...mockCreateParams,
        barcodes,
        locationId: null,
      })
    ).rejects.toThrow();
  });
});

describe("updateKit", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: updateKit runs the same cross-org ownership guard as createKit.
    // Echo back { id: where.id } so valid test ids resolve and the guard
    // passes (returns null when no id is supplied, e.g. uncategorized).
    //@ts-expect-error missing vitest type
    db.category.findFirst.mockImplementation(({ where }) =>
      where?.id ? Promise.resolve({ id: where.id }) : Promise.resolve(null)
    );
    //@ts-expect-error missing vitest type
    db.location.findFirst.mockImplementation(({ where }) =>
      where?.id
        ? Promise.resolve({ id: where.id, name: where.id })
        : Promise.resolve(null)
    );
  });

  it("should update kit successfully with category", async () => {
    expect.assertions(2);
    const updatedKit = { ...mockKitData, name: "Updated Kit" };
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(updatedKit);

    const result = await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      description: "Updated Description",
      status: KitStatus.AVAILABLE,
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: "category-2",
      locationId: null,
    });

    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: "Updated Description",
        image: undefined,
        imageExpiration: undefined,
        status: KitStatus.AVAILABLE,
        category: { connect: { id: "category-2" } },
      },
    });
    expect(result).toEqual(updatedKit);
  });

  it("should disconnect category when categoryId is 'uncategorized'", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(mockKitData);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: "uncategorized",
      locationId: null,
    });

    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: undefined,
        image: undefined,
        imageExpiration: undefined,
        status: undefined,
        category: { disconnect: true },
      },
    });
  });

  it("should not change category when categoryId is null", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(mockKitData);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: null,
      locationId: null,
    });

    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: undefined,
        image: undefined,
        imageExpiration: undefined,
        status: undefined,
      },
    });
  });

  it("should not change category when categoryId is undefined", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(mockKitData);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: undefined,
      locationId: null,
    });

    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: undefined,
        image: undefined,
        imageExpiration: undefined,
        status: undefined,
      },
    });
  });

  it("should update barcodes when provided", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(mockKitData);
    const { updateBarcodes } = await import("~/modules/barcode/service.server");

    const barcodes = [{ type: BarcodeType.Code128, value: "NEW123" }];

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      barcodes,
      locationId: null,
    });

    expect(db.kit.update).toHaveBeenCalled();
    expect(updateBarcodes).toHaveBeenCalledWith({
      barcodes,
      kitId: "kit-1",
      organizationId: "org-1",
      userId: "user-1",
    });
  });

  it("refuses to change the kit's location, which would skip the asset cascade", async () => {
    expect.assertions(2);

    // Setting `Kit.locationId` here moves the kit without moving its member
    // assets — the cascade lives in `updateKitLocation`. This route into a
    // location change is how kit members drifted from their kit's location,
    // so it must reject rather than write a half-applied change.
    await expect(
      updateKit({
        id: "kit-1",
        name: "Updated Kit",
        createdById: "user-1",
        organizationId: "org-1",
        locationId: "loc-new",
      })
    ).rejects.toThrow(ShelfError);

    expect(db.kit.update).not.toHaveBeenCalled();
  });
});

describe("getKit", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should get kit successfully", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.kit.findFirstOrThrow.mockResolvedValue(mockKitData);

    const result = await getKit({
      id: "kit-1",
      organizationId: "org-1",
    });

    expect(db.kit.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        OR: [{ id: "kit-1", organizationId: "org-1" }],
      },
      include: expect.any(Object),
    });
    expect(result).toEqual(mockKitData);
  });

  it("should handle cross-organization access", async () => {
    expect.assertions(1);
    const crossOrgKit = { ...mockKitData, organizationId: "other-org" };
    //@ts-expect-error missing vitest type
    db.kit.findFirstOrThrow.mockResolvedValue(crossOrgKit);

    const userOrganizations = [{ organizationId: "other-org" }];

    await expect(
      getKit({
        id: "kit-1",
        organizationId: "org-1",
        userOrganizations,
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should throw error when kit not found", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.findFirstOrThrow.mockRejectedValue(new Error("Not found"));

    await expect(
      getKit({
        id: "nonexistent-kit",
        organizationId: "org-1",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("deleteKit", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("deletes an AVAILABLE kit (no custody) without firing events or notes", async () => {
    // why: pre-fix this path was the only behaviour deleteKit had — no kit
    // custody means no children to release, so nothing to emit.
    const availableKit = {
      ...mockKitData,
      assets: [],
      custody: null,
    };
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(availableKit);

    const result = await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
      actorUserId: "user-1",
    });

    // Single + bulk paths now share `performKitDeletion`, which uses
    // `deleteMany` so the same query handles both cardinalities.
    expect(db.kit.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1"] }, organizationId: "org-1" },
    });
    expect(recordEvents).not.toHaveBeenCalled();
    expect(createNotes).not.toHaveBeenCalled();
    expect(result).toEqual(availableKit);
  });

  it("deletes an in-custody kit and emits CUSTODY_RELEASED + flips status + writes notes", async () => {
    // Setup: kit in custody to Bob, contains Drill (INDIVIDUAL, no operator
    // custody) and Pens (QUANTITY_TRACKED, has operator custody to Alice).
    // After delete: Drill → AVAILABLE (no remaining custody), Pens stays
    // IN_CUSTODY (Alice's row survives the cascade).
    //
    // Main's PR #2535 added three smaller tests here exercising the legacy
    // `db.kit.delete` + `db.asset.findMany({ where: { kitId } })` shape;
    // those don't apply to our branch's pivot-aware code path
    // (findUniqueOrThrow → assetKits.asset → deleteMany). The
    // `ASSET_KIT_CHANGED` emission they cover is now part of
    // `performKitDeletion` and worth a dedicated assertion in a
    // follow-up — left as a TODO so this merge stays scoped.
    const inCustodyKit = {
      ...mockKitData,
      assetKits: [
        { asset: { id: "drill-1", title: "Drill" } },
        { asset: { id: "pens-1", title: "Pens" } },
      ],
      custody: {
        id: "kc-1",
        custodian: {
          id: "tm-bob",
          name: "Bob",
          user: { id: "user-bob" },
        },
      },
    };
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(inCustodyKit);
    //@ts-expect-error missing vitest type
    // Inherited (kit-allocated) custody rows pre-cascade — one per asset.
    // `kitCustodyId` is required so the helper can map each event back
    // to its source kit for `kitId` + `targetUserId`.
    db.custody.findMany.mockResolvedValueOnce([
      { assetId: "drill-1", teamMemberId: "tm-bob", kitCustodyId: "kc-1" },
      { assetId: "pens-1", teamMemberId: "tm-bob", kitCustodyId: "kc-1" },
    ]);
    //@ts-expect-error missing vitest type
    // Post-cascade snapshot — Pens still has Alice's operator row, Drill
    // has nothing left.
    db.custody.findMany.mockResolvedValueOnce([{ assetId: "pens-1" }]);

    await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
      actorUserId: "user-actor",
    });

    // Two recordEvents calls inside the tx:
    //   1. CUSTODY_RELEASED per inherited Custody row (viaKit/viaKitDelete meta)
    //   2. ASSET_KIT_CHANGED per asset that lost its kit on cascade
    // The second call was added in the main-merge resolution so single + bulk
    // delete paths share `performKitDeletion`'s ASSET_KIT_CHANGED emission
    // (folded in from PR #2535).
    expect(recordEvents).toHaveBeenCalledTimes(2);
    const custodyReleasedArg = (recordEvents as ReturnType<typeof vitest.fn>)
      .mock.calls[0][0];
    expect(custodyReleasedArg).toHaveLength(2);
    expect(custodyReleasedArg[0]).toMatchObject({
      action: "CUSTODY_RELEASED",
      entityType: "ASSET",
      assetId: "drill-1",
      kitId: "kit-1",
      targetUserId: "user-bob",
      meta: { viaKit: true, viaKitDelete: true },
    });
    const assetKitChangedArg = (recordEvents as ReturnType<typeof vitest.fn>)
      .mock.calls[1][0];
    expect(assetKitChangedArg).toHaveLength(2);
    expect(assetKitChangedArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "drill-1",
          kitId: "kit-1",
          field: "kitId",
          fromValue: "kit-1",
          toValue: null,
        }),
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "pens-1",
          kitId: "kit-1",
          fromValue: "kit-1",
          toValue: null,
        }),
      ])
    );

    expect(db.kit.deleteMany).toHaveBeenCalled();

    // Drill flips to AVAILABLE; Pens does not (still has operator custody).
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["drill-1"] }, organizationId: "org-1" },
      data: { status: AssetStatus.AVAILABLE },
    });

    // Notes written per asset (one row each) via `db.note.createMany`, kit
    // name inlined (no link — kit gone). Per-asset content lets qty-tracked
    // assets name their released unit count; these fixtures omit
    // type/quantity so both fall back to the countless "custody" wording.
    expect(db.note.createMany).toHaveBeenCalledTimes(1);
    const notesArg = (db.note.createMany as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(notesArg.data.map((n: { assetId: string }) => n.assetId)).toEqual([
      "drill-1",
      "pens-1",
    ]);
    for (const note of notesArg.data) {
      expect(note.content).toContain("when kit");
      expect(note.content).toContain(mockKitData.name);
    }
  });

  it("handles deletion errors by wrapping them in ShelfError", async () => {
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockRejectedValue(new Error("Not found"));

    await expect(
      deleteKit({
        id: "kit-1",
        organizationId: "org-1",
        actorUserId: "user-1",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("bulkDeleteKits", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should bulk delete kits successfully (no custody on either)", async () => {
    // Both `bulkDeleteKits` and `deleteKit` share `performKitDeletion`
    // now. With no kit-custody on the batch, no events / notes / status
    // flips fire — verify the underlying deleteMany still runs.
    const kitsToDelete = [
      {
        id: "kit-1",
        name: "Kit 1",
        image: "image1.jpg",
        assetKits: [],
        custody: null,
      },
      {
        id: "kit-2",
        name: "Kit 2",
        image: null,
        assetKits: [],
        custody: null,
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsToDelete);

    await bulkDeleteKits({
      kitIds: ["kit-1", "kit-2"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.kit.findMany).toHaveBeenCalled();
    expect(db.kit.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
    });
    expect(recordEvents).not.toHaveBeenCalled();
    expect(createNotes).not.toHaveBeenCalled();
  });

  it("bulk-deleting two in-custody kits emits per-kit events + per-kit notes", async () => {
    // Two kits, each in custody to a different person, each with one
    // asset. After the bulk delete: 2 CUSTODY_RELEASED events (one per
    // inherited Custody row), 2 separate notes (each attributing the
    // correct custodian to its kit), both assets flipped to AVAILABLE.
    const kitsToDelete = [
      {
        id: "kit-A",
        name: "Camera Kit",
        image: null,
        assetKits: [{ asset: { id: "drill-1", title: "Drill" } }],
        custody: {
          id: "kc-A",
          custodian: {
            id: "tm-bob",
            name: "Bob",
            user: { id: "user-bob" },
          },
        },
      },
      {
        id: "kit-B",
        name: "Drone Kit",
        image: null,
        assetKits: [{ asset: { id: "pen-1", title: "Pen" } }],
        custody: {
          id: "kc-B",
          custodian: {
            id: "tm-carol",
            name: "Carol",
            user: { id: "user-carol" },
          },
        },
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsToDelete);
    //@ts-expect-error missing vitest type
    // Pre-cascade inherited rows — one per kit, both linked to their
    // respective KitCustody.
    db.custody.findMany.mockResolvedValueOnce([
      { assetId: "drill-1", teamMemberId: "tm-bob", kitCustodyId: "kc-A" },
      { assetId: "pen-1", teamMemberId: "tm-carol", kitCustodyId: "kc-B" },
    ]);
    //@ts-expect-error missing vitest type
    // Post-cascade — neither asset has remaining custody.
    db.custody.findMany.mockResolvedValueOnce([]);

    await bulkDeleteKits({
      kitIds: ["kit-A", "kit-B"],
      organizationId: "org-1",
      userId: "user-actor",
    });

    // Two events, one per inherited row, with the right kitId mapping.
    const eventsArg = (recordEvents as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(eventsArg).toHaveLength(2);
    expect(eventsArg).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "drill-1",
          kitId: "kit-A",
          targetUserId: "user-bob",
        }),
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "pen-1",
          kitId: "kit-B",
          targetUserId: "user-carol",
        }),
      ])
    );

    // Both assets flipped to AVAILABLE (no remaining custody).
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: expect.arrayContaining(["drill-1", "pen-1"]) },
        organizationId: "org-1",
      },
      data: { status: AssetStatus.AVAILABLE },
    });

    // One `db.note.createMany` batch with a per-asset note row across both
    // kits (2 rows total). Per-asset content lets each asset attribute its
    // own custodian and — for qty-tracked assets — name its released units.
    expect(db.note.createMany).toHaveBeenCalledTimes(1);
    const bulkNotesArg = (db.note.createMany as ReturnType<typeof vitest.fn>)
      .mock.calls[0][0];
    expect(
      bulkNotesArg.data.map((n: { assetId: string }) => n.assetId)
    ).toEqual(["drill-1", "pen-1"]);
    // Each note attributes the correct custodian to its kit.
    const drillNote = bulkNotesArg.data.find(
      (n: { assetId: string }) => n.assetId === "drill-1"
    );
    const penNote = bulkNotesArg.data.find(
      (n: { assetId: string }) => n.assetId === "pen-1"
    );
    expect(drillNote.content).toContain("Camera Kit");
    expect(penNote.content).toContain("Drone Kit");
  });

  it("should emit ASSET_KIT_CHANGED per asset across all deleted kits", async () => {
    expect.assertions(2);
    // Translated from main's PR #2535 to our pivot schema: `assets:` on the
    // kit row is now sourced via `assetKits: { select: { asset: {...} } }`
    // and flattened in-memory before `performKitDeletion` runs.
    const kitsToDelete = [
      {
        id: "kit-1",
        name: "Kit 1",
        image: null,
        assetKits: [
          { asset: { id: "asset-1", title: "Asset 1" } },
          { asset: { id: "asset-2", title: "Asset 2" } },
        ],
        custody: null,
      },
      {
        id: "kit-2",
        name: "Kit 2",
        image: null,
        assetKits: [{ asset: { id: "asset-3", title: "Asset 3" } }],
        custody: null,
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsToDelete);

    await bulkDeleteKits({
      kitIds: ["kit-1", "kit-2"],
      organizationId: "org-1",
      userId: "user-1",
    });

    // ASSET_KIT_CHANGED events are emitted in a single batched recordEvents
    // call inside `performKitDeletion` (one per asset, kit-id mapped from
    // the pivot row's source kit). No CUSTODY_RELEASED events fire because
    // neither kit has custody.
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "asset-1",
          kitId: "kit-1",
          fromValue: "kit-1",
          toValue: null,
        }),
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "asset-2",
          kitId: "kit-1",
        }),
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "asset-3",
          kitId: "kit-2",
          fromValue: "kit-2",
          toValue: null,
        }),
      ]),
      expect.anything()
    );
    expect(
      (recordEvents as ReturnType<typeof vitest.fn>).mock.calls[0][0]
    ).toHaveLength(3);
  });

  it("should not emit events when no kits have assets", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue([
      {
        id: "kit-1",
        name: "Kit 1",
        image: null,
        assetKits: [],
        custody: null,
      },
    ]);

    await bulkDeleteKits({
      kitIds: ["kit-1"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(recordEvents).not.toHaveBeenCalled();
  });
});

describe("bulkRemoveAssetsFromKits", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should emit ASSET_KIT_CHANGED for each asset that left a kit", async () => {
    expect.assertions(2);

    // Translated from main's PR #2535 to our pivot schema + Custody[] shape:
    //   - `kit` is now sourced via `assetKits: { select: { kit: {...} } }`
    //     and flattened in-memory.
    //   - `custody` is an array (Phase 2 made Custody 1:N on Asset).
    const assets = [
      {
        id: "asset-1",
        title: "Asset 1",
        assetKits: [{ kit: { id: "kit-1", name: "Kit 1", custody: null } }],
        custody: [],
      },
      {
        id: "asset-2",
        title: "Asset 2",
        assetKits: [{ kit: { id: "kit-2", name: "Kit 2", custody: null } }],
        custody: [],
      },
    ];
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue(assets);

    await bulkRemoveAssetsFromKits({
      assetIds: ["asset-1", "asset-2"],
      organizationId: "org-1",
      userId: "user-1",
      request: new Request("http://test.com"),
      // @ts-expect-error settings shape not relevant for this test
      settings: {},
    });

    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "asset-1",
          kitId: "kit-1",
          fromValue: "kit-1",
          toValue: null,
        }),
        expect.objectContaining({
          action: "ASSET_KIT_CHANGED",
          assetId: "asset-2",
          kitId: "kit-2",
          fromValue: "kit-2",
          toValue: null,
        }),
      ]),
      expect.anything()
    );
    expect(
      (recordEvents as ReturnType<typeof vitest.fn>).mock.calls[0][0]
    ).toHaveLength(2);
  });

  it("should emit CUSTODY_RELEASED for assets whose kit-inherited custody was cleaned up", async () => {
    expect.assertions(1);

    // Fixture shape:
    //   - `kit` sourced via `assetKits.kit` pivot relation.
    //   - `custody` is Custody[] with the kit-inherited row keyed on
    //     `kitCustodyId` (kit-vs-operator discriminator). The service
    //     filters by that key to avoid blowing away operator-assigned rows.
    const assets = [
      {
        id: "asset-1",
        title: "Asset 1",
        assetKits: [
          {
            kit: {
              id: "kit-1",
              name: "Kit 1",
              custody: { id: "kit-custody-1" },
            },
          },
        ],
        custody: [
          {
            id: "custody-1",
            teamMemberId: "tm-1",
            kitCustodyId: "kit-custody-1",
            custodian: {
              id: "tm-1",
              name: "Custodian",
              user: { id: "user-2", firstName: "C", lastName: "U" },
            },
          },
        ],
      },
    ];
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue(assets);

    await bulkRemoveAssetsFromKits({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      userId: "user-1",
      request: new Request("http://test.com"),
      // @ts-expect-error settings shape not relevant
      settings: {},
    });

    expect(recordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "asset-1",
          kitId: "kit-1",
          teamMemberId: "tm-1",
          targetUserId: "user-2",
          meta: { viaKit: true },
        }),
      ],
      expect.anything()
    );
  });
});

describe("bulkAssignKitCustody", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should assign custody to kits successfully", async () => {
    expect.assertions(3);
    const availableKits = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.AVAILABLE,
        assets: [
          {
            id: "asset-1",
            title: "Asset 1",
            status: AssetStatus.AVAILABLE,
            kit: { id: "kit-1", name: "Kit 1" },
          },
        ],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(availableKits);

    //@ts-expect-error missing vitest type
    db.teamMember.findFirst.mockResolvedValue({
      id: "custodian-1",
      name: "John Doe",
      user: { id: "user-1", firstName: "John", lastName: "Doe" },
    });

    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) =>
      // Execute the callback with a mock transaction object
      callback(db)
    );

    await bulkAssignKitCustody({
      allowedTeamMemberIds: "all" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      custodianId: "custodian-1",
      custodianName: "John Doe",
      userId: "user-1",
    });

    expect(db.kit.findMany).toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalled();

    // Verify the transaction was called
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it("should throw error when kits are not available", async () => {
    expect.assertions(1);
    const unavailableKits = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.IN_CUSTODY,
        assets: [],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(unavailableKits);

    await expect(
      bulkAssignKitCustody({
        allowedTeamMemberIds: "all" as const,
        kitIds: ["kit-1"],
        organizationId: "org-1",
        custodianId: "custodian-1",
        custodianName: "John Doe",
        userId: "user-1",
      })
    ).rejects.toThrow("There are some unavailable kits");
  });
});

describe("bulkReleaseKitCustody", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should release custody from kits successfully", async () => {
    expect.assertions(2);
    const kitsInCustody = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.IN_CUSTODY,
        custody: { id: "custody-1", custodian: { name: "John Doe" } },
        assets: [
          {
            id: "asset-1",
            title: "Asset 1",
            status: AssetStatus.IN_CUSTODY,
            custody: { id: "asset-custody-1" },
            kit: { id: "kit-1", name: "Kit 1" },
          },
        ],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsInCustody);

    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) =>
      // Execute the callback with a mock transaction object
      callback(db)
    );

    await bulkReleaseKitCustody({
      allowedTeamMemberIds: "all" as const,
      role: "ADMIN" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.kit.findMany).toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("should throw error when kits are not in custody", async () => {
    expect.assertions(1);
    const availableKits = [
      {
        id: "kit-1",
        status: KitStatus.AVAILABLE,
        custody: null,
        assets: [],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(availableKits);

    await expect(
      bulkReleaseKitCustody({
        allowedTeamMemberIds: "all" as const,
        role: "ADMIN" as const,
        kitIds: ["kit-1"],
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow("There are some kits which are not in custody");
  });

  it("refuses a SELF_SERVICE release of a colleague's custody, even via select-all", async () => {
    // The exploit this pins: the guard used to live in the route and queried
    // `kitCustody` with the RAW `kitIds`. On a select-all that is
    // `["all-selected"]`, which matches zero rows — so the guard passed and
    // every kit the where-clause resolved was released. Pairing it with
    // `?teamMember=<colleague>` aimed it at one person's kits, and because
    // those are all IN_CUSTODY by construction the "all kits in custody"
    // check passed too. `kit: custody` is a SELF_SERVICE permission.
    expect.assertions(2);

    // why: models what the where-clause RESOLVES to, which is the input the
    // guard has to judge — a colleague's kit, not the caller's.
    const colleaguesKits = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.IN_CUSTODY,
        custody: {
          id: "custody-1",
          custodian: { name: "Colleague", userId: "someone-else" },
        },
        assets: [],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(colleaguesKits);

    await expect(
      bulkReleaseKitCustody({
        allowedTeamMemberIds: "all" as const,
        role: "SELF_SERVICE" as const,
        kitIds: [ALL_SELECTED_KEY],
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow("Self user can release custody of themselves only");

    // Nothing was written.
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("allows a SELF_SERVICE release of custody the caller holds", async () => {
    expect.assertions(1);

    // why: same shape as above but held by the caller — proves the guard
    // rejects on ownership, not merely on the presence of a role.
    const ownKits = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.IN_CUSTODY,
        custody: {
          id: "custody-1",
          custodian: { name: "Me", userId: "user-1" },
        },
        assets: [],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(ownKits);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkReleaseKitCustody({
      allowedTeamMemberIds: "all" as const,
      role: "SELF_SERVICE" as const,
      kitIds: [ALL_SELECTED_KEY],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.$transaction).toHaveBeenCalled();
  });

  it("rejects an empty resolution instead of throwing a 500", async () => {
    // why: a refused custodian filter resolves to zero kits. Reading
    // `kits[0].custody` first turned that into a TypeError → 500, which is a
    // binary oracle for "does this custodian hold any kit".
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue([]);

    await expect(
      bulkReleaseKitCustody({
        allowedTeamMemberIds: "all" as const,
        role: "ADMIN" as const,
        kitIds: [ALL_SELECTED_KEY],
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow("None of the selected kits are available to release");
  });
});

describe("releaseCustody", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should release custody from single kit successfully", async () => {
    expect.assertions(2);
    const kitWithCustody = {
      id: "kit-1",
      name: "Test Kit",
      assetKits: [{ asset: { id: "asset-1", title: "Test Asset" } }],
      createdBy: { firstName: "John", lastName: "Doe" },
      custody: { custodian: { name: "Jane Smith" } },
    };
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(kitWithCustody);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(kitWithCustody);
    //@ts-expect-error missing vitest type
    db.asset.update.mockResolvedValue({});

    const result = await releaseCustody({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.kit.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      select: expect.any(Object),
    });
    // returned kit; preserve the original pivot rows alongside.
    expect(result).toEqual({
      ...kitWithCustody,
      assets: [{ id: "asset-1", title: "Test Asset" }],
    });
  });
});

describe("createKitsIfNotExists", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should create non-existing kits", async () => {
    expect.assertions(2);
    const importData = [
      { key: "asset-1", kit: "New Kit", title: "Asset 1" },
      { key: "asset-2", kit: "Existing Kit", title: "Asset 2" },
    ];

    db.kit.findFirst
      //@ts-expect-error missing vitest type
      .mockResolvedValueOnce(null) // New Kit doesn't exist
      .mockResolvedValueOnce({ id: "existing-kit-id", name: "Existing Kit" }); // Existing Kit exists

    //@ts-expect-error missing vitest type
    db.kit.create.mockResolvedValue({ id: "new-kit-id", name: "New Kit" });

    const result = await createKitsIfNotExists({
      data: importData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(db.kit.create).toHaveBeenCalledWith({
      data: {
        name: "New Kit",
        createdBy: { connect: { id: "user-1" } },
        organization: { connect: { id: "org-1" } },
      },
    });
    expect(result).toEqual({
      "New Kit": { id: "new-kit-id", name: "New Kit" },
      "Existing Kit": { id: "existing-kit-id", name: "Existing Kit" },
    });
  });

  it("should handle empty kit names", async () => {
    expect.assertions(1);
    const importData = [{ key: "asset-1", kit: "", title: "Asset 1" }];

    const result = await createKitsIfNotExists({
      data: importData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toEqual({});
  });
});

describe("updateKitQrCode", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should update kit QR code successfully", async () => {
    expect.assertions(2);
    const updatedKit = { ...mockKitData, qrCodes: [{ id: "new-qr-id" }] };
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(updatedKit);

    const result = await updateKitQrCode({
      kitId: "kit-1",
      newQrId: "new-qr-id",
      organizationId: "org-1",
    });

    expect(db.kit.update).toHaveBeenCalledTimes(2); // Once to disconnect, once to connect
    expect(result).toEqual(updatedKit);
  });
});

describe("relinkKitQrCode", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should relink qr code to kit", async () => {
    expect.assertions(3);
    //@ts-expect-error missing vitest type
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    });
    //@ts-expect-error missing vitest type
    db.kit.findFirst.mockResolvedValue({ qrCodes: [{ id: "old-qr-id" }] });
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue({});

    const result = await relinkKitQrCode({
      qrId: "qr-1",
      kitId: "kit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.qr.update).toHaveBeenCalledWith({
      where: { id: "qr-1" },
      data: { organizationId: "org-1", userId: "user-1" },
    });
    expect(db.kit.update).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ oldQrCodeId: "old-qr-id", newQrId: "qr-1" });
  });

  it("should throw when qr code belongs to another asset", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    getQr.mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-1",
      kitId: null,
    });
    //@ts-expect-error missing vitest type
    db.kit.findFirst.mockResolvedValue({ qrCodes: [] });

    await expect(
      relinkKitQrCode({
        qrId: "qr-1",
        kitId: "kit-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });
});

describe("getAvailableKitAssetForBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return asset IDs from selected kits", async () => {
    expect.assertions(2);
    const kitsWithAssets = [
      {
        assetKits: [
          { asset: { id: "asset-1", status: AssetStatus.AVAILABLE } },
          { asset: { id: "asset-2", status: AssetStatus.IN_CUSTODY } },
        ],
      },
      {
        assetKits: [
          { asset: { id: "asset-3", status: AssetStatus.AVAILABLE } },
        ],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsWithAssets);

    const result = await getAvailableKitAssetForBooking(
      ["kit-1", "kit-2"],
      "org-1"
    );

    expect(db.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
      select: {
        assetKits: {
          select: { asset: { select: { id: true, status: true } } },
        },
      },
    });
    expect(result).toEqual(["asset-1", "asset-2", "asset-3"]);
  });
});

describe("updateKitsWithBookingCustodians", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return non-checked-out kits unchanged", async () => {
    expect.assertions(1);
    const kits = [
      { ...mockKitData, locationId: null, status: KitStatus.AVAILABLE },
      {
        ...mockKitData,
        locationId: null,
        id: "kit-2",
        status: KitStatus.IN_CUSTODY,
      },
    ];

    const result = await updateKitsWithBookingCustodians(kits);

    expect(result).toEqual(kits);
  });

  it("should resolve custodian from booking for checked-out kit", async () => {
    expect.assertions(2);
    const kits = [
      {
        ...mockKitData,
        locationId: null,
        id: "kit-co",
        status: KitStatus.CHECKED_OUT,
      },
    ];

    // why: simulating asset with active booking and custodian user
    //@ts-expect-error missing vitest type
    db.asset.findFirst.mockResolvedValue({
      id: "asset-1",
      bookingAssets: [
        {
          booking: {
            id: "booking-1",
            custodianTeamMember: null,
            custodianUser: {
              firstName: "Jane",
              lastName: "Doe",
              profilePicture: "pic.jpg",
            },
          },
        },
      ],
    });

    const result = await updateKitsWithBookingCustodians(kits);

    expect((result[0] as any).custody).toEqual({
      custodian: {
        name: "Jane Doe",
        user: {
          firstName: "Jane",
          lastName: "Doe",
          profilePicture: "pic.jpg",
        },
      },
    });
    expect(db.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetKits: { some: { kitId: "kit-co" } },
          bookingAssets: {
            some: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
          },
        }),
      })
    );
  });

  it("should resolve custodian from team member when no user", async () => {
    expect.assertions(1);
    const kits = [
      {
        ...mockKitData,
        locationId: null,
        id: "kit-co",
        status: KitStatus.CHECKED_OUT,
      },
    ];

    // why: simulating booking with team member custodian instead of user
    //@ts-expect-error missing vitest type
    db.asset.findFirst.mockResolvedValue({
      id: "asset-1",
      bookingAssets: [
        {
          booking: {
            id: "booking-1",
            custodianTeamMember: { name: "External Contractor" },
            custodianUser: null,
          },
        },
      ],
    });

    const result = await updateKitsWithBookingCustodians(kits);

    expect((result[0] as any).custody).toEqual({
      custodian: { name: "External Contractor" },
    });
  });

  it("should handle kit with no asset having active booking gracefully", async () => {
    expect.assertions(2);
    const kits = [
      {
        ...mockKitData,
        locationId: null,
        id: "kit-co",
        status: KitStatus.CHECKED_OUT,
      },
    ];

    // why: reproducing the Sentry error scenario where findFirst returns null
    // because no asset in the kit has an ONGOING/OVERDUE booking
    //@ts-expect-error missing vitest type
    db.asset.findFirst.mockResolvedValue(null);

    const result = await updateKitsWithBookingCustodians(kits);

    // Kit should be returned as-is without custody data
    expect(result[0]).toEqual(kits[0]);
    // Should not throw
    expect(result).toHaveLength(1);
  });
});

describe("updateKitAssets - Location Cascade", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("writes the AssetKit pivot but never touches AssetLocation, regardless of kit's location", async () => {
    // why: per the orthogonal-axes model in `docs/proposals/quantitative-assets.md`
    // (lines 783-794), kit membership and physical location are independent.
    // Adding an asset to a kit writes the AssetKit pivot only — the asset's
    // existing AssetLocation rows are unchanged, and no kit-driven row is
    // synthesised at the kit's location. The previous behaviour conflated
    // both axes and broke "add a fully-placed asset to a kit" because the
    // sum-within-total trigger summed manual + kit-driven rows together.
    expect.assertions(4);

    const mockKit = {
      id: "kit-1",
      location: { id: "location-1", name: "Warehouse A" },
      assetKits: [],
      custody: null,
    };

    // Asset is currently placed at "manual-location-1" by the user.
    // The cascade must NOT touch this manual row.
    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        assetKits: [],
        custody: null,
        assetLocations: [
          { location: { id: "manual-location-1", name: "Office A" } },
        ],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(mockKit);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue(mockNewAssets);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["asset-1"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // AssetKit row is created for the new membership.
    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-1",
          kitId: "kit-1",
          organizationId: "org-1",
          quantity: 1,
        },
      ],
    });

    // Invariant: AssetLocation is on a separate axis — no writes from the
    // kit-membership path. The mock exposes `createMany` / `updateMany` /
    // `deleteMany`; any kit-cascade-to-AssetLocation regression would land
    // on one of them.
    expect(db.assetLocation.createMany).not.toHaveBeenCalled();
    expect(db.assetLocation.updateMany).not.toHaveBeenCalled();
    expect(db.assetLocation.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * Track T2 — Kit ↔ Qty-Tracked Custody Correctness Fixes.
 *
 * These describes lock in the contract that kit-allocated Custody rows are:
 *  - tagged with `kitCustodyId` so they can be filtered separately from
 *    operator-assigned per-unit custody on the same asset;
 *  - threaded with `quantity` from the asset for QUANTITY_TRACKED assets
 *    (defaulting to 1 for INDIVIDUAL); and
 *  - released with the cascade-driven path (event-emit-before-delete) so
 *    the audit trail still fires even though the explicit
 *    `tx.custody.deleteMany` is gone.
 */
describe("updateKitAssets - kit-allocated custody threading", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("threads quantity + kitCustodyId per asset when inheriting kit custody", async () => {
    expect.assertions(3);

    /** Kit with active custody so newly added assets inherit it. */
    const mockKit = {
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: {
        id: "kc-1",
        custodian: {
          id: "tm-1",
          name: "Alice",
          user: {
            id: "user-9",
            email: "alice@example.com",
            firstName: "Alice",
            lastName: "Example",
            displayName: "Alice",
            profilePicture: null,
          },
        },
      },
    };

    /** One INDIVIDUAL + one QUANTITY_TRACKED asset, both new to the kit.
     * `buildKitCustodyInheritData` reads `assetKits[].quantity` per kit.
     * In production these rows are created earlier in `updateKitAssets`'s
     * tx via `assetKit.createMany`; the fixture pre-populates them at the
     * kit's expected slice (the asset's full pool — today's default
     * "kit owns the whole asset" semantics). */
    const mockNewAssets = [
      {
        id: "asset-individual",
        title: "Single",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        assetKits: [{ quantity: 1 }],
        custody: [],
        location: null,
      },
      {
        id: "asset-qty",
        title: "Batch of 50",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
        assetKits: [{ quantity: 50 }],
        custody: [],
        location: null,
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(mockKit);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue(mockNewAssets);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["asset-individual", "asset-qty"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // Inherited custody is created via createMany with the helper-built shape:
    // INDIVIDUAL -> quantity 1, QUANTITY_TRACKED -> asset.quantity, both
    // tagged with the kit's KitCustody.id.
    expect(db.custody.createMany).toHaveBeenCalledWith({
      data: [
        {
          teamMemberId: "tm-1",
          assetId: "asset-individual",
          kitCustodyId: "kc-1",
          quantity: 1,
        },
        {
          teamMemberId: "tm-1",
          assetId: "asset-qty",
          kitCustodyId: "kc-1",
          quantity: 50,
        },
      ],
    });

    // Asset status flipped to IN_CUSTODY for the inherited assets.
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-individual", "asset-qty"] },
        organizationId: "org-1",
      },
      data: { status: AssetStatus.IN_CUSTODY },
    });

    // Activity events emitted with quantity + viaKit in meta.
    const { recordEvents } = await import(
      "~/modules/activity-event/service.server"
    );
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_ASSIGNED",
          assetId: "asset-individual",
          teamMemberId: "tm-1",
          meta: expect.objectContaining({ viaKit: true, quantity: 1 }),
        }),
        expect.objectContaining({
          action: "CUSTODY_ASSIGNED",
          assetId: "asset-qty",
          teamMemberId: "tm-1",
          meta: expect.objectContaining({ viaKit: true, quantity: 50 }),
        }),
      ]),
      expect.anything()
    );
  });

  it("filters asset-removal deleteMany by kitCustodyId so operator custody survives", async () => {
    expect.assertions(2);

    /** Kit has custody. We are removing one asset from the kit. */
    const mockKit = {
      id: "kit-1",
      location: null,
      // row carries the kitId (denormalised) so the production code can
      // map `asset.assetKits[0]?.kitId`.
      assetKits: [
        {
          kitId: "kit-1",
          asset: {
            id: "asset-1",
            title: "Existing",
            assetKits: [{ kitId: "kit-1" }],
            bookingAssets: [],
          },
        },
      ],
      custody: {
        id: "kc-1",
        custodian: {
          id: "tm-1",
          name: "Alice",
          user: {
            id: "user-9",
            email: "alice@example.com",
            firstName: "Alice",
            lastName: "Example",
            displayName: "Alice",
            profilePicture: null,
          },
        },
      },
    };

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(mockKit);
    // No assets in the new list -> the existing asset is removed.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([]);
    // Pretend the kit-allocated custody existed before the deleteMany.
    (db.custody.findMany as ReturnType<typeof vitest.fn>)
      // First findMany (capture rows about to be deleted)
      .mockResolvedValueOnce([{ assetId: "asset-1", teamMemberId: "tm-1" }])
      // Second findMany (still-custodied check after delete) -> empty
      .mockResolvedValueOnce([]);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: [], // removing asset-1
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // The deleteMany on Custody is filtered by both assetId AND kitCustodyId
    // so operator-assigned per-unit custody on the same asset stays.
    expect(db.custody.deleteMany).toHaveBeenCalledWith({
      where: {
        assetId: { in: ["asset-1"] },
        kitCustodyId: "kc-1",
      },
    });

    // Event emitted before deletion.
    const { recordEvents } = await import(
      "~/modules/activity-event/service.server"
    );
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "asset-1",
          teamMemberId: "tm-1",
          meta: expect.objectContaining({ viaKit: true }),
        }),
      ]),
      expect.anything()
    );
  });
});

describe("bulkAssignKitCustody - kit-allocated custody threading", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("threads quantity + kitCustodyId for mixed individual + qty assets", async () => {
    expect.assertions(2);

    // flattens `{...asset, kit: {id, name}}` from the parent kit; the mock
    // therefore omits `kit` on each inner asset.
    const availableKits = [
      {
        id: "kit-1",
        name: "Mixed Kit",
        status: KitStatus.AVAILABLE,
        assetKits: [
          {
            asset: {
              id: "asset-individual",
              title: "Single",
              status: AssetStatus.AVAILABLE,
              type: AssetType.INDIVIDUAL,
              quantity: null,
            },
          },
          {
            asset: {
              id: "asset-qty",
              title: "Batch of 50",
              status: AssetStatus.AVAILABLE,
              type: AssetType.QUANTITY_TRACKED,
              quantity: 50,
            },
          },
        ],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(availableKits);
    //@ts-expect-error missing vitest type
    db.teamMember.findUnique.mockResolvedValue({
      id: "tm-1",
      name: "Alice",
      user: { id: "user-9", firstName: "Alice", lastName: "Example" },
    });
    //@ts-expect-error missing vitest type
    db.kitCustody.findMany.mockResolvedValue([
      { id: "kc-new", kitId: "kit-1" },
    ]);
    // why: helper now does its own asset.findMany inside the tx and reads
    // the kit's slice from `assetKits[].quantity`. Pre-populate that
    // with the asset's full pool to mirror the post-migration backfill
    // state (kit owns the whole asset).
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-individual",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        custody: [],
        assetKits: [{ quantity: 1 }],
      },
      {
        id: "asset-qty",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
        custody: [],
        assetKits: [{ quantity: 50 }],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkAssignKitCustody({
      allowedTeamMemberIds: "all" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      custodianId: "tm-1",
      custodianName: "Alice",
      userId: "user-1",
    });

    expect(db.custody.createMany).toHaveBeenCalledWith({
      data: [
        {
          teamMemberId: "tm-1",
          assetId: "asset-individual",
          kitCustodyId: "kc-new",
          quantity: 1,
        },
        {
          teamMemberId: "tm-1",
          assetId: "asset-qty",
          kitCustodyId: "kc-new",
          quantity: 50,
        },
      ],
    });

    const { recordEvents } = await import(
      "~/modules/activity-event/service.server"
    );
    // INDIVIDUAL assets carry no `quantity` in the event meta (assetQtyMeta
    // returns {} for them); only QUANTITY_TRACKED surface a unit count.
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_ASSIGNED",
          assetId: "asset-individual",
          meta: { viaKit: true },
        }),
        expect.objectContaining({
          action: "CUSTODY_ASSIGNED",
          assetId: "asset-qty",
          meta: expect.objectContaining({ viaKit: true, quantity: 50 }),
        }),
      ]),
      expect.anything()
    );
  });

  it("subtracts already-allocated custody from kit row's quantity (Option B)", async () => {
    expect.assertions(1);

    /** Pens has 80 units total; 4 already with operator Pleb. Kit assigned to
     * Nikolay should claim only the remaining 76, not 80. INDIVIDUAL Drill
     * always gets 1. */
    const availableKits = [
      {
        id: "kit-1",
        name: "Camera Kit",
        status: KitStatus.AVAILABLE,
        assetKits: [
          {
            asset: {
              id: "drill",
              title: "Drill",
              status: AssetStatus.AVAILABLE,
              type: AssetType.INDIVIDUAL,
              quantity: null,
            },
          },
          {
            asset: {
              id: "pens",
              title: "Pens",
              // Qty-tracked with 76 of 80 free — status stays AVAILABLE
              // because there are units the kit can claim. Status flips to
              // IN_CUSTODY only once the kit assignment writes its row.
              status: AssetStatus.AVAILABLE,
              type: AssetType.QUANTITY_TRACKED,
              quantity: 80,
            },
          },
        ],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(availableKits);
    //@ts-expect-error missing vitest type
    db.teamMember.findUnique.mockResolvedValue({
      id: "tm-nikolay",
      name: "Nikolay",
      user: { id: "user-niko", firstName: "Nikolay", lastName: "Bonev" },
    });
    //@ts-expect-error missing vitest type
    db.kitCustody.findMany.mockResolvedValue([
      { id: "kc-new", kitId: "kit-1" },
    ]);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "drill",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        custody: [],
        assetKits: [{ quantity: 1 }],
      },
      {
        id: "pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 80,
        // 4 of 80 already operator-allocated. AssetKit.quantity = 80
        // (kit owns the full pool post-migration backfill). Helper's
        // strict cap caps the kit-Custody at `Asset.quantity − operator`
        // = 76, even though the kit's pivot row says 80. This protects
        // against over-allocation during the transition before the
        // picker enforces strict non-overlap.
        custody: [{ quantity: 4 }],
        assetKits: [{ quantity: 80 }],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkAssignKitCustody({
      allowedTeamMemberIds: "all" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      custodianId: "tm-nikolay",
      custodianName: "Nikolay",
      userId: "user-niko",
    });

    expect(db.custody.createMany).toHaveBeenCalledWith({
      data: [
        {
          teamMemberId: "tm-nikolay",
          assetId: "drill",
          kitCustodyId: "kc-new",
          quantity: 1,
        },
        {
          teamMemberId: "tm-nikolay",
          assetId: "pens",
          kitCustodyId: "kc-new",
          quantity: 76,
        },
      ],
    });
  });

  it("skips fully-allocated qty-tracked assets (remaining <= 0)", async () => {
    expect.assertions(1);

    const availableKits = [
      {
        id: "kit-1",
        name: "Stationery Kit",
        status: KitStatus.AVAILABLE,
        assetKits: [
          {
            asset: {
              id: "drill",
              title: "Drill",
              status: AssetStatus.AVAILABLE,
              type: AssetType.INDIVIDUAL,
              quantity: null,
            },
          },
          {
            asset: {
              id: "pens",
              title: "Pens (fully allocated)",
              // Status would in reality be IN_CUSTODY once all units are
              // operator-allocated, but this test exercises the helper-level
              // "skip when remaining <= 0" branch — the bulkAssign guard
              // runs before the helper does, so we keep AVAILABLE here to
              // bypass it and verify the helper still skips Pens because
              // custody adds to 80 of 80.
              status: AssetStatus.AVAILABLE,
              type: AssetType.QUANTITY_TRACKED,
              quantity: 80,
            },
          },
        ],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(availableKits);
    //@ts-expect-error missing vitest type
    db.teamMember.findUnique.mockResolvedValue({
      id: "tm-1",
      name: "Alice",
      user: { id: "user-1", firstName: "Alice", lastName: "Example" },
    });
    //@ts-expect-error missing vitest type
    db.kitCustody.findMany.mockResolvedValue([
      { id: "kc-new", kitId: "kit-1" },
    ]);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      { id: "drill", type: AssetType.INDIVIDUAL, quantity: null, custody: [] },
      {
        id: "pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 80,
        // All 80 already with two operators (50 + 30) → remaining 0 → skip.
        custody: [{ quantity: 50 }, { quantity: 30 }],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkAssignKitCustody({
      allowedTeamMemberIds: "all" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      custodianId: "tm-1",
      custodianName: "Alice",
      userId: "user-1",
    });

    // Only Drill row gets created; Pens is skipped entirely.
    expect(db.custody.createMany).toHaveBeenCalledWith({
      data: [
        {
          teamMemberId: "tm-1",
          assetId: "drill",
          kitCustodyId: "kc-new",
          quantity: 1,
        },
      ],
    });
  });
});

describe("bulkReleaseKitCustody - emit-before-cascade", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits CUSTODY_RELEASED events BEFORE kitCustody.deleteMany and skips explicit custody.deleteMany", async () => {
    expect.assertions(3);

    const kitsInCustody = [
      {
        id: "kit-1",
        status: KitStatus.IN_CUSTODY,
        custody: {
          id: "kc-1",
          custodian: {
            id: "tm-1",
            name: "Alice",
            user: { id: "user-9" },
          },
        },
        assets: [
          {
            id: "asset-1",
            status: AssetStatus.IN_CUSTODY,
            title: "Asset 1",
            custody: [{ id: "custody-1" }],
            kit: { id: "kit-1", name: "Kit 1" },
          },
        ],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsInCustody);
    //@ts-expect-error missing vitest type
    db.kitCustody.findMany.mockResolvedValue([
      { id: "kc-1", kitId: "kit-1", custodianId: "tm-1" },
    ]);
    (db.custody.findMany as ReturnType<typeof vitest.fn>)
      // First call: capture released rows
      .mockResolvedValueOnce([
        {
          assetId: "asset-1",
          teamMemberId: "tm-1",
          kitCustodyId: "kc-1",
        },
      ])
      // Second call: still-custodied check after cascade (none)
      .mockResolvedValueOnce([]);

    const { recordEvents } = await import(
      "~/modules/activity-event/service.server"
    );
    const callOrder: string[] = [];
    (recordEvents as ReturnType<typeof vitest.fn>).mockImplementation(() => {
      callOrder.push("recordEvents");
      return Promise.resolve();
    });
    (
      db.kitCustody.deleteMany as ReturnType<typeof vitest.fn>
    ).mockImplementation(() => {
      callOrder.push("kitCustody.deleteMany");
      return Promise.resolve({ count: 1 });
    });

    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkReleaseKitCustody({
      allowedTeamMemberIds: "all" as const,
      role: "ADMIN" as const,
      kitIds: ["kit-1"],
      organizationId: "org-1",
      userId: "user-1",
    });

    // Event emission happens before the cascade fires.
    expect(callOrder.indexOf("recordEvents")).toBeLessThan(
      callOrder.indexOf("kitCustody.deleteMany")
    );

    // The explicit per-asset `custody.deleteMany({ where: { assetId: { in: ... } } })`
    // is gone — cascade does the cleanup.
    const allDeleteCalls = (
      db.custody.deleteMany as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls;
    const broadAssetIdDelete = allDeleteCalls.find((args) => {
      const where = (args[0] as { where?: { assetId?: { in?: string[] } } })
        ?.where;
      return (
        Boolean(where?.assetId?.in?.includes("asset-1")) &&
        !(where as { kitCustodyId?: string }).kitCustodyId
      );
    });
    expect(broadAssetIdDelete).toBeUndefined();

    // Released event was emitted with viaKit + correct asset.
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "asset-1",
          teamMemberId: "tm-1",
          meta: expect.objectContaining({ viaKit: true }),
        }),
      ]),
      expect.anything()
    );
  });
});

describe("releaseCustody (single kit) - emit-before-cascade", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("emits CUSTODY_RELEASED events for kit-allocated rows before the cascade and skips the broad custody.deleteMany", async () => {
    expect.assertions(2);

    const kitWithCustody = {
      id: "kit-1",
      name: "Test Kit",
      assets: [{ id: "asset-1", title: "Test Asset" }],
      createdBy: { firstName: "John", lastName: "Doe" },
      custody: {
        id: "kc-1",
        custodian: {
          id: "tm-1",
          name: "Jane Smith",
          user: { id: "user-9" },
        },
      },
    };

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(kitWithCustody);
    //@ts-expect-error missing vitest type
    db.kit.update.mockResolvedValue(kitWithCustody);
    (db.custody.findMany as ReturnType<typeof vitest.fn>)
      // First call: rows about to be cascade-deleted
      .mockResolvedValueOnce([
        {
          assetId: "asset-1",
          teamMemberId: "tm-1",
          kitCustodyId: "kc-1",
        },
      ])
      // Second call: still-custodied check (none)
      .mockResolvedValueOnce([]);

    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await releaseCustody({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    const { recordEvents } = await import(
      "~/modules/activity-event/service.server"
    );

    // Event emitted with the right assetId + viaKit.
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_RELEASED",
          assetId: "asset-1",
          teamMemberId: "tm-1",
          meta: expect.objectContaining({ viaKit: true }),
        }),
      ]),
      expect.anything()
    );

    // No broad `tx.custody.deleteMany({ where: { assetId: { in: [...] } } })` —
    // cascade handles the cleanup now.
    const allDeleteCalls = (
      db.custody.deleteMany as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls;
    expect(allDeleteCalls).toHaveLength(0);
  });
});

/**
 * Kit manage-assets picker contract.
 *
 * These describes lock in the contract between the picker action and
 * `updateKitAssets`:
 *  - The action passes `assetQuantities` through to the service.
 *  - The service writes per-asset quantity into `AssetKit.quantity` on
 *    create AND on update of an existing pivot row.
 *  - The service rejects oversubscribed submissions with a clean 400
 *    rather than letting the DEFERRED constraint trigger surface as a
 *    generic 500. Strict-available math mirrors the loader formula:
 *      space = Asset.quantity − other kits − operator-only Custody −
 *              ongoing BookingAsset; max = max(current, space).
 */
describe("updateKitAssets - per-row qty submission", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("writes the submitted quantity into AssetKit on new add for qty-tracked", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: null,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "pens",
        title: "Pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 100,
        assetKits: [],
        custody: [],
        bookingAssets: [],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["pens"],
      assetQuantities: { pens: 60 },
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "pens",
          kitId: "kit-1",
          organizationId: "org-1",
          quantity: 60,
        },
      ],
    });
  });

  it("updates AssetKit.quantity for an existing-in-kit qty-tracked row", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
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
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
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

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["pens"],
      assetQuantities: { pens: 80 },
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // Pivot row already exists — no createMany call for this asset.
    expect(db.assetKit.createMany).not.toHaveBeenCalled();
    // The per-row update lands with the new value.
    expect(db.assetKit.update).toHaveBeenCalledWith({
      where: { assetId_kitId: { assetId: "pens", kitId: "kit-1" } },
      data: { quantity: 80 },
    });
  });

  it("ignores assetQuantities for INDIVIDUAL — always writes quantity = 1", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: null,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "drill",
        title: "Drill",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        assetKits: [],
        custody: [],
        bookingAssets: [],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["drill"],
      // A tampered client may submit a qty for an INDIVIDUAL row — the
      // service should coerce to 1 regardless.
      assetQuantities: { drill: 5 },
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "drill",
          kitId: "kit-1",
          organizationId: "org-1",
          quantity: 1,
        },
      ],
    });
  });
});

describe("updateKitAssets - check-in floor guard (Polish-7b)", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * Sets up an existing-in-kit qty-tracked asset (Pens, AssetKit qty 60)
   * with one kit-driven BookingAsset slice that has `checkedIn` units
   * already reconciled against it. The test then submits a new kit
   * quantity to exercise the floor guard.
   */
  function setupFloorGuard(checkedIn: number) {
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
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
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
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
    // aksToSync — the AssetKit row whose quantity is being changed.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      { id: "ak-pens", assetId: "pens", quantity: 60 },
    ]);
    // One kit-driven BookingAsset slice for this AssetKit.
    //@ts-expect-error missing vitest type
    db.bookingAsset.findMany.mockResolvedValue([
      {
        id: "ba-1",
        assetKitId: "ak-pens",
        asset: { title: "Pens" },
        booking: { name: "Spring Shoot" },
      },
    ]);
    // `checkedIn` units already reconciled against that slice.
    //@ts-expect-error missing vitest type
    db.consumptionLog.groupBy.mockResolvedValue([
      { bookingAssetId: "ba-1", _sum: { quantity: checkedIn } },
    ]);
  }

  it("blocks shrinking a kit slice below units already checked in", async () => {
    expect.assertions(2);

    setupFloorGuard(40); // 40 already checked in on the slice

    const { updateKitAssets } = await import("./service.server");

    await expect(
      updateKitAssets({
        kitId: "kit-1",
        assetIds: ["pens"],
        assetQuantities: { pens: 30 }, // 30 < 40 → must block
        userId: "user-1",
        organizationId: "org-1",
        request: new Request("http://test.com"),
      })
    ).rejects.toThrow(/already checked in/i);

    // The live-link qty sync must NOT run when the guard trips.
    expect(db.bookingAsset.updateMany).not.toHaveBeenCalled();
  });

  it("allows shrinking down to (not below) the checked-in floor", async () => {
    expect.assertions(1);

    setupFloorGuard(40);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["pens"],
      assetQuantities: { pens: 40 }, // 40 == floor → allowed
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.bookingAsset.updateMany).toHaveBeenCalledWith({
      where: { assetKitId: "ak-pens" },
      data: { quantity: 40 },
    });
  });
});

describe("updateKitAssets - server-side strict-available validation", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("rejects with 400 when submitted qty exceeds the strict-available pool", async () => {
    expect.assertions(2);

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: null,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "pens",
        title: "Pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 100,
        // Other kit holds 40, operator Pleb holds 20, ongoing booking 10.
        // Strict-available space = 100 - 40 - 20 - 10 = 30.
        assetKits: [{ kitId: "other-kit", quantity: 40 }],
        custody: [{ quantity: 20, kitCustodyId: null }],
        bookingAssets: [{ quantity: 10 }],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");

    await expect(
      updateKitAssets({
        kitId: "kit-1",
        assetIds: ["pens"],
        // Way over the 30-unit ceiling.
        assetQuantities: { pens: 80 },
        userId: "user-1",
        organizationId: "org-1",
        request: new Request("http://test.com"),
      })
    ).rejects.toMatchObject({
      title: "Quantity exceeds available pool",
      status: 400,
    });

    // No pivot writes happened — validation throws before the tx.
    expect(db.assetKit.createMany).not.toHaveBeenCalled();
  });

  it("accepts a submission at the strict-available ceiling", async () => {
    expect.assertions(1);

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: null,
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "pens",
        title: "Pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 100,
        assetKits: [{ kitId: "other-kit", quantity: 40 }],
        custody: [{ quantity: 20, kitCustodyId: null }],
        bookingAssets: [{ quantity: 10 }],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["pens"],
      // Exactly the ceiling.
      assetQuantities: { pens: 30 },
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ assetId: "pens", quantity: 30 }),
      ]),
    });
  });

  it("excludes kit-allocated Custody rows from operator-only count", async () => {
    expect.assertions(1);

    // Pens 100, this kit holds 60 (with materialised Custody=60), other
    // kit holds 30 (with materialised Custody=30), operator Pleb 10.
    //   sum custody = 60 + 30 + 10 = 100
    //   operator-only custody = 10 (Pleb)
    //   other-kit AssetKit = 30
    //   space (this kit) = 100 - 30 - 10 - 0 = 60
    //   max = max(60, 60) = 60 → growing to 60 should be accepted.
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-this",
      location: null,
      assetKits: [
        {
          kitId: "kit-this",
          asset: {
            id: "pens",
            title: "Pens",
            assetKits: [{ kitId: "kit-this" }, { kitId: "kit-other" }],
            bookingAssets: [],
          },
        },
      ],
      custody: {
        id: "kc-this",
        custodian: {
          id: "tm-1",
          name: "Alice",
          user: null,
        },
      },
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "pens",
        title: "Pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 100,
        assetKits: [
          { kitId: "kit-this", quantity: 60 },
          { kitId: "kit-other", quantity: 30 },
        ],
        custody: [
          { quantity: 60, kitCustodyId: "kc-this" },
          { quantity: 30, kitCustodyId: "kc-other" },
          { quantity: 10, kitCustodyId: null },
        ],
        bookingAssets: [],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");

    // Submitting 60 (no change). If the filter were wrong and counted
    // all 100 custody units as operator-only, max would be 0 and this
    // would throw. With the correct filter, max = 60 and this passes.
    await expect(
      updateKitAssets({
        kitId: "kit-this",
        assetIds: ["pens"],
        assetQuantities: { pens: 60 },
        userId: "user-1",
        organizationId: "org-1",
        request: new Request("http://test.com"),
      })
    ).resolves.not.toThrow();
  });
});

describe("moveAssetKitUnits", () => {
  // Typed handles for the mocks we drive directly.
  const mockLock = lockAssetForQuantityUpdate as ReturnType<typeof vitest.fn>;
  const mockRecordEvents = recordEvents as ReturnType<typeof vitest.fn>;
  const mockKitFindFirst = db.kit.findFirst as ReturnType<typeof vitest.fn>;
  const mockAssetFindMany = db.asset.findMany as ReturnType<typeof vitest.fn>;
  const mockAssetKitFindFirst = db.assetKit.findFirst as ReturnType<
    typeof vitest.fn
  >;
  const mockAssetKitUpdate = db.assetKit.update as ReturnType<typeof vitest.fn>;
  const mockAssetKitDelete = db.assetKit.delete as ReturnType<typeof vitest.fn>;
  const mockAssetKitUpsert = db.assetKit.upsert as ReturnType<typeof vitest.fn>;
  const mockBookingAssetFindMany = db.bookingAsset.findMany as ReturnType<
    typeof vitest.fn
  >;
  const mockBookingAssetUpdateMany = db.bookingAsset.updateMany as ReturnType<
    typeof vitest.fn
  >;
  const mockCustodyFindFirst = db.custody.findFirst as ReturnType<
    typeof vitest.fn
  >;

  /** Realistic QUANTITY_TRACKED locked asset stub. */
  const lockedAsset = {
    id: "asset-1",
    title: "USB-C Cables",
    organizationId: "org-1",
    type: AssetType.QUANTITY_TRACKED,
    quantity: 100,
    unitOfMeasure: "boxes",
  };

  const baseArgs = {
    assetId: "asset-1",
    organizationId: "org-1",
    userId: "user-1",
    fromKitId: "kit-from",
    toKitId: "kit-to",
    quantity: 10,
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    mockLock.mockResolvedValue(lockedAsset);
    // why: `assertAssetsBelongToOrg` runs `db.asset.findMany` with
    // `{ id: { in: [assetId] }, organizationId }`. Echo the input so
    // the guard passes by default.
    mockAssetFindMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id })))
    );
    // Default: both source + destination kits resolve in the org with
    // a synthetic name based on the id.
    mockKitFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({ id: where.id, name: where.id })
    );
    // Default: source AssetKit has 50 units allocated; tests override
    // when they need a different starting state.
    mockAssetKitFindFirst.mockResolvedValue({ id: "ak-src", quantity: 50 });
    // Default upsert result — destination has accumulated `dest.quantity`
    // after the move. Tests that care assert against the actual value.
    mockAssetKitUpsert.mockResolvedValue({ id: "ak-dst", quantity: 10 });
    // No active bookings on source or operator custody by default.
    mockBookingAssetFindMany.mockResolvedValue([]);
    mockCustodyFindFirst.mockResolvedValue(null);
  });

  it("moves 10 of 50 units to a fresh destination kit", async () => {
    mockAssetKitFindFirst.mockResolvedValue({ id: "ak-src", quantity: 50 });
    mockAssetKitUpsert.mockResolvedValue({ id: "ak-dst", quantity: 10 });

    const result = await moveAssetKitUnits(baseArgs);

    expect(result.fromQuantity).toBe(40);
    expect(result.toQuantity).toBe(10);
    expect(result.sourceRowDeleted).toBe(false);
    expect(result.moveCorrelationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Source decremented (not deleted) — 50 - 10 = 40.
    expect(mockAssetKitUpdate).toHaveBeenCalledWith({
      where: { id: "ak-src" },
      data: { quantity: 40 },
    });
    expect(mockAssetKitDelete).not.toHaveBeenCalled();
    // Destination upserted on the (assetId, kitId) partial unique.
    expect(mockAssetKitUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId_kitId: { assetId: "asset-1", kitId: "kit-to" } },
        create: expect.objectContaining({ quantity: 10 }),
        update: { quantity: { increment: 10 } },
      })
    );
  });

  it("deletes the source AssetKit row when the move exhausts it", async () => {
    // Source allocation matches move quantity exactly — row should be
    // deleted to keep reads clean.
    mockAssetKitFindFirst.mockResolvedValue({ id: "ak-src", quantity: 10 });
    mockAssetKitUpsert.mockResolvedValue({ id: "ak-dst", quantity: 10 });

    const result = await moveAssetKitUnits(baseArgs);

    expect(result.fromQuantity).toBe(0);
    expect(result.sourceRowDeleted).toBe(true);
    expect(mockAssetKitDelete).toHaveBeenCalledWith({
      where: { id: "ak-src" },
    });
    expect(mockAssetKitUpdate).not.toHaveBeenCalled();
  });

  it("cascades the new dest qty to active BookingAsset slices on the destination kit", async () => {
    mockAssetKitUpsert.mockResolvedValue({ id: "ak-dst", quantity: 15 });

    await moveAssetKitUnits(baseArgs);

    // The cascade keeps active kit-driven BookingAsset slices on the
    // DEST kit in sync with the new allocation. Verify the where-shape
    // filters to active statuses, and the data sets the slice qty to
    // the upserted dest quantity (NOT the move quantity).
    expect(mockBookingAssetUpdateMany).toHaveBeenCalledWith({
      where: {
        assetKitId: "ak-dst",
        booking: {
          status: {
            in: [
              BookingStatus.DRAFT,
              BookingStatus.RESERVED,
              BookingStatus.ONGOING,
              BookingStatus.OVERDUE,
            ],
          },
        },
      },
      data: { quantity: 15 },
    });
  });

  it("emits two paired ASSET_KIT_CHANGED events sharing a moveCorrelationId", async () => {
    await moveAssetKitUnits(baseArgs);

    expect(mockRecordEvents).toHaveBeenCalledTimes(1);
    const [events] = mockRecordEvents.mock.calls[0] as [
      Array<{
        action: string;
        meta: { moveCorrelationId: string; side: "from" | "to" };
      }>,
    ];
    expect(events).toHaveLength(2);
    expect(events[0].action).toBe("ASSET_KIT_CHANGED");
    expect(events[1].action).toBe("ASSET_KIT_CHANGED");
    expect(events[0].meta.side).toBe("from");
    expect(events[1].meta.side).toBe("to");
    expect(events[0].meta.moveCorrelationId).toBe(
      events[1].meta.moveCorrelationId
    );
  });

  it("BLOCKS the move when the source kit has active bookings and surfaces the booking names", async () => {
    // Two active bookings on the source kit — these would otherwise
    // get their slice qty silently shrunk.
    mockBookingAssetFindMany.mockResolvedValue([
      {
        bookingId: "b-1",
        quantity: 5,
        booking: { name: "Photo Shoot", status: BookingStatus.RESERVED },
      },
      {
        bookingId: "b-2",
        quantity: 5,
        booking: { name: "Field Demo", status: BookingStatus.ONGOING },
      },
    ]);

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    // Booking names must be present so the user knows which ones to
    // release first.
    expect((err as ShelfError).message).toContain("Photo Shoot");
    expect((err as ShelfError).message).toContain("Field Demo");
    expect((err as ShelfError).message).toMatch(/Release these bookings/);
    // No mutations leaked.
    expect(mockAssetKitDelete).not.toHaveBeenCalled();
    expect(mockAssetKitUpdate).not.toHaveBeenCalled();
    expect(mockAssetKitUpsert).not.toHaveBeenCalled();
  });

  it("BLOCKS the move when the source kit is in operator custody (kit-inherited)", async () => {
    // Source kit is in custody to Alice → asset has an inherited
    // Custody row that would be orphaned by the move.
    mockCustodyFindFirst.mockResolvedValue({
      id: "cust-1",
      kitCustody: { custodian: { name: "Alice" } },
    });

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("Alice");
    expect((err as ShelfError).message).toMatch(/Release custody/);
    expect(mockAssetKitDelete).not.toHaveBeenCalled();
    expect(mockAssetKitUpsert).not.toHaveBeenCalled();
  });

  it("rejects an INDIVIDUAL asset (split/merge is QUANTITY_TRACKED-only)", async () => {
    mockLock.mockResolvedValue({
      ...lockedAsset,
      type: AssetType.INDIVIDUAL,
    });

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("quantity-tracked");
  });

  it("rejects when source and destination kits are the same", async () => {
    const err = await moveAssetKitUnits({
      ...baseArgs,
      toKitId: baseArgs.fromKitId,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("different");
  });

  it("rejects a non-positive quantity", async () => {
    const err = await moveAssetKitUnits({
      ...baseArgs,
      quantity: 0,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
  });

  it("rejects an over-move and surfaces the available allocation", async () => {
    // Source has only 5 units; user tries to move 10.
    mockAssetKitFindFirst.mockResolvedValue({ id: "ak-src", quantity: 5 });

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toMatch(/Only/);
    expect((err as ShelfError).message).toMatch(/5/);
    expect(mockAssetKitDelete).not.toHaveBeenCalled();
    expect(mockAssetKitUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the asset is not allocated to the source kit", async () => {
    mockAssetKitFindFirst.mockResolvedValue(null);

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("not allocated");
  });

  it("rejects a cross-org asset (assertAssetsBelongToOrg)", async () => {
    mockAssetFindMany.mockResolvedValue([]);

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("rejects a missing/cross-org source kit", async () => {
    mockKitFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "kit-from" ? null : { id: where.id, name: where.id }
        )
    );

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("source kit");
  });

  it("rejects a missing/cross-org destination kit", async () => {
    mockKitFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === "kit-to" ? null : { id: where.id, name: where.id }
        )
    );

    const err = await moveAssetKitUnits(baseArgs).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect((err as ShelfError).status).toBe(400);
    expect((err as ShelfError).message).toContain("destination kit");
  });

  it("leaves manual placements alone when the destination kit is unplaced", async () => {
    expect.assertions(3);

    // Default `mockKitFindFirst` returns kits with no `locationId`.
    await moveAssetKitUnits(baseArgs);

    // Nothing is placed anywhere — and crucially the only delete is scoped to
    // the destination's kit-driven row, never to the asset's manual rows.
    expect(db.assetLocation.createMany).not.toHaveBeenCalled();
    expect(db.assetLocation.updateMany).not.toHaveBeenCalled();
    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: { assetKitId: "ak-dst" },
    });
  });

  it("re-places the moved units at the destination kit's location", async () => {
    expect.assertions(2);

    // why: destination kit lives somewhere; the moved units must follow it
    // rather than staying recorded at the source kit's location.
    mockKitFindFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          name: where.id,
          locationId: where.id === "kit-to" ? "loc-dest" : "loc-source",
        })
    );
    // why: the shared cascade re-reads the destination kit's AssetKit rows to
    // build the placement write.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-dst",
        assetId: "asset-1",
        quantity: 10,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);

    await moveAssetKitUnits(baseArgs);

    // Kit-driven slice written at the DESTINATION kit's location, carrying the
    // destination's post-move quantity.
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-1",
          locationId: "loc-dest",
          organizationId: "org-1",
          quantity: 10,
          assetKitId: "ak-dst",
        },
      ],
    });
    // The asset's manual placements are untouched — only kit-driven rows for
    // the destination kit are cleared before the write.
    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: {
        assetKit: { kitId: { in: ["kit-to"] }, assetId: { in: ["asset-1"] } },
      },
    });
  });
});

/**
 * Verifies a kit's location actually reaches its member assets.
 *
 * The cascade previously skipped any INDIVIDUAL member that already held a
 * manual `AssetLocation` row, to stay inside the
 * `enforce_individual_asset_single_location` trigger
 * (packages/database/prisma/migrations/20260519143054_add_asset_location_pivot/migration.sql).
 * Because kit membership never converts a manual row into a kit-driven one,
 * that made the cascade a permanent no-op for the common case — a kit's
 * location silently never reached its assets.
 *
 * The kit now owns its members' whereabouts:
 * - INDIVIDUAL members have their single row REPLACED by a plain
 *   (`assetKitId: null`) row at the kit's location — one row, so the trigger
 *   stays satisfied, and the asset keeps the location when it leaves the kit.
 * - QUANTITY_TRACKED members get a kit-driven row holding just this kit's
 *   slice, ADDED alongside the asset's manual placements rather than taken out
 *   of them. Since
 *   `20260602100000_assetlocation_sum_exclude_kit_driven` the location-axis cap
 *   counts only `assetKitId IS NULL` rows, so the two axes are additive and
 *   manual placements are never touched.
 */
describe("updateKitLocation - cascade to member assets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: `assertLocationBelongsToOrg` calls `db.location.findFirst` —
    // echo a row back for any id so the guard passes.
    //@ts-expect-error missing vitest type
    db.location.findFirst.mockImplementation(({ where }) =>
      where?.id
        ? Promise.resolve({ id: where.id, name: where.id })
        : Promise.resolve(null)
    );
    // why: `clearAllMocks` clears calls but keeps implementations — reset the
    // placement read so each test starts from "no existing rows" and opts in
    // to the state it needs.
    //@ts-expect-error missing vitest type
    db.assetLocation.findMany.mockResolvedValue([]);
  });

  /**
   * Builds the `db.kit.findUnique` payload `updateKitLocation` reads at the
   * top — it drives the in-memory `kit.assets` list the cascade and the
   * audit trail both iterate.
   */
  function mockKitWithAssets(
    assetKits: Array<{
      quantity: number;
      asset: {
        id: string;
        title: string;
        type: AssetType;
        quantity: number | null;
        unitOfMeasure: string | null;
        assetLocations: Array<{ location: { id: string; name: string } }>;
      };
    }>
  ) {
    //@ts-expect-error missing vitest type
    db.kit.findUnique.mockResolvedValue({
      id: "kit-1",
      name: "Kit 1",
      assetKits,
    });
  }

  it("moves an INDIVIDUAL member that already has a location", async () => {
    expect.assertions(3);

    mockKitWithAssets([
      {
        quantity: 1,
        asset: {
          id: "asset-ind",
          title: "Manually placed",
          type: AssetType.INDIVIDUAL,
          quantity: null,
          unitOfMeasure: null,
          assetLocations: [{ location: { id: "loc-old", name: "Old Loc" } }],
        },
      },
    ]);
    // why: the cascade re-reads the kit's AssetKit rows to build the pivot
    // writes; `asset.type` decides plain-row vs kit-driven-row handling.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-ind",
        assetId: "asset-ind",
        quantity: 1,
        asset: { type: AssetType.INDIVIDUAL },
      },
    ]);

    const { updateKitLocation } = await import("./service.server");

    await updateKitLocation({
      id: "kit-1",
      organizationId: "org-1",
      currentLocationId: "loc-old",
      newLocationId: "loc-new",
      userId: "user-1",
    });

    // The asset's own placement is cleared...
    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: { assetId: { in: ["asset-ind"] }, assetKitId: null },
    });
    // ...and re-created at the kit's location as a PLAIN row (so the
    // single-location trigger holds and the asset keeps it on detach).
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-ind",
          locationId: "loc-new",
          organizationId: "org-1",
          quantity: 1,
          assetKitId: null,
        },
      ],
    });
    // Exactly one placement row is written — never a second one.
    expect(db.assetLocation.createMany).toHaveBeenCalledTimes(1);
  });

  it("emits an event and a note for an INDIVIDUAL member that used to be skipped", async () => {
    expect.assertions(3);

    mockKitWithAssets([
      {
        quantity: 1,
        asset: {
          id: "asset-ind",
          title: "Manually placed",
          type: AssetType.INDIVIDUAL,
          quantity: null,
          unitOfMeasure: null,
          assetLocations: [{ location: { id: "loc-old", name: "Old Loc" } }],
        },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-ind",
        assetId: "asset-ind",
        quantity: 1,
        asset: { type: AssetType.INDIVIDUAL },
      },
    ]);

    const { updateKitLocation } = await import("./service.server");

    await updateKitLocation({
      id: "kit-1",
      organizationId: "org-1",
      currentLocationId: "loc-old",
      newLocationId: "loc-new",
      userId: "user-1",
    });

    const eventsArg = (recordEvents as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(eventsArg.map((e: { assetId: string }) => e.assetId)).toEqual([
      "asset-ind",
    ]);
    expect(eventsArg[0]).toMatchObject({
      action: "ASSET_LOCATION_CHANGED",
      fromValue: "loc-old",
      toValue: "loc-new",
    });
    const noteAssetIds = (
      createNote as ReturnType<typeof vitest.fn>
    ).mock.calls.map((c) => (c[0] as { assetId: string }).assetId);
    expect(noteAssetIds).toEqual(["asset-ind"]);
  });

  it("places only the kit's slice for a QUANTITY_TRACKED member", async () => {
    expect.assertions(2);

    mockKitWithAssets([
      {
        quantity: 10,
        asset: {
          id: "asset-qty",
          title: "Batch",
          type: AssetType.QUANTITY_TRACKED,
          quantity: 50,
          unitOfMeasure: "kg",
          assetLocations: [],
        },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-qty",
        assetId: "asset-qty",
        quantity: 10,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);

    const { updateKitLocation } = await import("./service.server");

    await updateKitLocation({
      id: "kit-1",
      organizationId: "org-1",
      currentLocationId: null,
      newLocationId: "loc-new",
      userId: "user-1",
    });

    // Kit-driven row carries the KIT's slice (AssetKit.quantity = 10), not
    // the asset's 50-unit pool.
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-qty",
          locationId: "loc-new",
          organizationId: "org-1",
          quantity: 10,
          assetKitId: "ak-qty",
        },
      ],
    });
    // A QT member's existing manual placements are NOT wiped — only the
    // kit's own kit-driven rows are dropped first.
    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: { assetKit: { kitId: { in: ["kit-1"] } } },
    });
  });

  it("never touches a QUANTITY_TRACKED member's manual placements", async () => {
    expect.assertions(3);

    mockKitWithAssets([
      {
        quantity: 10,
        asset: {
          id: "asset-qty",
          title: "Batch",
          type: AssetType.QUANTITY_TRACKED,
          quantity: 50,
          unitOfMeasure: "kg",
          assetLocations: [{ location: { id: "loc-old", name: "Old Loc" } }],
        },
      },
    ]);
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-qty",
        assetId: "asset-qty",
        quantity: 10,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);
    // why: the asset is ALREADY fully placed manually (50 of 50). Since
    // `20260602100000_assetlocation_sum_exclude_kit_driven`, the location-axis
    // sum counts only `assetKitId IS NULL` rows, so a 10-unit kit slice on top
    // is valid — the axes are orthogonal and additive.
    //@ts-expect-error missing vitest type
    db.assetLocation.findMany.mockResolvedValue([
      {
        id: "al-manual",
        assetId: "asset-qty",
        quantity: 50,
        assetKitId: null,
        asset: { quantity: 50 },
      },
    ]);

    const { updateKitLocation } = await import("./service.server");

    await updateKitLocation({
      id: "kit-1",
      organizationId: "org-1",
      currentLocationId: null,
      newLocationId: "loc-new",
      userId: "user-1",
    });

    // The kit slice is added...
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-qty",
          locationId: "loc-new",
          organizationId: "org-1",
          quantity: 10,
          assetKitId: "ak-qty",
        },
      ],
    });
    // ...and the fully-placed manual row is left exactly as it was. Reclaiming
    // from it to "make room" would destroy real placement data.
    expect(db.assetLocation.update).not.toHaveBeenCalled();
    expect(db.assetLocation.delete).not.toHaveBeenCalled();
  });

  it("reports no removal for members that keep their placement when the kit's location is cleared", async () => {
    expect.assertions(2);

    mockKitWithAssets([
      {
        quantity: 1,
        asset: {
          id: "asset-ind",
          title: "Stays put",
          type: AssetType.INDIVIDUAL,
          quantity: null,
          unitOfMeasure: null,
          assetLocations: [{ location: { id: "loc-old", name: "Old Loc" } }],
        },
      },
      {
        quantity: 10,
        asset: {
          id: "asset-qty",
          title: "Batch",
          type: AssetType.QUANTITY_TRACKED,
          quantity: 50,
          unitOfMeasure: "kg",
          assetLocations: [{ location: { id: "loc-old", name: "Old Loc" } }],
        },
      },
    ]);
    // why: probe for the rows the clear branch is about to delete. Only the
    // QT asset holds a kit-driven row; the INDIVIDUAL member's plain row
    // survives, so it must not be reported as unplaced.
    //@ts-expect-error missing vitest type
    db.assetLocation.findMany.mockResolvedValue([{ assetId: "asset-qty" }]);

    const { updateKitLocation } = await import("./service.server");

    await updateKitLocation({
      id: "kit-1",
      organizationId: "org-1",
      currentLocationId: "loc-old",
      newLocationId: null,
      userId: "user-1",
    });

    const eventsArg = (recordEvents as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(eventsArg.map((e: { assetId: string }) => e.assetId)).toEqual([
      "asset-qty",
    ]);
    const noteAssetIds = (
      createNote as ReturnType<typeof vitest.fn>
    ).mock.calls.map((c) => (c[0] as { assetId: string }).assetId);
    expect(noteAssetIds).toEqual(["asset-qty"]);
  });
});

describe("bulkUpdateKitLocation - cascade to member assets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    // why: `assertLocationBelongsToOrg` calls `db.location.findFirst` —
    // echo a row back for any id so the guard passes (mirrors the
    // `updateKitLocation` describe above).
    //@ts-expect-error missing vitest type
    db.location.findFirst.mockImplementation(({ where }) =>
      where?.id
        ? Promise.resolve({ id: where.id, name: where.id })
        : Promise.resolve(null)
    );
    // why: `clearAllMocks` clears calls but keeps implementations, so reset
    // the placement read explicitly — these tests exercise the no-overflow
    // path and must not inherit another describe's rows.
    //@ts-expect-error missing vitest type
    db.assetLocation.findMany.mockResolvedValue([]);
  });

  /**
   * Two kits in the bulk set: kit-a holds an INDIVIDUAL asset that already
   * has a location (the case the old guard skipped), kit-b a QT asset.
   */
  function mockBulkKits() {
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue([
      {
        id: "kit-a",
        name: "Kit A",
        locationId: null,
        location: null,
        assetKits: [
          {
            quantity: 1,
            asset: {
              id: "asset-ind",
              title: "Manually placed",
              type: AssetType.INDIVIDUAL,
              quantity: null,
              unitOfMeasure: null,
              assetLocations: [
                { location: { id: "loc-old", name: "Old Loc" } },
              ],
            },
          },
        ],
      },
      {
        id: "kit-b",
        name: "Kit B",
        locationId: null,
        location: null,
        assetKits: [
          {
            quantity: 3,
            asset: {
              id: "asset-qty",
              title: "Batch",
              type: AssetType.QUANTITY_TRACKED,
              quantity: 50,
              unitOfMeasure: "kg",
              assetLocations: [],
            },
          },
        ],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      {
        id: "ak-ind",
        assetId: "asset-ind",
        quantity: 1,
        asset: { type: AssetType.INDIVIDUAL },
      },
      {
        id: "ak-qty",
        assetId: "asset-qty",
        quantity: 3,
        asset: { type: AssetType.QUANTITY_TRACKED },
      },
    ]);
  }

  it("moves both asset types across the whole bulk set", async () => {
    expect.assertions(3);

    mockBulkKits();

    const { bulkUpdateKitLocation } = await import("./service.server");

    await bulkUpdateKitLocation({
      kitIds: ["kit-a", "kit-b"],
      organizationId: "org-1",
      newLocationId: "loc-new",
      userId: "user-1",
    });

    expect(db.assetLocation.deleteMany).toHaveBeenCalledWith({
      where: { assetKit: { kitId: { in: ["kit-a", "kit-b"] } } },
    });
    // INDIVIDUAL member: plain row at the new location.
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-ind",
          locationId: "loc-new",
          organizationId: "org-1",
          quantity: 1,
          assetKitId: null,
        },
      ],
    });
    // QT member: kit-driven row carrying this kit's slice.
    expect(db.assetLocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "asset-qty",
          locationId: "loc-new",
          organizationId: "org-1",
          quantity: 3,
          assetKitId: "ak-qty",
        },
      ],
    });
  });

  it("emits an event for every moved member, including INDIVIDUAL ones", async () => {
    expect.assertions(1);

    mockBulkKits();

    const { bulkUpdateKitLocation } = await import("./service.server");

    await bulkUpdateKitLocation({
      kitIds: ["kit-a", "kit-b"],
      organizationId: "org-1",
      newLocationId: "loc-new",
      userId: "user-1",
    });

    const eventsArg = (recordEvents as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(eventsArg.map((e: { assetId: string }) => e.assetId).sort()).toEqual(
      ["asset-ind", "asset-qty"]
    );
  });
});

/**
 * `AssetLocation.assetKit` is `onDelete: Cascade`, so deleting an `AssetKit`
 * row would take the kit-driven placement with it and silently unplace the
 * asset. Unpacking a kit doesn't teleport its contents, so the row is
 * converted to a manual placement first — subject to the two uniqueness /
 * trigger constraints the helper has to work around.
 */
describe("preserveKitDrivenPlacements", () => {
  /**
   * The helper reads placements twice — first the kit-driven rows it may
   * convert, then the assets' existing manual rows — so the tests queue two
   * sequential resolutions. Cast once here rather than sprinkling
   * `@ts-expect-error` across the chained calls.
   */
  const placementReads = () =>
    db.assetLocation.findMany as unknown as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("converts an INDIVIDUAL member's kit-driven placement into a manual one", async () => {
    expect.assertions(2);

    placementReads()
      // kit-driven rows the helper may convert
      .mockResolvedValueOnce([{ id: "al-kit", assetId: "asset-ind" }])
      // the asset holds no manual row, so the conversion is unobstructed
      .mockResolvedValueOnce([]);

    const { preserveKitDrivenPlacements } = await import("./service.server");

    await preserveKitDrivenPlacements(db, ["ak-ind"]);

    expect(db.assetLocation.update).toHaveBeenCalledWith({
      where: { id: "al-kit" },
      data: { assetKitId: null },
    });
    expect(db.assetLocation.delete).not.toHaveBeenCalled();
  });

  it("drops the kit-driven row when an INDIVIDUAL asset is already placed", async () => {
    expect.assertions(2);

    placementReads()
      .mockResolvedValueOnce([{ id: "al-kit", assetId: "asset-ind" }])
      // why: `enforce_individual_asset_single_location` caps an INDIVIDUAL
      // asset at one row, so the existing manual placement has to win even
      // though it sits at a different location.
      .mockResolvedValueOnce([{ assetId: "asset-ind" }]);

    const { preserveKitDrivenPlacements } = await import("./service.server");

    await preserveKitDrivenPlacements(db, ["ak-ind"]);

    expect(db.assetLocation.delete).toHaveBeenCalledWith({
      where: { id: "al-kit" },
    });
    expect(db.assetLocation.update).not.toHaveBeenCalled();
  });

  it("never converts a QUANTITY_TRACKED slice, which would breach the manual cap", async () => {
    expect.assertions(3);

    // why: the read is filtered to non-QUANTITY_TRACKED assets in SQL, so a
    // kit holding only QT members comes back empty and the helper no-ops.
    // Those rows are left to `onDelete: Cascade` — converting them would move
    // units into the capped location axis and abort the whole detach for a
    // fully-placed asset.
    placementReads().mockResolvedValueOnce([]);

    const { preserveKitDrivenPlacements } = await import("./service.server");

    await preserveKitDrivenPlacements(db, ["ak-qty"]);

    expect(placementReads()).toHaveBeenCalledWith({
      where: {
        assetKitId: { in: ["ak-qty"] },
        asset: { type: { not: AssetType.QUANTITY_TRACKED } },
      },
      select: { id: true, assetId: true },
    });
    expect(db.assetLocation.update).not.toHaveBeenCalled();
    expect(db.assetLocation.delete).not.toHaveBeenCalled();
  });
});

/**
 * `BookingAsset.assetKitId` is `ON DELETE SET NULL`, so removing an asset from
 * a kit would DEMOTE the kit-driven slice into a standalone one on every
 * booking regardless of status — a draft booking silently keeping an asset its
 * kit no longer contains. For a booking where nothing has physically left the
 * warehouse the booking tracks the kit, so the row is deleted outright.
 */
describe("removeKitSlicesFromPlanningBookings", () => {
  /** The kit-driven slice reads go through `bookingAsset.findMany`. */
  const sliceReads = () =>
    db.bookingAsset.findMany as unknown as ReturnType<typeof vitest.fn>;
  /** Resolves `assetKitId` → kit id/name for the note wording. */
  const membershipReads = () =>
    db.assetKit.findMany as unknown as ReturnType<typeof vitest.fn>;

  /** A DRAFT booking holding one INDIVIDUAL asset via kit membership `ak-1`. */
  const draftSlice = {
    id: "ba-draft",
    bookingId: "booking-draft",
    assetId: "switch-a",
    quantity: 1,
    assetKitId: "ak-1",
    booking: {
      id: "booking-draft",
      name: "Rack job",
      organizationId: "org-1",
      status: BookingStatus.DRAFT,
    },
    asset: {
      id: "switch-a",
      title: "Switch A",
      type: AssetType.INDIVIDUAL,
      unitOfMeasure: null,
      assetModelId: null,
    },
  };

  const membershipRow = {
    id: "ak-1",
    kitId: "kit-1",
    kit: { name: "Rack Kit" },
  };

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("deletes kit-driven slices on DRAFT/RESERVED bookings and reports what died", async () => {
    // why: the DB `SET NULL` cascade would demote every one of these to a
    // standalone slice. For a booking where nothing is physically out, the
    // booking should track the kit instead — the row must go.
    expect.assertions(2);

    sliceReads().mockResolvedValueOnce([draftSlice]);
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    const removed = await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
    expect(removed).toEqual([
      expect.objectContaining({
        bookingAssetId: "ba-draft",
        bookingId: "booking-draft",
        bookingName: "Rack job",
        organizationId: "org-1",
        assetId: "switch-a",
        assetTitle: "Switch A",
        quantity: 1,
        kitId: "kit-1",
        kitName: "Rack Kit",
      }),
    ]);
  });

  it("never touches a standalone row the user added by hand for the same asset", async () => {
    // why: THE regression to protect. A booking can hold the same asset both as
    // a kit slice and as a deliberately hand-added standalone row (the two
    // partial uniques allow it). Keying the delete on `assetId` would take the
    // standalone row with it; the query must key on `assetKitId` and the delete
    // on the exact ids that came back.
    expect.assertions(3);

    // The booking really holds BOTH rows for `switch-a`. Rather than stubbing
    // the result, the mock applies the `assetKitId` filter the way Postgres
    // would, so the standalone row is excluded because of the query the helper
    // wrote — not because the fixture omitted it.
    const standaloneSlice = {
      ...draftSlice,
      id: "ba-standalone",
      assetKitId: null,
    };
    const bookingAssetTable = [draftSlice, standaloneSlice];
    sliceReads().mockImplementationOnce(
      ({ where }: { where: { assetKitId?: { in: string[] } } }) =>
        Promise.resolve(
          bookingAssetTable.filter(
            (row) =>
              row.assetKitId != null &&
              (where.assetKitId?.in ?? []).includes(row.assetKitId)
          )
        )
    );
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    // The read is scoped to the kit-driven rows for these memberships only.
    const [readArgs] = sliceReads().mock.calls[0];
    expect(readArgs.where).toEqual({
      assetKitId: { in: ["ak-1"] },
      booking: {
        organizationId: "org-1",
        status: { in: [BookingStatus.DRAFT, BookingStatus.RESERVED] },
      },
    });
    // Only the kit-driven row is named; `ba-standalone` survives.
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
    expect(
      JSON.stringify(
        (db.bookingAsset.deleteMany as unknown as ReturnType<typeof vitest.fn>)
          .mock.calls
      )
    ).not.toContain("ba-standalone");
  });

  it("scopes both reads to the acting org, so a foreign membership id deletes nothing", async () => {
    // why: this helper DELETES booking rows selected purely by `assetKitId`.
    // Without `organizationId` in the query, a caller that ever passes an id it
    // did not org-scope itself destroys another tenant's booking data. The mock
    // applies whatever clauses the helper actually wrote — an absent org clause
    // returns BOTH rows, the way Postgres would — so the foreign row is spared
    // because of the query, not because the fixture left it out.
    expect.assertions(3);

    const foreignSlice = {
      ...draftSlice,
      id: "ba-other-org",
      assetKitId: "ak-other-org",
      booking: { ...draftSlice.booking, organizationId: "org-2" },
    };
    sliceReads().mockImplementationOnce(
      ({
        where,
      }: {
        where: {
          assetKitId?: { in: string[] };
          booking?: { organizationId?: string };
        };
      }) =>
        Promise.resolve(
          [draftSlice, foreignSlice].filter(
            (row) =>
              (where.assetKitId?.in ?? []).includes(row.assetKitId) &&
              (where.booking?.organizationId === undefined ||
                row.booking.organizationId === where.booking.organizationId)
          )
        )
    );
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    const removed = await removeKitSlicesFromPlanningBookings(
      db,
      ["ak-1", "ak-other-org"],
      { actorUserId: "user-1", organizationId: "org-1" }
    );

    // The membership lookup that feeds the note wording is scoped too.
    const [membershipArgs] = membershipReads().mock.calls[0];
    expect(membershipArgs.where).toEqual({
      id: { in: ["ak-1", "ak-other-org"] },
      organizationId: "org-1",
    });
    expect(removed.map((r) => r.bookingAssetId)).toEqual(["ba-draft"]);
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
  });

  it("leaves a slice on an ONGOING booking alone", async () => {
    // why: the items are physically out. Deleting the row would strand custody
    // and checkout attribution, so those keep today's SET NULL cascade. The
    // read is status-filtered, so an ONGOING slice simply never comes back.
    expect.assertions(2);

    sliceReads().mockResolvedValueOnce([]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    const removed = await removeKitSlicesFromPlanningBookings(
      db,
      ["ak-ongoing"],
      {
        actorUserId: "user-1",
        organizationId: "org-1",
      }
    );

    expect(removed).toEqual([]);
    expect(db.bookingAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("short-circuits on an empty membership list without querying", async () => {
    expect.assertions(3);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    const removed = await removeKitSlicesFromPlanningBookings(db, [], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    expect(removed).toEqual([]);
    expect(sliceReads()).not.toHaveBeenCalled();
    expect(db.bookingAsset.deleteMany).not.toHaveBeenCalled();
  });

  it("emits one BOOKING_ASSETS_REMOVED event per deleted row, inside the tx", async () => {
    // why: deleting a booked row is destructive — without the event the
    // activity report silently loses the removal (see bulk-event-parity).
    expect.assertions(2);

    sliceReads().mockResolvedValueOnce([
      draftSlice,
      {
        ...draftSlice,
        id: "ba-reserved",
        bookingId: "booking-reserved",
        assetId: "battery",
        quantity: 12,
        booking: {
          id: "booking-reserved",
          name: "Field trip",
          organizationId: "org-1",
          status: BookingStatus.RESERVED,
        },
        asset: {
          id: "battery",
          title: "Battery",
          type: AssetType.QUANTITY_TRACKED,
          unitOfMeasure: "pcs",
          assetModelId: null,
        },
      },
    ]);
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    const [events, tx] = (
      recordEvents as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls[0];
    expect(tx).toBe(db);
    expect(events).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "BOOKING_ASSETS_REMOVED",
        entityType: "BOOKING",
        entityId: "booking-draft",
        bookingId: "booking-draft",
        assetId: "switch-a",
        // INDIVIDUAL carries no unit count.
        meta: { viaKitRemoval: true },
      }),
      expect.objectContaining({
        entityId: "booking-reserved",
        bookingId: "booking-reserved",
        assetId: "battery",
        // QUANTITY_TRACKED reports the booked units that disappeared.
        meta: { viaKitRemoval: true, quantity: 12 },
      }),
    ]);
  });

  it("re-opens a BookingModelRequest the deleted slice was fulfilling", async () => {
    // why: mirrors `removeAssets` — otherwise the request still claims to be
    // fulfilled by an asset that is no longer on the booking, and the Reserved
    // Models card stays hidden while the booking is short a unit.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([
      {
        ...draftSlice,
        asset: { ...draftSlice.asset, assetModelId: "model-1" },
      },
    ]);
    membershipReads().mockResolvedValueOnce([membershipRow]);
    (
      db.bookingModelRequest.findUnique as unknown as ReturnType<
        typeof vitest.fn
      >
    ).mockResolvedValueOnce({ quantity: 3, fulfilledQuantity: 3 });

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    expect(db.bookingModelRequest.update).toHaveBeenCalledWith({
      where: {
        bookingId_assetModelId: {
          bookingId: "booking-draft",
          assetModelId: "model-1",
        },
      },
      // Dropping below `quantity` re-opens the request.
      data: { fulfilledQuantity: 2, fulfilledAt: null },
    });
  });

  it("cannot be Markdoc-injected through a kit or asset name", async () => {
    // why: kit names and asset titles have no character restrictions and the
    // booking feed renders note content as Markdoc, so a raw splice is a stored
    // tag injection. Assert on the PARSE, not the string.
    expect.assertions(3);

    sliceReads().mockResolvedValueOnce([
      {
        ...draftSlice,
        asset: {
          ...draftSlice.asset,
          title: `Switch {% link to="javascript:alert(1)" text="x" /%}`,
        },
      },
    ]);
    membershipReads().mockResolvedValueOnce([
      {
        ...membershipRow,
        kit: { name: `Rack {% assets_list assets="pwn" /%}` },
      },
    ]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    const [{ notes }] = (
      createSystemBookingNotes as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls[0];
    const { content } = notes[0];
    const tags = [...Markdoc.parse(content).walk()].filter(
      (node) => node.type === "tag"
    );
    // The only legitimate tag is the actor link this helper builds itself.
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe("link");
    expect(content).toContain("so it was also removed from this booking.");
  });

  it("aggregates per asset when one asset is detached from two kits at once", async () => {
    // why: a QUANTITY_TRACKED asset can hold a slice in several kits on the
    // same booking. Counting ROWS would emit two BOOKING_ASSETS_REMOVED events
    // for one (booking, asset) and decrement the model request by 2 against the
    // single increment `materializeModelRequestForAsset` ever made — spuriously
    // re-opening a fulfilled request.
    expect.assertions(4);

    const qtyAsset = {
      id: "battery",
      title: "Battery",
      type: AssetType.QUANTITY_TRACKED,
      unitOfMeasure: "pcs",
      assetModelId: "model-1",
    };
    sliceReads().mockResolvedValueOnce([
      {
        ...draftSlice,
        id: "ba-kit-a",
        assetKitId: "ak-a",
        quantity: 4,
        assetId: "battery",
        asset: qtyAsset,
      },
      {
        ...draftSlice,
        id: "ba-kit-b",
        assetKitId: "ak-b",
        quantity: 6,
        assetId: "battery",
        asset: qtyAsset,
      },
    ]);
    membershipReads().mockResolvedValueOnce([
      { id: "ak-a", kitId: "kit-a", kit: { name: "Kit A" } },
      { id: "ak-b", kitId: "kit-b", kit: { name: "Kit B" } },
    ]);
    (
      db.bookingModelRequest.findUnique as unknown as ReturnType<
        typeof vitest.fn
      >
    ).mockResolvedValueOnce({ quantity: 3, fulfilledQuantity: 3 });

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-a", "ak-b"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    const [events] = (recordEvents as unknown as ReturnType<typeof vitest.fn>)
      .mock.calls[0];
    expect(events).toHaveLength(1);
    // Units summed across both slices.
    expect(events[0]).toEqual(
      expect.objectContaining({
        assetId: "battery",
        meta: { viaKitRemoval: true, quantity: 10 },
      })
    );
    // Two source kits, so no single kit can be named on the event.
    expect(events[0]).not.toHaveProperty("kitId");
    // Decremented by one ASSET, not two rows.
    expect(db.bookingModelRequest.update).toHaveBeenCalledWith({
      where: {
        bookingId_assetModelId: {
          bookingId: "booking-draft",
          assetModelId: "model-1",
        },
      },
      data: { fulfilledQuantity: 2, fulfilledAt: null },
    });
  });

  it("names the kit deletion, not a membership edit, on the kit-deleted path", async () => {
    // why: on `performKitDeletion` the asset never left the kit — the kit
    // stopped existing. "removed X from kit Y" would describe an edit that
    // never happened.
    expect.assertions(2);

    sliceReads().mockResolvedValueOnce([draftSlice]);
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
      reason: "kit-deleted",
    });

    const [{ notes }] = (
      createSystemBookingNotes as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls[0];
    // Asserting the whole clause, not just the verb choice — the two branches
    // place the subjects differently, so each needs its own agreement.
    expect(notes[0].content).toContain(
      "deleted kit **Rack Kit**, so **Switch A** was removed from this booking."
    );
    expect(notes[0].content).not.toContain("removed **Switch A** from kit");
  });

  it("resolves the note actor on the transaction client, not the global db", async () => {
    // why: `getUserByID` is hardcoded to the global `db` and takes no tx, so
    // using it here would claim a second pooled connection while this
    // interactive transaction holds one, and add a round-trip to a tx budget
    // that has already produced P2028 on large bulk operations.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([draftSlice]);
    membershipReads().mockResolvedValueOnce([membershipRow]);

    const { removeKitSlicesFromPlanningBookings } = await import(
      "./service.server"
    );
    await removeKitSlicesFromPlanningBookings(db, ["ak-1"], {
      actorUserId: "user-1",
      organizationId: "org-1",
    });

    expect(db.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { firstName: true, lastName: true },
    });
  });
});

/**
 * Read-only counterpart to `removeKitSlicesFromPlanningBookings`: it answers
 * "which bookings does this removal visibly affect, and how" so the removal UI
 * can say so before the user confirms. RESERVED bookings LOSE the slice;
 * ONGOING/OVERDUE ones KEEP it, relabelled.
 */
describe("getBookingImpactForAssetKits", () => {
  /** The kit-driven slice read goes through `bookingAsset.findMany`. */
  const sliceReads = () =>
    db.bookingAsset.findMany as unknown as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("scopes the read to the acting org and to the two actionable status groups", async () => {
    // why: two filters, two different reasons, both load-bearing.
    // `organizationId` is the tenancy guard — this helper renders BOOKING NAMES
    // back to the user, so an `AssetKit` id from another org must return
    // nothing. The status list is the advisory scope: DRAFT removals are
    // unremarkable (nobody has committed to them) and COMPLETE / ARCHIVED /
    // CANCELLED are historical noise the operator can do nothing about, so the
    // read must not widen. The exact `toEqual` below is what makes dropping
    // either clause — or adding a status — fail.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([]);

    const { getBookingImpactForAssetKits } = await import("./service.server");
    await getBookingImpactForAssetKits({
      assetKitIds: ["ak-1", "ak-2"],
      organizationId: "org-1",
    });

    const [readArgs] = sliceReads().mock.calls[0];
    expect(readArgs).toEqual({
      where: {
        assetKitId: { in: ["ak-1", "ak-2"] },
        booking: {
          status: {
            in: [
              BookingStatus.RESERVED,
              BookingStatus.ONGOING,
              BookingStatus.OVERDUE,
            ],
          },
          organizationId: "org-1",
        },
      },
      select: {
        assetKitId: true,
        booking: { select: { id: true, name: true, status: true } },
      },
    });
  });

  it("splits reserved bookings from checked-out ones, per membership", async () => {
    // why: the two groups get different copy because the outcomes differ — a
    // RESERVED booking LOSES the asset, an ONGOING/OVERDUE one KEEPS it
    // relabelled. Collapsing them into one list would tell the operator the
    // wrong thing about half the bookings named.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-1",
          name: "Rack job",
          status: BookingStatus.RESERVED,
        },
      },
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-2",
          name: "Field day",
          status: BookingStatus.ONGOING,
        },
      },
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-3",
          name: "Late return",
          status: BookingStatus.OVERDUE,
        },
      },
      {
        assetKitId: "ak-2",
        booking: {
          id: "b-1",
          name: "Rack job",
          status: BookingStatus.RESERVED,
        },
      },
    ]);

    const { getBookingImpactForAssetKits } = await import("./service.server");

    await expect(
      getBookingImpactForAssetKits({
        assetKitIds: ["ak-1", "ak-2"],
        organizationId: "org-1",
      })
    ).resolves.toEqual({
      "ak-1": {
        reserved: [{ id: "b-1", name: "Rack job" }],
        checkedOut: [
          { id: "b-2", name: "Field day" },
          { id: "b-3", name: "Late return" },
        ],
      },
      "ak-2": {
        reserved: [{ id: "b-1", name: "Rack job" }],
        checkedOut: [],
      },
    });
  });

  it("drops a historical booking rather than defaulting it into a group", async () => {
    // why: belt-and-braces behind the status filter. Each group's copy makes a
    // promise about what happens to the booking; a COMPLETE one would make the
    // wrong promise in either group, and the membership must not be reported
    // as impacted at all when that row is its only one.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-9",
          name: "Last winter's shoot",
          status: BookingStatus.COMPLETE,
        },
      },
    ]);

    const { getBookingImpactForAssetKits } = await import("./service.server");

    await expect(
      getBookingImpactForAssetKits({
        assetKitIds: ["ak-1"],
        organizationId: "org-1",
      })
    ).resolves.toEqual({});
  });

  it("names a booking once even when it holds several slices of the membership", async () => {
    // why: the copy reads "2 reserved bookings: Rack job, Rack job" otherwise.
    // Defensive rather than reachable today, but the notice's count is the
    // whole point — it must never overstate.
    expect.assertions(1);

    sliceReads().mockResolvedValueOnce([
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-1",
          name: "Rack job",
          status: BookingStatus.RESERVED,
        },
      },
      {
        assetKitId: "ak-1",
        booking: {
          id: "b-1",
          name: "Rack job",
          status: BookingStatus.RESERVED,
        },
      },
    ]);

    const { getBookingImpactForAssetKits } = await import("./service.server");

    await expect(
      getBookingImpactForAssetKits({
        assetKitIds: ["ak-1"],
        organizationId: "org-1",
      })
    ).resolves.toEqual({
      "ak-1": { reserved: [{ id: "b-1", name: "Rack job" }], checkedOut: [] },
    });
  });

  it("short-circuits an empty input without querying", async () => {
    // why: the helper runs on every kit-page and picker load. A kit with no
    // members must not cost a round-trip.
    expect.assertions(2);

    const { getBookingImpactForAssetKits } = await import("./service.server");

    await expect(
      getBookingImpactForAssetKits({
        assetKitIds: [],
        organizationId: "org-1",
      })
    ).resolves.toEqual({});
    expect(db.bookingAsset.findMany).not.toHaveBeenCalled();
  });
});

/**
 * The `SET NULL` cascade trips `BookingAsset_manual_unique` when a booking
 * holds the same asset both standalone and via the kit being detached, so the
 * kit-driven units are folded into the standalone row first.
 */
describe("mergeStandaloneCollisionsForKitDetachment", () => {
  const sliceReads = () =>
    db.bookingAsset.findMany as unknown as ReturnType<typeof vitest.fn>;

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("accumulates two kit-driven rows into one standalone row without losing units", async () => {
    // why: a QUANTITY_TRACKED asset can sit in several kits on one booking, so
    // a bulk kit deletion collapses two kit rows into one standalone row.
    // Writing `standalone.quantity + kdr.quantity` per row from the unchanged
    // snapshot let the second write overwrite the first — 20 + 4 + 6 came out
    // as 26 instead of 30, silently losing the first slice's 4 units.
    expect.assertions(3);

    sliceReads()
      // the kit-driven rows about to be detached
      .mockResolvedValueOnce([
        { id: "ba-kit-a", bookingId: "b-1", assetId: "battery", quantity: 4 },
        { id: "ba-kit-b", bookingId: "b-1", assetId: "battery", quantity: 6 },
      ])
      // the standalone row both of them collide with
      .mockResolvedValueOnce([
        {
          id: "ba-standalone",
          bookingId: "b-1",
          assetId: "battery",
          quantity: 20,
        },
      ]);

    const { mergeStandaloneCollisionsForKitDetachment } = await import(
      "./service.server"
    );
    await mergeStandaloneCollisionsForKitDetachment(db, ["ak-a", "ak-b"]);

    expect(db.bookingAsset.update).toHaveBeenCalledTimes(1);
    expect(db.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "ba-standalone" },
      data: { quantity: 30 },
    });
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-kit-a", "ba-kit-b"] } },
    });
  });
});

/**
 * The helpers above are only worth anything if the detach flows actually call
 * them. Every one of these tests fails if its call site is deleted — without
 * them the whole suite stays green while a path silently reverts to demoting
 * kit-driven rows (or to tripping P2002 on a standalone collision).
 */
describe("kit detach flows — helper wiring", () => {
  /** One planning-status kit-driven slice, as the planning read returns it. */
  const planningSlice = {
    id: "ba-draft",
    bookingId: "booking-draft",
    assetId: "switch-a",
    quantity: 1,
    assetKitId: "ak-1",
    booking: {
      id: "booking-draft",
      name: "Rack job",
      organizationId: "org-1",
      status: BookingStatus.DRAFT,
    },
    asset: {
      id: "switch-a",
      title: "Switch A",
      type: AssetType.INDIVIDUAL,
      unitOfMeasure: null,
      assetModelId: null,
    },
  };

  /**
   * A detach flow fires several `bookingAsset.findMany` reads in a row. Routing
   * them by their `where` (rather than a positional `mockResolvedValueOnce`
   * chain) keeps these tests from silently re-aliasing if the call order
   * changes:
   *   - planning-slice read → `booking.status` narrowed to DRAFT/RESERVED
   *   - detachment impact   → `booking.status` also includes ONGOING
   *   - merge, kit-driven   → no booking filter
   *   - merge, standalone   → `assetKitId: null`
   */
  function routeBookingAssetReads({
    planning = [] as unknown[],
    impact = [] as unknown[],
    mergeKitDriven = [] as unknown[],
    mergeStandalone = [] as unknown[],
  }) {
    (
      db.bookingAsset.findMany as unknown as ReturnType<typeof vitest.fn>
    ).mockImplementation((args: { where?: Record<string, any> }) => {
      const where = args?.where ?? {};
      const statuses = where.booking?.status?.in as string[] | undefined;
      if (statuses) {
        return Promise.resolve(
          statuses.includes(BookingStatus.ONGOING) ? impact : planning
        );
      }
      if (where.assetKitId === null) return Promise.resolve(mergeStandalone);
      return Promise.resolve(mergeKitDriven);
    });
  }

  /**
   * `assetKit.findMany` is asked twice per flow: once for the bare ids about to
   * be deleted, and once (by the planning/impact helpers) for the kit names.
   * The `select` tells them apart.
   */
  function routeAssetKitReads() {
    (
      db.assetKit.findMany as unknown as ReturnType<typeof vitest.fn>
    ).mockImplementation((args: { select?: Record<string, unknown> }) =>
      Promise.resolve(
        args?.select?.kitId
          ? [{ id: "ak-1", kitId: "kit-1", kit: { name: "Rack Kit" } }]
          : [{ id: "ak-1" }]
      )
    );
  }

  beforeEach(() => {
    vitest.clearAllMocks();
    routeAssetKitReads();
  });

  it("updateKitAssets deletes planning slices when an asset is removed from the kit", async () => {
    expect.assertions(1);

    routeBookingAssetReads({ planning: [planningSlice] });
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-1",
      location: null,
      locationId: null,
      custody: null,
      assetKits: [
        {
          kitId: "kit-1",
          quantity: 1,
          asset: {
            id: "switch-a",
            title: "Switch A",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ kitId: "kit-1" }],
            bookingAssets: [],
          },
        },
      ],
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([]);

    const { updateKitAssets } = await import("./service.server");
    // `switch-a` is in the kit but not in `assetIds` → it is being removed.
    await updateKitAssets({
      kitId: "kit-1",
      assetIds: [],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
  });

  it("updateKitAssets deletes planning slices on the cross-kit move path", async () => {
    expect.assertions(1);

    routeBookingAssetReads({ planning: [planningSlice] });
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      id: "kit-2",
      location: null,
      locationId: null,
      custody: null,
      assetKits: [],
    });
    // An INDIVIDUAL asset that already belongs to another kit — adding it here
    // detaches the old membership first.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "switch-a",
        title: "Switch A",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        unitOfMeasure: null,
        assetKits: [{ kitId: "kit-1" }],
        custody: [],
        bookingAssets: [],
        location: null,
      },
    ]);

    const { updateKitAssets } = await import("./service.server");
    await updateKitAssets({
      kitId: "kit-2",
      assetIds: ["switch-a"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
  });

  it("bulkRemoveAssetsFromKits deletes planning slices", async () => {
    expect.assertions(1);

    routeBookingAssetReads({ planning: [planningSlice] });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "switch-a",
        title: "Switch A",
        assetKits: [{ kit: { id: "kit-1", name: "Rack Kit", custody: null } }],
        custody: [],
      },
    ]);

    await bulkRemoveAssetsFromKits({
      assetIds: ["switch-a"],
      organizationId: "org-1",
      userId: "user-1",
      request: new Request("http://test.com"),
      // @ts-expect-error settings shape not relevant for this test
      settings: {},
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
  });

  it("bulkRemoveAssetsFromKits merges a standalone collision instead of tripping P2002", async () => {
    // why: this call was missing entirely. Without it the `SET NULL` cascade
    // violates `BookingAsset_manual_unique` and rolls back the whole bulk op.
    expect.assertions(2);

    routeBookingAssetReads({
      mergeKitDriven: [
        { id: "ba-kit", bookingId: "b-1", assetId: "battery", quantity: 6 },
      ],
      mergeStandalone: [
        {
          id: "ba-standalone",
          bookingId: "b-1",
          assetId: "battery",
          quantity: 20,
        },
      ],
    });
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "battery",
        title: "Battery",
        assetKits: [{ kit: { id: "kit-1", name: "Rack Kit", custody: null } }],
        custody: [],
      },
    ]);

    await bulkRemoveAssetsFromKits({
      assetIds: ["battery"],
      organizationId: "org-1",
      userId: "user-1",
      request: new Request("http://test.com"),
      // @ts-expect-error settings shape not relevant for this test
      settings: {},
    });

    expect(db.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "ba-standalone" },
      data: { quantity: 26 },
    });
    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-kit"] } },
    });
  });

  it("deleteKit deletes planning slices and merges standalone collisions", async () => {
    expect.assertions(3);

    routeBookingAssetReads({
      planning: [planningSlice],
      mergeKitDriven: [
        { id: "ba-kit", bookingId: "b-1", assetId: "battery", quantity: 6 },
      ],
      mergeStandalone: [
        {
          id: "ba-standalone",
          bookingId: "b-1",
          assetId: "battery",
          quantity: 20,
        },
      ],
    });
    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue({
      ...mockKitData,
      assetKits: [{ asset: { id: "switch-a", title: "Switch A" } }],
      custody: null,
    });

    await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
      actorUserId: "user-1",
    });

    expect(db.bookingAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["ba-draft"] } },
    });
    expect(db.bookingAsset.update).toHaveBeenCalledWith({
      where: { id: "ba-standalone" },
      data: { quantity: 26 },
    });
    // why: pins the `reason: "kit-deleted"` argument `performKitDeletion`
    // passes. Drop it and every kit-deletion booking note reverts to
    // "removed X from kit Y" — a membership edit that never happened — while
    // the rest of the suite stays green. The rendered note is the only
    // observable proof the flag reached the helper.
    const [{ notes }] = (
      createSystemBookingNotes as unknown as ReturnType<typeof vitest.fn>
    ).mock.calls[0];
    expect(notes[0].content).toContain(
      "deleted kit **Rack Kit**, so **Switch A** was removed from this booking."
    );
  });
});

describe("bulkAssignKitCustody — handled validation (SHELF-WEBAPP-226)", () => {
  it("rejects an unavailable kit as a handled 400, not a captured 500", async () => {
    // why: the availability guard reads freshly-queried kit status; return an
    // IN_CUSTODY (not AVAILABLE) kit so the unavailable-kits guard fires.
    (db.kit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      { id: "kit-1", name: "Kit 1", status: "IN_CUSTODY", assetKits: [] },
    ]);

    let thrown: unknown;
    try {
      await bulkAssignKitCustody({
        allowedTeamMemberIds: "all" as const,
        kitIds: ["kit-1"],
        organizationId: "org-1",
        custodianId: "tm-1",
        custodianName: "Bob",
        userId: "user-1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const err = thrown as ShelfError;
    expect(err.message).toContain("unavailable kits");
    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });

  it("rejects an unavailable INDIVIDUAL asset in a kit as a handled 400", async () => {
    // why: the kit is AVAILABLE but holds an INDIVIDUAL asset that is IN_CUSTODY,
    // so the unavailable-assets-in-kits guard fires.
    (db.kit.findMany as ReturnType<typeof vitest.fn>).mockResolvedValue([
      {
        id: "kit-1",
        name: "Kit 1",
        status: "AVAILABLE",
        assetKits: [
          {
            asset: {
              id: "asset-1",
              title: "Drill",
              status: "IN_CUSTODY",
              type: "INDIVIDUAL",
              quantity: null,
            },
          },
        ],
      },
    ]);

    let thrown: unknown;
    try {
      await bulkAssignKitCustody({
        allowedTeamMemberIds: "all" as const,
        kitIds: ["kit-1"],
        organizationId: "org-1",
        custodianId: "tm-1",
        custodianName: "Bob",
        userId: "user-1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const err = thrown as ShelfError;
    expect(err.message).toContain("unavailable assets");
    expect(err.status).toBe(400);
    expect(err.shouldBeCaptured).toBe(false);
  });
});

/**
 * Regression cover for "a kit I never added showed up in my booking".
 *
 * `updateKitAssets` propagates a newly-added kit member into the bookings that
 * already hold this kit. It used to derive that booking list from the FIRST kit
 * member that had ANY `BookingAsset` row at all:
 *
 *   kit.assets.find((a) => a.bookingAssets.length > 0)?.bookingAssets
 *
 * with the underlying `bookingAssets` include carrying no `where` clause. A
 * QUANTITY_TRACKED asset can belong to several kits, so that member's rows
 * could belong to a DIFFERENT kit's booking. The new member was then written
 * into a booking that never contained this kit, tagged with THIS kit's
 * `assetKitId` — the booking rendered an extra kit nobody added, and the stray
 * asset produced reservation conflicts that silently disabled Reserve.
 *
 * The rule these tests pin: propagate into exactly the bookings holding a slice
 * of THIS kit — a `BookingAsset` whose `assetKitId` is one of this kit's
 * `AssetKit` ids — and into ALL of them, not just the first member's.
 */
describe("updateKitAssets - kit-booking propagation scope", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * Kit B holds two members:
   *  - `shared-banner`, a QT asset ALSO in Kit A, whose only booking row is a
   *    Kit A slice on `booking-foreign` (a booking Kit B is not part of);
   *  - `kit-b-member`, whose booking row IS a Kit B slice on `booking-own`.
   *
   * `shared-banner` sorts first, so the old `.find()` locked onto it and got
   * exactly the wrong answer in both directions.
   */
  function arrangeKitB() {
    const mockKit = {
      id: "kit-b",
      name: "Kit B",
      status: KitStatus.AVAILABLE,
      location: null,
      custody: null,
      assetKits: [
        {
          id: "ak-shared-kitb",
          kitId: "kit-b",
          quantity: 1,
          asset: {
            id: "shared-banner",
            title: "Shared banner",
            type: AssetType.QUANTITY_TRACKED,
            unitOfMeasure: null,
            assetKits: [{ kitId: "kit-a" }, { kitId: "kit-b" }],
            bookingAssets: [
              {
                id: "ba-foreign",
                bookingId: "booking-foreign",
                assetId: "shared-banner",
                // Kit A's membership — this row is NOT Kit B's business.
                assetKitId: "ak-shared-kita",
                sourceKitId: "kit-a",
                quantity: 1,
                booking: { id: "booking-foreign", status: BookingStatus.DRAFT },
              },
            ],
          },
        },
        {
          id: "ak-member-kitb",
          kitId: "kit-b",
          quantity: 1,
          asset: {
            id: "kit-b-member",
            title: "Kit B member",
            type: AssetType.INDIVIDUAL,
            unitOfMeasure: null,
            assetKits: [{ kitId: "kit-b" }],
            bookingAssets: [
              {
                id: "ba-own",
                bookingId: "booking-own",
                assetId: "kit-b-member",
                assetKitId: "ak-member-kitb",
                sourceKitId: "kit-b",
                quantity: 1,
                booking: { id: "booking-own", status: BookingStatus.RESERVED },
              },
            ],
          },
        },
      ],
    };

    /** Full submitted membership: both existing members plus the new one. */
    const mockAssetsForKit = [
      {
        id: "shared-banner",
        title: "Shared banner",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        unitOfMeasure: null,
        assetKits: [{ kitId: "kit-a" }, { kitId: "kit-b" }],
        custody: [],
        bookingAssets: [],
        assetLocations: [],
      },
      {
        id: "kit-b-member",
        title: "Kit B member",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        unitOfMeasure: null,
        assetKits: [{ kitId: "kit-b" }],
        custody: [],
        bookingAssets: [],
        assetLocations: [],
      },
      {
        id: "hp-laserjet",
        title: "HP LaserJet",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        unitOfMeasure: null,
        assetKits: [],
        custody: [],
        bookingAssets: [],
        assetLocations: [],
      },
    ];

    //@ts-expect-error missing vitest type
    db.kit.findUniqueOrThrow.mockResolvedValue(mockKit);
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue(mockAssetsForKit);
    // The AssetKit row the pivot insert just created for the new member.
    //@ts-expect-error missing vitest type
    db.assetKit.findMany.mockResolvedValue([
      { id: "ak-hp-kitb", assetId: "hp-laserjet", quantity: 1 },
    ]);
  }

  /** Booking ids that received a propagated row, across all createMany calls. */
  function propagatedBookingIds(): string[] {
    // `mock.calls` is `any[][]`; narrow it to the single argument shape this
    // delegate is ever called with so the assertions stay type-checked.
    const calls = (db.bookingAsset.createMany as ReturnType<typeof vitest.fn>)
      .mock.calls as Array<[{ data: Array<{ bookingId: string }> }]>;
    return calls.flatMap(([arg]) => arg.data.map((row) => row.bookingId));
  }

  async function addNewMemberToKitB() {
    const { updateKitAssets } = await import("./service.server");
    await updateKitAssets({
      kitId: "kit-b",
      assetIds: ["shared-banner", "kit-b-member", "hp-laserjet"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });
  }

  it("does not add the new member to a booking that holds a different kit", async () => {
    arrangeKitB();

    await addNewMemberToKitB();

    // `booking-foreign` holds Kit A only. Writing here is the reported bug:
    // the booking grows an asset AND a whole kit its owner never added.
    expect(propagatedBookingIds()).not.toContain("booking-foreign");
  });

  it("adds the new member to a booking holding this kit even when an earlier member only has foreign rows", async () => {
    arrangeKitB();

    await addNewMemberToKitB();

    // The mirror-image failure of the same `.find()`: locking onto
    // `shared-banner` meant `booking-own` — which genuinely holds Kit B — was
    // skipped, so the kit silently drifted out of sync with its own booking.
    expect(propagatedBookingIds()).toContain("booking-own");
  });

  it("records a BOOKING_ASSETS_ADDED event for each propagated row", async () => {
    arrangeKitB();

    await addNewMemberToKitB();

    // `ActivityEvent` is reporting data, not the booking's notes feed — no
    // note is expected here, since nobody acted on the booking. Before this,
    // the propagated row landed with no trace in any table, which is why the
    // cross-kit leak could not be reconstructed after the fact.
    const addedEvents = (
      recordEvents as ReturnType<typeof vitest.fn>
    ).mock.calls
      .flatMap(([events]) => events as Array<Record<string, unknown>>)
      .filter((event) => event.action === "BOOKING_ASSETS_ADDED");

    expect(addedEvents).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        actorUserId: "user-1",
        action: "BOOKING_ASSETS_ADDED",
        entityType: "BOOKING",
        entityId: "booking-own",
        bookingId: "booking-own",
        assetId: "hp-laserjet",
        // Names the kit that pulled the asset in — the provenance whose
        // absence made the stray rows untraceable in the booking feed.
        kitId: "kit-b",
      }),
    ]);
  });

  it("writes the propagated rows and their events on one transaction client", async () => {
    arrangeKitB();

    await addNewMemberToKitB();

    // A propagated row that commits without its event is unrecoverable, not
    // merely untidy: the membership transaction has already persisted the
    // AssetKit row, so a retried call computes `newlyAddedAssets` as empty,
    // skips propagation entirely and never re-emits the event. Passing the
    // transaction client to `recordEvents` is what makes the row and its
    // audit trail commit or roll back together.
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ action: "BOOKING_ASSETS_ADDED" }),
      ]),
      expect.anything()
    );
  });
});
