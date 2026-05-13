import {
  AssetType,
  BarcodeType,
  KitStatus,
  AssetStatus,
  ErrorCorrection,
} from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

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
} from "./service.server";
import { recordEvents } from "../activity-event/service.server";
import { createNotes } from "../note/service.server";
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
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    location: {
      update: vitest.fn().mockResolvedValue({}),
      findUnique: vitest.fn().mockResolvedValue(null),
    },
    qr: {
      update: vitest.fn().mockResolvedValue({}),
    },
    teamMember: {
      findUnique: vitest.fn().mockResolvedValue(null),
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
    },
    note: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
  },
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
}));

// why: testing kit service without executing actual activity event recording
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
  recordEvents: vitest.fn().mockResolvedValue(undefined),
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

    // Notes written for both assets, kit name inlined (no link — kit gone).
    expect(createNotes).toHaveBeenCalledTimes(1);
    const notesArg = (createNotes as ReturnType<typeof vitest.fn>).mock
      .calls[0][0];
    expect(notesArg.assetIds).toEqual(["drill-1", "pens-1"]);
    expect(notesArg.content).toContain("when kit");
    expect(notesArg.content).toContain(mockKitData.name);
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

    // One note per in-custody kit (each note attributed to its
    // custodian) — 2 calls total.
    expect(createNotes).toHaveBeenCalledTimes(2);
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

    // Translated from main's PR #2535 to our pivot + Phase 3d-Polish-2 shape:
    //   - `kit` sourced via `assetKits.kit` pivot relation.
    //   - `custody` is Custody[] with the kit-inherited row keyed on
    //     `kitCustodyId` (Phase 3d-Polish-2 discriminator). The service
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
    db.teamMember.findUnique.mockResolvedValue({
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
        kitIds: ["kit-1"],
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow("There are some kits which are not in custody");
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

    const result = await getAvailableKitAssetForBooking(["kit-1", "kit-2"]);

    expect(db.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] } },
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

  it("should call asset updateMany when kit has location and assets are added", async () => {
    expect.assertions(2);

    const mockKit = {
      id: "kit-1",
      location: { id: "location-1", name: "Warehouse A" },
      assetKits: [],
      custody: null,
    };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        assetKits: [],
        custody: null,
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
      assetIds: ["asset-1"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // onto direct pivot inserts via `assetKit.createMany`.
    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: [{ assetId: "asset-1", kitId: "kit-1", organizationId: "org-1" }],
    });

    // Should update asset locations (cascade behavior)
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] } },
      data: { locationId: "location-1" },
    });
  });

  it("should set asset location to null when kit has no location", async () => {
    expect.assertions(2);

    const mockKit = {
      id: "kit-1",
      location: null,
      assetKits: [],
      custody: null,
    };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        assetKits: [],
        custody: null,
        location: { id: "location-1", name: "Current Location" },
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

    // onto direct pivot inserts via `assetKit.createMany`.
    expect(db.assetKit.createMany).toHaveBeenCalledWith({
      data: [{ assetId: "asset-1", kitId: "kit-1", organizationId: "org-1" }],
    });

    // Should remove location from assets (set to null)
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] } },
      data: { locationId: null },
    });
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

    /** One INDIVIDUAL + one QUANTITY_TRACKED asset, both new to the kit. */
    const mockNewAssets = [
      {
        id: "asset-individual",
        title: "Single",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        assetKits: [],
        custody: [],
        location: null,
      },
      {
        id: "asset-qty",
        title: "Batch of 50",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
        assetKits: [],
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
    // why: helper now does its own asset.findMany inside the tx to compute
    // remaining-pool — both assets free, so kit row claims full quantity.
    //@ts-expect-error missing vitest type
    db.asset.findMany.mockResolvedValue([
      {
        id: "asset-individual",
        type: AssetType.INDIVIDUAL,
        quantity: null,
        custody: [],
      },
      {
        id: "asset-qty",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 50,
        custody: [],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkAssignKitCustody({
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
    expect(recordEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: "CUSTODY_ASSIGNED",
          assetId: "asset-individual",
          meta: expect.objectContaining({ viaKit: true, quantity: 1 }),
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
      { id: "drill", type: AssetType.INDIVIDUAL, quantity: null, custody: [] },
      {
        id: "pens",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 80,
        // 4 of 80 already operator-allocated → kit row should claim 76.
        custody: [{ quantity: 4 }],
      },
    ]);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((callback) => callback(db));

    await bulkAssignKitCustody({
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
