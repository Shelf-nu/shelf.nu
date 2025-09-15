import {
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
  getAvailableKitAssetForBooking,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock dependencies
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
    kitCustody: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    custody: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
    note: {
      createMany: vitest.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vitest.mock("~/utils/id/id.server", () => ({
  id: vitest.fn(() => "mock-id"),
}));

vitest.mock("~/modules/qr/service.server", () => ({
  getQr: vitest.fn(),
}));

vitest.mock("~/modules/barcode/service.server", () => ({
  updateBarcodes: vitest.fn(),
  validateBarcodeUniqueness: vitest.fn(),
}));

vitest.mock("~/modules/user/service.server", () => ({
  getUserByID: vitest.fn().mockResolvedValue({
    id: "user-1",
    firstName: "John",
    lastName: "Doe",
  }),
}));

vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue({}),
  createBulkKitChangeNotes: vitest.fn().mockResolvedValue({}),
}));

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

  it("should delete kit successfully", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.kit.delete.mockResolvedValue(mockKitData);

    const result = await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
    });

    expect(db.kit.delete).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
    });
    expect(result).toEqual(mockKitData);
  });

  it("should handle deletion errors", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.kit.delete.mockRejectedValue(new Error("Deletion failed"));

    await expect(
      deleteKit({
        id: "kit-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(ShelfError);
  });
});

describe("bulkDeleteKits", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should bulk delete kits successfully", async () => {
    expect.assertions(2);
    const kitsToDelete = [
      { id: "kit-1", image: "image1.jpg" },
      { id: "kit-2", image: null },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsToDelete);
    //@ts-expect-error missing vitest type
    db.$transaction.mockResolvedValue(true);

    await bulkDeleteKits({
      kitIds: ["kit-1", "kit-2"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
      select: { id: true, image: true },
    });
    expect(db.$transaction).toHaveBeenCalled();
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
    db.$transaction.mockResolvedValue(true);

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
    db.$transaction.mockResolvedValue(true);

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
      assets: [{ id: "asset-1", title: "Test Asset" }],
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
    expect(result).toEqual(kitWithCustody);
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

describe("getAvailableKitAssetForBooking", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should return asset IDs from selected kits", async () => {
    expect.assertions(2);
    const kitsWithAssets = [
      {
        assets: [
          { id: "asset-1", status: AssetStatus.AVAILABLE },
          { id: "asset-2", status: AssetStatus.IN_CUSTODY },
        ],
      },
      {
        assets: [{ id: "asset-3", status: AssetStatus.AVAILABLE }],
      },
    ];
    //@ts-expect-error missing vitest type
    db.kit.findMany.mockResolvedValue(kitsWithAssets);

    const result = await getAvailableKitAssetForBooking(["kit-1", "kit-2"]);

    expect(db.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["kit-1", "kit-2"] } },
      select: { assets: { select: { id: true, status: true } } },
    });
    expect(result).toEqual(["asset-1", "asset-2", "asset-3"]);
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
      assets: [],
      custody: null,
    };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        kit: null,
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

    // Should update kit assets
    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        assets: {
          connect: [{ id: "asset-1" }],
        },
      },
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
      assets: [],
      custody: null,
    };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        kit: null,
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

    // Should update kit assets
    expect(db.kit.update).toHaveBeenCalledWith({
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        assets: {
          connect: [{ id: "asset-1" }],
        },
      },
    });

    // Should remove location from assets (set to null)
    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] } },
      data: { locationId: null },
    });
  });
});
