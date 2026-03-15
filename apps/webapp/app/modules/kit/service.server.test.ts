import { BarcodeType, KitStatus, AssetStatus } from "@shelf/database";

import { db } from "~/database/db.server";
import {
  create,
  findMany,
  findFirst,
  findFirstOrThrow,
  findUnique,
  findUniqueOrThrow,
  update,
  remove,
  deleteMany,
  updateMany,
  createMany,
} from "~/database/query-helpers.server";
import { rpc } from "~/database/transaction.server";
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
} from "./service.server";
import { getQr } from "../qr/service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock dependencies
// why: testing kit service logic without executing actual database operations
vitest.mock("~/database/db.server", () => ({
  db: {},
}));

// why: auto-mock all query helpers so each test can set return values individually
vitest.mock("~/database/query-helpers.server");

// why: auto-mock transaction helper so rpc calls are intercepted
vitest.mock("~/database/transaction.server");

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

// why: isolating kit service logic from asset utility dependencies
vitest.mock("~/modules/asset/utils.server", () => ({
  getKitLocationUpdateNoteContent: vitest
    .fn()
    .mockReturnValue("Mock note content"),
  getAssetsWhereInput: vitest.fn().mockReturnValue({}),
}));

// why: isolating from location note service
vitest.mock("~/modules/location-note/service.server", () => ({
  createSystemLocationNote: vitest.fn().mockResolvedValue({}),
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
    vi.mocked(create).mockResolvedValue(mockKitData as any);

    const result = await createKit(mockCreateParams);

    expect(create).toHaveBeenCalledWith(db, "Kit", {
      id: "mock-id",
      name: "Test Kit",
      description: "Test Description",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: "category-1",
      locationId: null,
    });
    expect(result).toEqual(mockKitData);
  });

  it("should create a kit without category when categoryId is null", async () => {
    expect.assertions(1);
    vi.mocked(create).mockResolvedValue(mockKitData as any);

    await createKit({
      ...mockCreateParams,
      categoryId: null,
      locationId: null,
    });

    expect(create).toHaveBeenCalledWith(db, "Kit", {
      id: "mock-id",
      name: "Test Kit",
      description: "Test Description",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: null,
      locationId: null,
    });
  });

  it("should create a kit with barcodes", async () => {
    expect.assertions(2);
    vi.mocked(create).mockResolvedValue(mockKitData as any);
    vi.mocked(createMany).mockResolvedValue(undefined as any);

    const barcodes = [
      { type: BarcodeType.Code128, value: "TEST123" },
      { type: BarcodeType.Code39, value: "ABC456" },
    ];

    await createKit({
      ...mockCreateParams,
      barcodes,
      locationId: null,
    });

    expect(create).toHaveBeenCalledWith(db, "Kit", {
      id: "mock-id",
      name: "Test Kit",
      description: "Test Description",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: "category-1",
      locationId: null,
    });
    expect(createMany).toHaveBeenCalledWith(db, "Barcode", [
      {
        type: BarcodeType.Code128,
        value: "TEST123",
        organizationId: "org-1",
        kitId: "kit-1",
      },
      {
        type: BarcodeType.Code39,
        value: "ABC456",
        organizationId: "org-1",
        kitId: "kit-1",
      },
    ]);
  });

  it("should filter out invalid barcodes", async () => {
    expect.assertions(1);
    vi.mocked(create).mockResolvedValue(mockKitData as any);
    vi.mocked(createMany).mockResolvedValue(undefined as any);

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

    expect(createMany).toHaveBeenCalledWith(db, "Barcode", [
      {
        type: BarcodeType.Code128,
        value: "TEST123",
        organizationId: "org-1",
        kitId: "kit-1",
      },
    ]);
  });

  it("should handle barcode constraint violations", async () => {
    expect.assertions(1);

    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Postgres error properties
    constraintError.code = "23505";
    //@ts-expect-error adding Postgres error properties
    constraintError.details =
      'Key (value, "organizationId")=(DUPLICATE123, org1) already exists.';

    vi.mocked(create).mockRejectedValue(constraintError);

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
    vi.mocked(update).mockResolvedValue(updatedKit as any);

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

    expect(update).toHaveBeenCalledWith(db, "Kit", {
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: "Updated Description",
        image: undefined,
        imageExpiration: undefined,
        status: KitStatus.AVAILABLE,
        categoryId: "category-2",
      },
    });
    expect(result).toEqual(updatedKit);
  });

  it("should disconnect category when categoryId is 'uncategorized'", async () => {
    expect.assertions(1);
    vi.mocked(update).mockResolvedValue(mockKitData as any);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: "uncategorized",
      locationId: null,
    });

    expect(update).toHaveBeenCalledWith(db, "Kit", {
      where: { id: "kit-1", organizationId: "org-1" },
      data: {
        name: "Updated Kit",
        description: undefined,
        image: undefined,
        imageExpiration: undefined,
        status: undefined,
        categoryId: null,
      },
    });
  });

  it("should not change category when categoryId is null", async () => {
    expect.assertions(1);
    vi.mocked(update).mockResolvedValue(mockKitData as any);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: null,
      locationId: null,
    });

    expect(update).toHaveBeenCalledWith(db, "Kit", {
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
    vi.mocked(update).mockResolvedValue(mockKitData as any);

    await updateKit({
      id: "kit-1",
      name: "Updated Kit",
      createdById: "user-1",
      organizationId: "org-1",
      categoryId: undefined,
      locationId: null,
    });

    expect(update).toHaveBeenCalledWith(db, "Kit", {
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
    vi.mocked(update).mockResolvedValue(mockKitData as any);
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

    expect(update).toHaveBeenCalled();
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
    vi.mocked(findFirstOrThrow).mockResolvedValue(mockKitData as any);

    const result = await getKit({
      id: "kit-1",
      organizationId: "org-1",
    });

    expect(findFirstOrThrow).toHaveBeenCalledWith(db, "Kit", {
      where: {
        OR: [{ id: "kit-1", organizationId: "org-1" }],
      },
      select: "*",
    });
    expect(result).toEqual(mockKitData);
  });

  it("should handle cross-organization access", async () => {
    expect.assertions(1);
    const crossOrgKit = { ...mockKitData, organizationId: "other-org" };
    vi.mocked(findFirstOrThrow).mockResolvedValue(crossOrgKit as any);

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
    vi.mocked(findFirstOrThrow).mockRejectedValue(new Error("Not found"));

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
    vi.mocked(remove).mockResolvedValue([mockKitData] as any);

    const result = await deleteKit({
      id: "kit-1",
      organizationId: "org-1",
    });

    expect(remove).toHaveBeenCalledWith(db, "Kit", {
      id: "kit-1",
      organizationId: "org-1",
    });
    expect(result).toEqual(mockKitData);
  });

  it("should handle deletion errors", async () => {
    expect.assertions(1);
    vi.mocked(remove).mockRejectedValue(new Error("Deletion failed"));

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
    vi.mocked(findMany).mockResolvedValue(kitsToDelete as any);
    vi.mocked(deleteMany).mockResolvedValue(undefined as any);

    await bulkDeleteKits({
      kitIds: ["kit-1", "kit-2"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(findMany).toHaveBeenCalledWith(db, "Kit", {
      where: { id: { in: ["kit-1", "kit-2"] }, organizationId: "org-1" },
      select: "id, image",
    });
    expect(deleteMany).toHaveBeenCalledWith(db, "Kit", {
      id: { in: ["kit-1", "kit-2"] },
    });
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
      },
    ];
    const kitAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        status: AssetStatus.AVAILABLE,
        kitId: "kit-1",
      },
    ];
    vi.mocked(findMany)
      .mockResolvedValueOnce(availableKits as any) // kits
      .mockResolvedValueOnce(kitAssets as any); // assets for kits
    vi.mocked(findUnique).mockResolvedValue({
      id: "custodian-1",
      name: "John Doe",
      User: { id: "user-1", firstName: "John", lastName: "Doe" },
    } as any);
    vi.mocked(rpc).mockResolvedValue(undefined as any);
    vi.mocked(createMany).mockResolvedValue(undefined as any);

    await bulkAssignKitCustody({
      kitIds: ["kit-1"],
      organizationId: "org-1",
      custodianId: "custodian-1",
      custodianName: "John Doe",
      userId: "user-1",
    });

    expect(findMany).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(db, "kit_assign_custody", {
      p_kit_id: "kit-1",
      p_custodian_id: "custodian-1",
      p_asset_ids: ["asset-1"],
    });
    expect(createMany).toHaveBeenCalled();
  });

  it("should throw error when kits are not available", async () => {
    expect.assertions(1);
    const unavailableKits = [
      {
        id: "kit-1",
        name: "Kit 1",
        status: KitStatus.IN_CUSTODY,
      },
    ];
    vi.mocked(findMany)
      .mockResolvedValueOnce(unavailableKits as any) // kits
      .mockResolvedValueOnce([] as any); // assets
    vi.mocked(findUnique).mockResolvedValue(null as any);

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
      },
    ];
    vi.mocked(findMany)
      .mockResolvedValueOnce(kitsInCustody as any) // kits
      .mockResolvedValueOnce([
        // assets
        {
          id: "asset-1",
          status: AssetStatus.IN_CUSTODY,
          title: "Asset 1",
          kitId: "kit-1",
        },
      ] as any);
    vi.mocked(findFirst).mockResolvedValue({
      id: "custody-1",
      TeamMember: { name: "John Doe" },
    } as any);
    vi.mocked(rpc).mockResolvedValue(undefined as any);
    vi.mocked(createMany).mockResolvedValue(undefined as any);

    await bulkReleaseKitCustody({
      kitIds: ["kit-1"],
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(findMany).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(db, "kit_release_custody", {
      p_kit_id: "kit-1",
      p_asset_ids: ["asset-1"],
    });
  });

  it("should throw error when kits are not in custody", async () => {
    expect.assertions(1);
    const availableKits = [
      {
        id: "kit-1",
        status: KitStatus.AVAILABLE,
      },
    ];
    vi.mocked(findMany)
      .mockResolvedValueOnce(availableKits as any) // kits
      .mockResolvedValueOnce([] as any); // assets
    vi.mocked(findFirst).mockResolvedValue(null as any);

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
    };
    vi.mocked(findUniqueOrThrow).mockResolvedValue(kitWithCustody as any);
    vi.mocked(findMany).mockResolvedValue([
      { id: "asset-1", title: "Test Asset" },
    ] as any);
    vi.mocked(findFirst).mockResolvedValue({
      id: "custody-1",
      TeamMember: { name: "Jane Smith", User: {} },
    } as any);
    vi.mocked(rpc).mockResolvedValue(undefined as any);

    const result = await releaseCustody({
      kitId: "kit-1",
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(findUniqueOrThrow).toHaveBeenCalledWith(db, "Kit", {
      where: { id: "kit-1", organizationId: "org-1" },
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

    vi.mocked(findFirst)
      .mockResolvedValueOnce(null as any) // New Kit doesn't exist
      .mockResolvedValueOnce({
        id: "existing-kit-id",
        name: "Existing Kit",
      } as any); // Existing Kit exists

    vi.mocked(create).mockResolvedValue({
      id: "new-kit-id",
      name: "New Kit",
    } as any);

    const result = await createKitsIfNotExists({
      data: importData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(create).toHaveBeenCalledWith(db, "Kit", {
      name: "New Kit",
      createdById: "user-1",
      organizationId: "org-1",
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
    const updatedQr = { id: "new-qr-id", kitId: "kit-1" };
    vi.mocked(updateMany).mockResolvedValue(undefined as any);
    vi.mocked(update).mockResolvedValue(updatedQr as any);

    const _result = await updateKitQrCode({
      kitId: "kit-1",
      newQrId: "new-qr-id",
      organizationId: "org-1",
    });

    expect(updateMany).toHaveBeenCalledWith(db, "Qr", {
      where: { kitId: "kit-1" },
      data: { kitId: null },
    });
    expect(update).toHaveBeenCalledWith(db, "Qr", {
      where: { id: "new-qr-id" },
      data: { kitId: "kit-1" },
    });
  });
});

describe("relinkKitQrCode", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should relink qr code to kit", async () => {
    expect.assertions(3);
    vi.mocked(getQr).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: null,
    } as any);
    vi.mocked(findFirst).mockResolvedValue({
      id: "kit-1",
      organizationId: "org-1",
    } as any);
    vi.mocked(findMany).mockResolvedValue([{ id: "old-qr-id" }] as any);
    vi.mocked(update).mockResolvedValue({} as any);
    vi.mocked(updateMany).mockResolvedValue(undefined as any);

    const result = await relinkKitQrCode({
      qrId: "qr-1",
      kitId: "kit-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(update).toHaveBeenCalledWith(db, "Qr", {
      where: { id: "qr-1" },
      data: { organizationId: "org-1", userId: "user-1" },
    });
    expect(updateMany).toHaveBeenCalled();
    expect(result).toEqual({ oldQrCodeId: "old-qr-id", newQrId: "qr-1" });
  });

  it("should throw when qr code belongs to another asset", async () => {
    expect.assertions(1);
    vi.mocked(getQr).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-1",
      kitId: null,
    } as any);
    vi.mocked(findFirst).mockResolvedValue({
      id: "kit-1",
      organizationId: "org-1",
    } as any);
    vi.mocked(findMany).mockResolvedValue([] as any);

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
    const kitAssets = [
      { id: "asset-1", status: AssetStatus.AVAILABLE },
      { id: "asset-2", status: AssetStatus.IN_CUSTODY },
      { id: "asset-3", status: AssetStatus.AVAILABLE },
    ];
    vi.mocked(findMany).mockResolvedValue(kitAssets as any);

    const result = await getAvailableKitAssetForBooking(["kit-1", "kit-2"]);

    expect(findMany).toHaveBeenCalledWith(db, "Asset", {
      where: { kitId: { in: ["kit-1", "kit-2"] } },
      select: "id, status",
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
    expect.assertions(1);
    const kits = [
      {
        ...mockKitData,
        locationId: null,
        id: "kit-co",
        status: KitStatus.CHECKED_OUT,
      },
    ];

    // why: simulating asset with active booking and custodian user
    // First findMany returns kit assets, second returns bookings
    vi.mocked(findMany)
      .mockResolvedValueOnce([{ id: "asset-1" }] as any) // kit assets
      .mockResolvedValueOnce([
        // bookings for asset
        {
          id: "booking-1",
          custodianTeamMember: null,
          custodianUser: {
            firstName: "Jane",
            lastName: "Doe",
            profilePicture: "pic.jpg",
          },
        },
      ] as any);

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
    vi.mocked(findMany)
      .mockResolvedValueOnce([{ id: "asset-1" }] as any) // kit assets
      .mockResolvedValueOnce([
        // bookings
        {
          id: "booking-1",
          custodianTeamMember: { name: "External Contractor" },
          custodianUser: null,
        },
      ] as any);

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

    // why: reproducing the Sentry error scenario where no asset has an ONGOING/OVERDUE booking
    vi.mocked(findMany)
      .mockResolvedValueOnce([{ id: "asset-1" }] as any) // kit assets
      .mockResolvedValueOnce([] as any); // no bookings

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

  it("should update asset locations when kit has location and assets are added", async () => {
    expect.assertions(2);

    const mockKit = {
      id: "kit-1",
      locationId: "location-1",
      status: KitStatus.AVAILABLE,
    };

    const mockLocation = { id: "location-1", name: "Warehouse A" };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        kitId: null,
        locationId: null,
      },
    ];

    vi.mocked(findUniqueOrThrow).mockResolvedValue(mockKit as any);
    vi.mocked(findUnique).mockResolvedValue(mockLocation as any);
    vi.mocked(findMany).mockImplementation(
      (_db: any, table: string, _opts?: any) => {
        if (table === "Asset" && _opts?.where?.kitId) {
          return Promise.resolve([] as any); // existing kit assets
        }
        if (table === "Asset" && _opts?.where?.id) {
          return Promise.resolve(mockNewAssets as any); // allAssetsForKit
        }
        if (table === "Custody") {
          return Promise.resolve([] as any);
        }
        if (table === "Location") {
          return Promise.resolve([] as any);
        }
        return Promise.resolve([] as any);
      }
    );
    vi.mocked(findFirst).mockResolvedValue(null as any); // kitCustody
    vi.mocked(rpc).mockResolvedValue(undefined as any);
    vi.mocked(updateMany).mockResolvedValue(undefined as any);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["asset-1"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // Should use rpc for atomic kit update
    expect(rpc).toHaveBeenCalledWith(db, "kit_update_with_assets", {
      p_kit_id: "kit-1",
      p_data: {},
      p_add_asset_ids: ["asset-1"],
      p_remove_asset_ids: [],
    });

    // Should update asset locations (cascade behavior)
    expect(updateMany).toHaveBeenCalledWith(db, "Asset", {
      where: { id: { in: ["asset-1"] } },
      data: { locationId: "location-1" },
    });
  });

  it("should set asset location to null when kit has no location", async () => {
    const mockKit = {
      id: "kit-1",
      locationId: null,
      status: KitStatus.AVAILABLE,
    };

    const mockNewAssets = [
      {
        id: "asset-1",
        title: "Asset 1",
        kitId: null,
        locationId: "location-1",
      },
    ];

    vi.mocked(findUniqueOrThrow).mockResolvedValue(mockKit as any);
    vi.mocked(findMany).mockImplementation(
      (_db: any, table: string, _opts?: any) => {
        if (table === "Asset" && _opts?.where?.kitId) {
          return Promise.resolve([] as any); // existing kit assets
        }
        if (table === "Asset" && _opts?.where?.id) {
          return Promise.resolve(mockNewAssets as any); // allAssetsForKit
        }
        if (table === "Custody") {
          return Promise.resolve([] as any);
        }
        if (table === "Location") {
          return Promise.resolve([
            { id: "location-1", name: "Current Location" },
          ] as any);
        }
        return Promise.resolve([] as any);
      }
    );
    vi.mocked(findFirst).mockResolvedValue(null as any); // kitCustody
    vi.mocked(findUnique).mockResolvedValue(null as any);
    vi.mocked(rpc).mockResolvedValue(undefined as any);
    vi.mocked(updateMany).mockResolvedValue(undefined as any);

    const { updateKitAssets } = await import("./service.server");

    await updateKitAssets({
      kitId: "kit-1",
      assetIds: ["asset-1"],
      userId: "user-1",
      organizationId: "org-1",
      request: new Request("http://test.com"),
    });

    // Should use rpc for atomic kit update
    expect(rpc).toHaveBeenCalledWith(db, "kit_update_with_assets", {
      p_kit_id: "kit-1",
      p_data: {},
      p_add_asset_ids: ["asset-1"],
      p_remove_asset_ids: [],
    });

    // Should remove location from assets (set to null)
    expect(updateMany).toHaveBeenCalledWith(db, "Asset", {
      where: {
        id: { in: ["asset-1"] },
      },
      data: { locationId: null },
    });
  });
});
