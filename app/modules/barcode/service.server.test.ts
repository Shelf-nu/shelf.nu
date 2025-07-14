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
  parseBarcodesFromImportData,
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

  it("should validate DataMatrix barcode length range", async () => {
    expect.assertions(3);

    // Test minimum length (4 characters)
    //@ts-expect-error missing vitest type
    db.barcode.create.mockResolvedValue(mockBarcodeData);

    await expect(
      createBarcode({
        ...mockCreateParams,
        type: BarcodeType.DataMatrix,
        value: "ABCD", // Minimum valid length
      })
    ).resolves.not.toThrow();

    // Test too short DataMatrix barcode
    await expect(
      createBarcode({
        ...mockCreateParams,
        type: BarcodeType.DataMatrix,
        value: "AB", // Too short for DataMatrix
      })
    ).rejects.toThrow(ShelfError);

    // Test too long DataMatrix barcode
    await expect(
      createBarcode({
        ...mockCreateParams,
        type: BarcodeType.DataMatrix,
        value: "A".repeat(101), // Too long for DataMatrix (max 100)
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

describe("parseBarcodesFromImportData", () => {
  const mockImportData = [
    {
      key: "asset-1",
      title: "Test Asset 1",
      description: "Description 1",
      barcode_Code128: "ABCD1234",
      barcode_Code39: "ABC123",
      barcode_DataMatrix: "WXYZ5678",
    },
    {
      key: "asset-2",
      title: "Test Asset 2",
      description: "Description 2",
      barcode_Code128: "EFGH5678,IJKL9012",
      barcode_Code39: "DEF456",
      barcode_DataMatrix: "",
    },
    {
      key: "asset-3",
      title: "Test Asset 3",
      description: "Description 3",
      // No barcode data
    },
  ];

  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("should parse barcodes from import data successfully", async () => {
    expect.assertions(3);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const result = await parseBarcodesFromImportData({
      data: mockImportData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(2); // Only assets with barcodes
    expect(result[0]).toEqual({
      key: "asset-1",
      title: "Test Asset 1",
      barcodes: [
        { type: BarcodeType.Code128, value: "ABCD1234" },
        { type: BarcodeType.Code39, value: "ABC123" },
        { type: BarcodeType.DataMatrix, value: "WXYZ5678" },
      ],
    });
    expect(result[1]).toEqual({
      key: "asset-2",
      title: "Test Asset 2",
      barcodes: [
        { type: BarcodeType.Code128, value: "EFGH5678" },
        { type: BarcodeType.Code128, value: "IJKL9012" },
        { type: BarcodeType.Code39, value: "DEF456" },
      ],
    });
  });

  it("should handle empty import data", async () => {
    expect.assertions(1);

    const result = await parseBarcodesFromImportData({
      data: [],
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toEqual([]);
  });

  it("should handle assets with no barcode data", async () => {
    expect.assertions(1);
    const dataWithNoBarcodes = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        description: "Description 1",
      },
    ];

    const result = await parseBarcodesFromImportData({
      data: dataWithNoBarcodes,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toEqual([]);
  });

  it("should throw error for invalid barcode format", async () => {
    expect.assertions(1);
    const invalidData = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "AB", // Too short
      },
    ];

    await expect(
      parseBarcodesFromImportData({
        data: invalidData,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow('Invalid Code128 barcode "AB" for asset "Test Asset 1"');
  });

  it("should throw error for duplicate barcodes within import data", async () => {
    expect.assertions(1);
    const duplicateData = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "DUPLICATE123",
      },
      {
        key: "asset-2",
        title: "Test Asset 2",
        barcode_Code128: "DUPLICATE123",
      },
    ];

    await expect(
      parseBarcodesFromImportData({
        data: duplicateData,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow("Some barcodes appear multiple times in the import data");
  });

  it("should throw error for barcodes already linked to assets", async () => {
    expect.assertions(1);
    const existingLinkedBarcode = {
      id: "existing-1",
      value: "LINKED123",
      assetId: "other-asset",
      kitId: null,
      asset: { title: "Existing Asset" },
      kit: null,
    };
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([existingLinkedBarcode]);

    const dataWithLinkedBarcode = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "LINKED123",
      },
    ];

    await expect(
      parseBarcodesFromImportData({
        data: dataWithLinkedBarcode,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      "Some barcodes are already linked to other assets or kits in your organization"
    );
  });

  it("should throw error for barcodes already linked to kits", async () => {
    expect.assertions(1);
    const existingLinkedBarcode = {
      id: "existing-1",
      value: "LINKED123",
      assetId: null,
      kitId: "other-kit",
      asset: null,
      kit: { name: "Existing Kit" },
    };
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([existingLinkedBarcode]);

    const dataWithLinkedBarcode = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "LINKED123",
      },
    ];

    await expect(
      parseBarcodesFromImportData({
        data: dataWithLinkedBarcode,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      "Some barcodes are already linked to other assets or kits in your organization"
    );
  });

  it("should handle comma-separated barcode values", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const dataWithMultipleBarcodes = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "ABC123, DEF456 , GHI789", // With spaces
      },
    ];

    const result = await parseBarcodesFromImportData({
      data: dataWithMultipleBarcodes,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].barcodes).toEqual([
      { type: BarcodeType.Code128, value: "ABC123" },
      { type: BarcodeType.Code128, value: "DEF456" },
      { type: BarcodeType.Code128, value: "GHI789" },
    ]);
  });

  it("should normalize barcode values to uppercase", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const dataWithLowercaseBarcodes = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "abc123",
        barcode_Code39: "def456",
      },
    ];

    const result = await parseBarcodesFromImportData({
      data: dataWithLowercaseBarcodes,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].barcodes).toEqual([
      { type: BarcodeType.Code128, value: "ABC123" },
      { type: BarcodeType.Code39, value: "DEF456" },
    ]);
  });

  it("should filter out empty barcode values", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const dataWithEmptyValues = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "ABC123,,  ,DEF456", // Empty values and spaces
        barcode_Code39: "", // Empty string
        barcode_DataMatrix: "   ", // Only spaces
      },
    ];

    const result = await parseBarcodesFromImportData({
      data: dataWithEmptyValues,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].barcodes).toEqual([
      { type: BarcodeType.Code128, value: "ABC123" },
      { type: BarcodeType.Code128, value: "DEF456" },
    ]);
  });

  it("should handle mix of valid and invalid characters gracefully", async () => {
    expect.assertions(1);
    const dataWithInvalidChars = [
      {
        key: "asset-1",
        title: "Test Asset 1",
        barcode_Code128: "ABC\x00123", // Invalid character (null byte)
      },
    ];

    await expect(
      parseBarcodesFromImportData({
        data: dataWithInvalidChars,
        userId: "user-1",
        organizationId: "org-1",
      })
    ).rejects.toThrow(
      'Invalid Code128 barcode "ABC\x00123" for asset "Test Asset 1"'
    );
  });

  it("should only check barcodes within the same organization", async () => {
    expect.assertions(3);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const result = await parseBarcodesFromImportData({
      data: mockImportData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(2);
    expect(db.barcode.findMany).toHaveBeenCalledWith({
      where: {
        value: {
          in: [
            "ABCD1234",
            "ABC123",
            "WXYZ5678",
            "EFGH5678",
            "IJKL9012",
            "DEF456",
          ],
        },
        organizationId: "org-1", // Only check within this organization
      },
      include: {
        asset: { select: { title: true } },
        kit: { select: { name: true } },
      },
    });
    expect(db.barcode.findMany).toHaveBeenCalledTimes(1);
  });

  it("should handle different barcode type combinations", async () => {
    expect.assertions(2);
    //@ts-expect-error missing vitest type
    db.barcode.findMany.mockResolvedValue([]);

    const mixedData = [
      {
        key: "asset-1",
        title: "Only Code128",
        barcode_Code128: "ABC123",
      },
      {
        key: "asset-2",
        title: "Only Code39",
        barcode_Code39: "DEF456",
      },
      {
        key: "asset-3",
        title: "Only DataMatrix",
        barcode_DataMatrix: "GHIJ7890",
      },
    ];

    const result = await parseBarcodesFromImportData({
      data: mixedData,
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.barcodes)).toEqual([
      [{ type: BarcodeType.Code128, value: "ABC123" }],
      [{ type: BarcodeType.Code39, value: "DEF456" }],
      [{ type: BarcodeType.DataMatrix, value: "GHIJ7890" }],
    ]);
  });
});
