import { BarcodeType } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import {
  createBarcode,
  createBarcodes,
  updateBarcode,
  deleteBarcodes,
  getBarcodeByValue,
  getAssetBarcodes,
  updateBarcodes,
  replaceBarcodes,
  validateBarcodeUniqueness,
} from "./service.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

// Mock db
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest.fn().mockImplementation((callback) => callback(db)),
    barcode: {
      create: vitest.fn().mockResolvedValue({}),
      createMany: vitest.fn().mockResolvedValue({}),
      update: vitest.fn().mockResolvedValue({}),
      delete: vitest.fn().mockResolvedValue({}),
      deleteMany: vitest.fn().mockResolvedValue({}),
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
    },
  },
}));

const mockTransaction = db.$transaction as ReturnType<typeof vitest.fn>;

const mockBarcodeData = {
  id: "barcode-1",
  type: BarcodeType.Code128,
  value: "TEST123",
  organizationId: "org-1",
  assetId: "asset-1",
  kitId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCreateParams = {
  type: BarcodeType.Code128,
  value: "TEST123",
  organizationId: "org-1",
  userId: "user-1",
  assetId: "asset-1",
};

describe("createBarcode", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should create a barcode successfully", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.create.mockResolvedValue(mockBarcodeData);

    const result = await createBarcode(mockCreateParams);

    expect(db.barcode.create).toHaveBeenCalledWith({
      data: {
        type: BarcodeType.Code128,
        value: "TEST123",
        organizationId: "org-1",
        assetId: "asset-1",
      },
    });
    expect(result).toEqual(mockBarcodeData);
  });

  it("should normalize barcode value to uppercase", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.create.mockResolvedValue(mockBarcodeData);

    await createBarcode({
      ...mockCreateParams,
      value: "test123",
    });

    expect(db.barcode.create).toHaveBeenCalledWith({
      data: {
        type: BarcodeType.Code128,
        value: "TEST123",
        organizationId: "org-1",
        assetId: "asset-1",
      },
    });
  });

  it("should throw error for invalid barcode value", async () => {
    expect.assertions(1);

    await expect(
      createBarcode({
        ...mockCreateParams,
        value: "AB", // Too short for Code128
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should create barcode for kit when kitId provided", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.create.mockResolvedValue(mockBarcodeData);

    await createBarcode({
      type: BarcodeType.Code128,
      value: "TEST123",
      organizationId: "org-1",
      userId: "user-1",
      kitId: "kit-1",
    });

    expect(db.barcode.create).toHaveBeenCalledWith({
      data: {
        type: BarcodeType.Code128,
        value: "TEST123",
        organizationId: "org-1",
        kitId: "kit-1",
      },
    });
  });

  it("should handle constraint violations with detailed validation", async () => {
    expect.assertions(1);

    // Mock Prisma constraint violation error
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.barcode.create.mockRejectedValue(constraintError);

    // Mock the database query to simulate existing barcode
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([
      {
        id: "existing-1",
        value: "DUPLICATE123",
        assetId: "other-asset",
        kitId: null,
        asset: { title: "Test Asset" },
        kit: null,
      },
    ]);

    await expect(
      createBarcode({
        type: BarcodeType.Code128,
        value: "DUPLICATE123",
        organizationId: "org-1",
        userId: "user-1",
        assetId: "asset-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });
});

describe("createBarcodes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should create multiple barcodes successfully", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.createMany.mockResolvedValue({ count: 2 });

    const barcodes = [
      { type: BarcodeType.Code128, value: "TEST123" },
      { type: BarcodeType.Code39, value: "ABC123" },
    ];

    await createBarcodes({
      barcodes,
      organizationId: "org-1",
      userId: "user-1",
      assetId: "asset-1",
    });

    expect(db.barcode.createMany).toHaveBeenCalledWith({
      data: [
        {
          type: BarcodeType.Code128,
          value: "TEST123",
          organizationId: "org-1",
          assetId: "asset-1",
        },
        {
          type: BarcodeType.Code39,
          value: "ABC123",
          organizationId: "org-1",
          assetId: "asset-1",
        },
      ],
    });
  });

  it("should handle empty barcodes array", async () => {
    expect.assertions(1);

    await createBarcodes({
      barcodes: [],
      organizationId: "org-1",
      userId: "user-1",
      assetId: "asset-1",
    });

    expect(db.barcode.createMany).not.toHaveBeenCalled();
  });

  it("should throw error for invalid barcode in batch", async () => {
    expect.assertions(1);

    const barcodes = [
      { type: BarcodeType.Code128, value: "TEST123" },
      { type: BarcodeType.Code128, value: "AB" }, // Invalid
    ];

    await expect(
      createBarcodes({
        barcodes,
        organizationId: "org-1",
        userId: "user-1",
        assetId: "asset-1",
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should handle constraint violations with detailed validation", async () => {
    expect.assertions(1);

    // Mock Prisma constraint violation error
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.barcode.createMany.mockRejectedValue(constraintError);

    // Mock the database query to simulate existing barcode
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([
      {
        id: "existing-1",
        value: "DUPLICATE123",
        assetId: "other-asset",
        kitId: null,
        asset: { title: "Test Asset" },
        kit: null,
      },
    ]);

    const barcodes = [{ type: BarcodeType.Code128, value: "DUPLICATE123" }];

    await expect(
      createBarcodes({
        barcodes,
        organizationId: "org-1",
        userId: "user-1",
        kitId: "kit-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });

  it("should handle constraint violations for kit barcodes", async () => {
    expect.assertions(1);

    // Mock Prisma constraint violation error
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.barcode.createMany.mockRejectedValue(constraintError);

    // Mock the database query to simulate existing barcode
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([
      {
        id: "existing-1",
        value: "DUPLICATE123",
        assetId: null,
        kitId: "other-kit",
        asset: null,
        kit: { name: "Test Kit" },
      },
    ]);

    const barcodes = [{ type: BarcodeType.Code128, value: "DUPLICATE123" }];

    await expect(
      createBarcodes({
        barcodes,
        organizationId: "org-1",
        userId: "user-1",
        kitId: "kit-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });
});

describe("updateBarcode", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should update barcode successfully", async () => {
    expect.assertions(2);
    const updatedBarcode = { ...mockBarcodeData, value: "UPD123" };
    //@ts-expect-error missing vitest type
    db.barcode.update.mockResolvedValue(updatedBarcode);

    const result = await updateBarcode({
      id: "barcode-1",
      type: BarcodeType.Code39,
      value: "upd123",
      organizationId: "org-1",
      assetId: "asset-1",
    });

    expect(db.barcode.update).toHaveBeenCalledWith({
      where: { id: "barcode-1", organizationId: "org-1" },
      data: { type: BarcodeType.Code39, value: "UPD123" },
    });
    expect(result).toEqual(updatedBarcode);
  });

  it("should update only provided fields", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.update.mockResolvedValue(mockBarcodeData);

    await updateBarcode({
      id: "barcode-1",
      value: "upd123",
      organizationId: "org-1",
      assetId: "asset-1",
    });

    expect(db.barcode.update).toHaveBeenCalledWith({
      where: { id: "barcode-1", organizationId: "org-1" },
      data: { value: "UPD123" },
    });
  });

  it("should handle constraint violations with detailed validation", async () => {
    expect.assertions(1);

    // Mock Prisma constraint violation error
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.barcode.update.mockRejectedValue(constraintError);

    // Mock the database query to simulate existing barcode
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([
      {
        id: "existing-1",
        value: "DUPLICATE123",
        assetId: "other-asset",
        kitId: null,
        asset: { title: "Test Asset" },
        kit: null,
      },
    ]);

    await expect(
      updateBarcode({
        id: "barcode-1",
        type: BarcodeType.Code128,
        value: "DUPLICATE123",
        organizationId: "org-1",
        assetId: "asset-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });

  it("should handle constraint violations for kit barcodes", async () => {
    expect.assertions(1);

    // Mock Prisma constraint violation error
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";
    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.barcode.update.mockRejectedValue(constraintError);

    // Mock the database query to simulate existing barcode
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([
      {
        id: "existing-1",
        value: "DUPLICATE123",
        assetId: null,
        kitId: "other-kit",
        asset: null,
        kit: { name: "Test Kit" },
      },
    ]);

    await expect(
      updateBarcode({
        id: "barcode-1",
        type: BarcodeType.Code128,
        value: "DUPLICATE123",
        organizationId: "org-1",
        kitId: "kit-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });
});

describe("getBarcodeByValue", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should find barcode by value", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findFirst.mockResolvedValue(mockBarcodeData);

    const result = await getBarcodeByValue({
      value: "test123",
      organizationId: "org-1",
    });

    expect(db.barcode.findFirst).toHaveBeenCalledWith({
      where: {
        value: "TEST123",
        organizationId: "org-1",
      },
      include: {
        asset: true,
        kit: true,
      },
    });
    expect(result).toEqual(mockBarcodeData);
  });

  it("should return null when barcode not found", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.findFirst.mockResolvedValue(null);

    const result = await getBarcodeByValue({
      value: "NOTFOUND",
      organizationId: "org-1",
    });

    expect(result).toBeNull();
  });
});

describe("getAssetBarcodes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should get barcodes for asset", async () => {
    expect.assertions(2);
    const barcodes = [mockBarcodeData];
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue(barcodes);

    const result = await getAssetBarcodes({
      assetId: "asset-1",
      organizationId: "org-1",
    });

    expect(db.barcode.findMany).toHaveBeenCalledWith({
      where: {
        assetId: "asset-1",
        organizationId: "org-1",
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    expect(result).toEqual(barcodes);
  });
});

describe("updateBarcodes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should update existing barcodes and create new ones", async () => {
    expect.assertions(4);
    const existingBarcodes = [
      { id: "barcode-1", type: BarcodeType.Code128, value: "OLD123" },
    ];
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue(existingBarcodes);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((operations) =>
      Promise.all(operations.map(() => ({ success: true })))
    );

    const barcodes = [
      { id: "barcode-1", type: BarcodeType.Code128, value: "UPDATED123" },
      { type: BarcodeType.Code39, value: "NEW123" }, // No ID = new barcode
    ];

    await updateBarcodes({
      barcodes,
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.barcode.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        assetId: "asset-1",
      },
    });

    // Should create one update operation and one create operation
    expect(db.$transaction).toHaveBeenCalledWith([
      expect.objectContaining({
        // This would be the update operation for existing barcode
      }),
      expect.objectContaining({
        // This would be the create operation for new barcode
      }),
    ]);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const transactionOperations = mockTransaction.mock.calls[0][0];
    expect(transactionOperations).toHaveLength(2); // One update, one create
  });

  it("should delete barcodes not in new list", async () => {
    expect.assertions(2);
    const existingBarcodes = [
      { id: "barcode-1", type: BarcodeType.Code128, value: "OLD123" },
      { id: "barcode-2", type: BarcodeType.Code39, value: "OLD456" },
    ];
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue(existingBarcodes);
    //@ts-expect-error missing vitest type
    db.$transaction.mockImplementation((operations) =>
      Promise.all(operations.map(() => ({ success: true })))
    );

    const barcodes = [
      { id: "barcode-1", type: BarcodeType.Code128, value: "UPDATED123" },
      // barcode-2 is missing, so it should be deleted
    ];

    await updateBarcodes({
      barcodes,
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const transactionOperations = mockTransaction.mock.calls[0][0];
    expect(transactionOperations).toHaveLength(2); // One update, one deleteMany
  });

  it("should validate all barcodes before processing", async () => {
    expect.assertions(1);

    const barcodes = [
      { type: BarcodeType.Code128, value: "AB" }, // Invalid - too short
    ];

    await expect(
      updateBarcodes({
        barcodes,
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow(ShelfError);
  });

  it("should handle constraint violations with detailed validation", async () => {
    expect.assertions(1);

    // Mock existing barcodes for the updateBarcodes function
    db.barcode.findMany
      //@ts-expect-error adding Prisma error properties
      .mockResolvedValueOnce([]) // For current asset barcodes
      .mockResolvedValueOnce([
        // For uniqueness check
        {
          id: "existing-1",
          value: "DUPLICATE123",
          assetId: "other-asset",
          kitId: null,
          asset: { title: "Test Asset" },
          kit: null,
        },
      ]);

    // Mock Prisma constraint violation error in transaction
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";

    //@ts-expect-error adding Prisma error properties
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.$transaction.mockRejectedValue(constraintError);

    const barcodes = [
      { id: "barcode-1", type: BarcodeType.Code128, value: "DUPLICATE123" },
      { type: BarcodeType.Code39, value: "NEW456" }, // No ID = new barcode
    ];

    await expect(
      updateBarcodes({
        barcodes,
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });

  it("should handle constraint violations for kit updates", async () => {
    expect.assertions(1);

    // Mock existing barcodes for the updateBarcodes function
    db.barcode.findMany
      //@ts-expect-error missing vitest type
      .mockResolvedValueOnce([]) // For current kit barcodes
      .mockResolvedValueOnce([
        // For uniqueness check
        {
          id: "existing-1",
          value: "DUPLICATE123",
          assetId: null,
          kitId: "other-kit",
          asset: null,
          kit: { name: "Test Kit" },
        },
      ]);

    // Mock Prisma constraint violation error in transaction
    const constraintError = new Error("Unique constraint failed");
    //@ts-expect-error adding Prisma error properties
    constraintError.code = "P2002";

    //@ts-expect-error missing vitest type
    constraintError.meta = { target: ["value"] };

    //@ts-expect-error missing vitest type
    db.$transaction.mockRejectedValue(constraintError);

    const barcodes = [{ type: BarcodeType.Code128, value: "DUPLICATE123" }];

    await expect(
      updateBarcodes({
        barcodes,
        kitId: "kit-1",
        organizationId: "org-1",
        userId: "user-1",
      })
    ).rejects.toThrow(
      "Some barcode values are already in use. Please use unique values."
    );
  });
});

describe("deleteBarcodes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should delete all barcodes for asset", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.deleteMany.mockResolvedValue({ count: 2 });

    await deleteBarcodes({
      assetId: "asset-1",
      organizationId: "org-1",
    });

    expect(db.barcode.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        assetId: "asset-1",
      },
    });
  });

  it("should delete all barcodes for kit", async () => {
    expect.assertions(1);
    //@ts-expect-error missing vitest type
    db.barcode.deleteMany.mockResolvedValue({ count: 1 });

    await deleteBarcodes({
      kitId: "kit-1",
      organizationId: "org-1",
    });

    expect(db.barcode.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        kitId: "kit-1",
      },
    });
  });
});

describe("replaceBarcodes", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should replace all barcodes for asset", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.deleteMany.mockResolvedValue({ count: 1 });
    //@ts-expect-error missing vitest type
    db.barcode.createMany.mockResolvedValue({ count: 2 });

    const barcodes = [
      { type: BarcodeType.Code128, value: "NEW123" },
      { type: BarcodeType.Code39, value: "NEW456" },
    ];

    await replaceBarcodes({
      barcodes,
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    // Should delete existing barcodes first
    expect(db.barcode.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        assetId: "asset-1",
      },
    });

    // Should create new barcodes
    expect(db.barcode.createMany).toHaveBeenCalledWith({
      data: [
        {
          type: BarcodeType.Code128,
          value: "NEW123",
          organizationId: "org-1",
          assetId: "asset-1",
        },
        {
          type: BarcodeType.Code39,
          value: "NEW456",
          organizationId: "org-1",
          assetId: "asset-1",
        },
      ],
    });
  });

  it("should handle empty barcodes array in replace", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.deleteMany.mockResolvedValue({ count: 1 });

    await replaceBarcodes({
      barcodes: [],
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.barcode.deleteMany).toHaveBeenCalled();
    expect(db.barcode.createMany).not.toHaveBeenCalled();
  });
});

describe("validateBarcodeUniqueness", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should pass when no duplicate barcodes exist", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const barcodes = [
      { type: BarcodeType.Code128, value: "UNIQUE123" },
      { type: BarcodeType.Code39, value: "UNIQUE456" },
    ];

    await expect(
      validateBarcodeUniqueness(barcodes, "org-1")
    ).resolves.not.toThrow();

    expect(db.barcode.findMany).toHaveBeenCalledWith({
      where: {
        value: { in: ["UNIQUE123", "UNIQUE456"] },
        organizationId: "org-1",
      },
      include: {
        asset: { select: { title: true } },
        kit: { select: { name: true } },
      },
    });
  });

  it("should throw detailed error when duplicate barcode exists", async () => {
    expect.assertions(2);
    const existingBarcode = {
      id: "existing-1",
      value: "DUPLICATE123",
      assetId: "other-asset",
      kitId: null,
      asset: { title: "Existing Asset" },
      kit: null,
    };
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([existingBarcode]);

    const barcodes = [{ type: BarcodeType.Code128, value: "DUPLICATE123" }];

    const error = await validateBarcodeUniqueness(barcodes, "org-1").catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.additionalData.validationErrors).toEqual({
      "barcodes[0].value": {
        message: 'This barcode value is already used by "Existing Asset"',
      },
    });
  });

  it("should filter out current item when editing", async () => {
    expect.assertions(2);
    const existingBarcode = {
      id: "existing-1",
      value: "MYBARCODE123",
      assetId: "current-asset",
      kitId: null,
      asset: { title: "Current Asset" },
      kit: null,
    };
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([existingBarcode]);

    const barcodes = [{ type: BarcodeType.Code128, value: "MYBARCODE123" }];

    // Should not throw because the barcode belongs to the current asset being edited
    await expect(
      validateBarcodeUniqueness(barcodes, "org-1", "current-asset", "asset")
    ).resolves.not.toThrow();

    expect(db.barcode.findMany).toHaveBeenCalled();
  });

  it("should detect duplicates within submitted barcodes", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const barcodes = [
      { type: BarcodeType.Code128, value: "DUPLICATE123" },
      { type: BarcodeType.Code39, value: "DUPLICATE123" },
    ];

    const error = await validateBarcodeUniqueness(barcodes, "org-1").catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(ShelfError);
    expect(error.additionalData.validationErrors).toEqual({
      "barcodes[0].value": {
        message: "This barcode value is duplicated in the form",
      },
      "barcodes[1].value": {
        message: "This barcode value is duplicated in the form",
      },
    });
  });

  it("should handle kit relationships correctly", async () => {
    expect.assertions(1);
    const existingBarcode = {
      id: "existing-1",
      value: "KITBARCODE123",
      assetId: null,
      kitId: "other-kit",
      asset: null,
      kit: { name: "Existing Kit" },
    };
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([existingBarcode]);

    const barcodes = [{ type: BarcodeType.Code128, value: "KITBARCODE123" }];

    const error = await validateBarcodeUniqueness(barcodes, "org-1").catch(
      (e) => e
    );

    expect(error.additionalData.validationErrors).toEqual({
      "barcodes[0].value": {
        message: 'This barcode value is already used by "Existing Kit"',
      },
    });
  });
});
