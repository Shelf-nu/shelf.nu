import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: testing custom field service logic without executing actual database operations
vi.mock("~/database/db.server", () => ({ db: {} }));
vi.mock("~/database/query-helpers.server", () => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

const mockRemoveCustomFieldFromAssetIndexSettings = vi.fn();

vi.mock("../asset-index-settings/service.server", () => ({
  removeCustomFieldFromAssetIndexSettings:
    mockRemoveCustomFieldFromAssetIndexSettings,
  updateAssetIndexSettingsAfterCfUpdate: vi.fn(),
  updateAssetIndexSettingsWithNewCustomFields: vi.fn(),
}));

const { findFirst, update } = await import("~/database/query-helpers.server");
const { softDeleteCustomField } = await import("./service.server");

const mockFindFirst = vi.mocked(findFirst);
const mockUpdate = vi.mocked(update);

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

    mockFindFirst.mockResolvedValue(mockCustomField as any);
    mockUpdate.mockImplementation(
      (_db, _table, opts: any) =>
        Promise.resolve({
          ...mockCustomField,
          name: opts.data.name,
          deletedAt: opts.data.deletedAt,
        }) as any
    );

    const result = await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    expect(result.deletedAt).toBeTruthy();
    expect(result.name).toMatch(/^Serial Number_\d+$/);
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Verify AssetIndexSettings cleanup was called
    expect(mockRemoveCustomFieldFromAssetIndexSettings).toHaveBeenCalledWith({
      customFieldName: "Serial Number",
      organizationId: "org-123",
    });
  });

  it("throws ShelfError when custom field does not exist or is already deleted", async () => {
    mockFindFirst.mockResolvedValue(null as any);

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
    // findFirst with organizationId filter will return null
    mockFindFirst.mockResolvedValue(null as any);

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

    mockFindFirst.mockImplementation(() => {
      executionOrder.push("findFirst");
      return Promise.resolve(mockCustomField) as any;
    });
    mockUpdate.mockImplementation((_db, _table, opts: any) => {
      executionOrder.push("update");
      return Promise.resolve({
        ...mockCustomField,
        name: opts.data.name,
        deletedAt: opts.data.deletedAt,
      }) as any;
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
    mockFindFirst.mockRejectedValueOnce(
      new Error("Database connection failed")
    );

    await expect(
      softDeleteCustomField({
        id: "cf-123",
        organizationId: "org-123",
      })
    ).rejects.toBeInstanceOf(ShelfError);
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

    mockFindFirst.mockResolvedValue(mockCustomField as any);
    mockUpdate.mockImplementation((_db, _table, opts: any) => {
      capturedUpdateData = opts.data;
      return Promise.resolve({
        ...mockCustomField,
        name: opts.data.name,
        deletedAt: opts.data.deletedAt,
      }) as any;
    });

    await softDeleteCustomField({
      id: "cf-123",
      organizationId: "org-123",
    });

    // Verify that the name has a timestamp appended
    expect(capturedUpdateData.name).toMatch(/^Serial Number_\d+$/);
    expect(capturedUpdateData.deletedAt).toBeTruthy();
  });
});
