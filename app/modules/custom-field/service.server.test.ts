import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// Mock the database and dependencies
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(),
    customField: {
      findFirst: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    assetCustomFieldValue: {
      deleteMany: vi.fn(),
    },
    assetIndexSettings: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const mockRemoveCustomFieldFromAssetIndexSettings = vi.fn();

vi.mock("../asset-index-settings/service.server", () => ({
  removeCustomFieldFromAssetIndexSettings:
    mockRemoveCustomFieldFromAssetIndexSettings,
  updateAssetIndexSettingsAfterCfUpdate: vi.fn(),
  updateAssetIndexSettingsWithNewCustomFields: vi.fn(),
}));

const { db } = await import("~/database/db.server");
const { softDeleteCustomField } = await import("./service.server");

const dbTransactionMock = vi.mocked(db.$transaction);

describe("softDeleteCustomField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully soft deletes a custom field by setting deletedAt", async () => {
    const mockCustomField = {
      id: "cf-123",
      name: "Serial Number",
      organizationId: "org-123",
      type: "TEXT",
      active: true,
      required: false,
      userId: "user-123",
      options: [],
      helpText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    let capturedUpdateData: any = null;

    // Mock the transaction to execute the callback
    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          findFirst: vi.fn().mockResolvedValue(mockCustomField),
          update: vi.fn().mockImplementation(({ data }) => {
            capturedUpdateData = data;
            return {
              ...mockCustomField,
              name: data.name,
              deletedAt: data.deletedAt,
            };
          }),
        },
      };
      return callback(mockTx);
    });

    const result = await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    expect(result.deletedAt).toBeTruthy();
    expect(result.name).toMatch(/^Serial Number_\d+$/);
    expect(capturedUpdateData.name).toMatch(/^Serial Number_\d+$/);
    expect(capturedUpdateData.deletedAt).toBeInstanceOf(Date);
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);

    // Verify AssetIndexSettings cleanup was called
    expect(mockRemoveCustomFieldFromAssetIndexSettings).toHaveBeenCalledWith({
      customFieldName: "Serial Number",
      organizationId: "org-123",
      prisma: expect.any(Object),
    });
  });

  it("throws ShelfError when custom field does not exist or is already deleted", async () => {
    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };
      return callback(mockTx);
    });

    await expect(
      softDeleteCustomField({
        id: "non-existent",
        organizationId: "org-123",
      })
    ).rejects.toMatchObject({
      message: "The custom field you are trying to delete does not exist.",
      status: 404,
    });
  });

  it("throws ShelfError when custom field belongs to different organization", async () => {
    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          // findFirst with organizationId filter will return null
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };
      return callback(mockTx);
    });

    await expect(
      softDeleteCustomField({
        id: "cf-123",
        organizationId: "org-123", // Requesting org
      })
    ).rejects.toMatchObject({
      message: "The custom field you are trying to delete does not exist.",
      status: 404,
    });
  });

  it("preserves AssetCustomFieldValue records (no CASCADE deletion)", async () => {
    const mockCustomField = {
      id: "cf-123",
      name: "Serial Number",
      organizationId: "org-123",
      type: "TEXT",
      active: true,
      required: false,
      userId: "user-123",
      options: [],
      helpText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    const executionOrder: string[] = [];

    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          findFirst: vi.fn().mockImplementation(() => {
            executionOrder.push("findFirst");
            return mockCustomField;
          }),
          update: vi.fn().mockImplementation(({ data }) => {
            executionOrder.push("update");
            return {
              ...mockCustomField,
              name: data.name,
              deletedAt: data.deletedAt,
            };
          }),
        },
      };
      return callback(mockTx);
    });

    const result = await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    // Verify correct order: find -> update (no CASCADE, no removeFromIndexSettings)
    expect(executionOrder).toEqual(["findFirst", "update"]);
    // Verify timestamp was appended to name
    expect(result.name).toMatch(/^Serial Number_\d+$/);
  });

  it("wraps database errors in ShelfError", async () => {
    dbTransactionMock.mockRejectedValueOnce(
      new Error("Database connection failed")
    );

    await expect(
      softDeleteCustomField({
        id: "cf-123",
        organizationId: "org-123",
      })
    ).rejects.toBeInstanceOf(ShelfError);
  });

  it("passes transaction timeout configuration", async () => {
    const mockCustomField = {
      id: "cf-123",
      name: "Serial Number",
      organizationId: "org-123",
      type: "TEXT",
      active: true,
      required: false,
      userId: "user-123",
      options: [],
      helpText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          findFirst: vi.fn().mockResolvedValue(mockCustomField),
          update: vi.fn().mockImplementation(({ data }) => ({
            ...mockCustomField,
            name: data.name,
            deletedAt: data.deletedAt,
          })),
        },
      };
      return callback(mockTx);
    });

    const result = await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    // Verify transaction was called with timeout option
    expect(dbTransactionMock).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30000,
    });
    // Verify timestamp was appended to name
    expect(result.name).toMatch(/^Serial Number_\d+$/);
  });

  it("appends Unix timestamp to field name when soft deleting", async () => {
    const mockCustomField = {
      id: "cf-123",
      name: "Serial Number",
      organizationId: "org-123",
      type: "TEXT",
      active: true,
      required: false,
      userId: "user-123",
      options: [],
      helpText: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    let capturedUpdateData: any = null;

    dbTransactionMock.mockImplementation((callback: any) => {
      const mockTx = {
        customField: {
          findFirst: vi.fn().mockResolvedValue(mockCustomField),
          update: vi.fn().mockImplementation(({ data }) => {
            capturedUpdateData = data;
            return {
              ...mockCustomField,
              name: data.name,
              deletedAt: data.deletedAt,
            };
          }),
        },
      };
      return callback(mockTx);
    });

    await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    // Verify that the name has a timestamp appended
    expect(capturedUpdateData.name).toMatch(/^Serial Number_\d+$/);
    expect(capturedUpdateData.deletedAt).toBeInstanceOf(Date);
  });
});
