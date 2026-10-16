import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: these are unit tests of the service's control flow; the rename SQL and
// counts need a real Postgres, so the client is replaced with spies.
vi.mock("~/database/db.server", () => ({
  db: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
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
const mockUpdateAssetIndexSettingsAfterCfUpdate = vi.fn();

// why: index-settings updates are their own module with their own tests; here
// we only check that a field update hands them the old and new field.
vi.mock("../asset-index-settings/service.server", () => ({
  removeCustomFieldFromAssetIndexSettings:
    mockRemoveCustomFieldFromAssetIndexSettings,
  updateAssetIndexSettingsAfterCfUpdate:
    mockUpdateAssetIndexSettingsAfterCfUpdate,
  updateAssetIndexSettingsWithNewCustomFields: vi.fn(),
}));

const { db } = await import("~/database/db.server");
const {
  getOptionUsageCounts,
  softDeleteCustomField,
  updateCustomField,
  upsertCustomField,
} = await import("./service.server");

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

describe("upsertCustomField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks a definition up by exact name regardless of case", async () => {
    const existing = {
      id: "cf-serial",
      name: "SERIAL_NO",
      type: "TEXT",
      options: [],
    };
    vi.mocked(db.customField.findFirst).mockResolvedValue(existing as never);

    const { customFields } = await upsertCustomField([
      {
        name: "Serial_No",
        type: "TEXT",
        helpText: null,
        required: false,
        active: true,
        organizationId: "org-1",
        userId: "user-1",
      },
    ]);

    // `in` keeps `_` a plain character; `equals` + insensitive is an ILIKE,
    // where it matches any one character.
    expect(db.customField.findFirst).toHaveBeenCalledWith({
      where: {
        name: { in: ["Serial_No"], mode: "insensitive" },
        organizationId: "org-1",
        deletedAt: null,
      },
    });
    expect(customFields.Serial_No.id).toBe("cf-serial");
  });
});

describe("updateCustomField", () => {
  const savedField = {
    id: "cf-brand",
    name: "Brand",
    organizationId: "org-1",
    type: "OPTION",
    options: ["Sony ", "Canon", "sony"],
  };

  // why: records which client the transaction callback writes through, so the
  // tests can prove the field update and the value rewrite share one transaction.
  function mockTransaction() {
    const tx = {
      customField: {
        findFirstOrThrow: vi.fn().mockResolvedValue(savedField),
        update: vi.fn().mockImplementation(({ data }) => ({
          ...savedField,
          options: data.options,
        })),
      },
      $executeRaw: vi.fn().mockResolvedValue(3),
    };
    dbTransactionMock.mockImplementation(((
      callback: (client: typeof tx) => unknown
    ) => callback(tx)) as never);
    return tx;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rewrites renamed and merged values in the transaction that saves the options", async () => {
    const tx = mockTransaction();

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      options: ["Sony", "Canon"],
      optionRenames: [
        { from: "Sony ", to: "Sony" },
        { from: "sony", to: "Sony" },
      ],
    });

    expect(tx.customField.update).toHaveBeenCalledWith({
      where: { id: "cf-brand", organizationId: "org-1" },
      data: expect.objectContaining({ options: ["Sony", "Canon"] }),
    });
    expect(db.customField.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

    const statement = tx.$executeRaw.mock.calls[0][0];
    expect(statement.values).toEqual([
      "Sony ",
      "Sony",
      "sony",
      "Sony",
      "cf-brand",
    ]);
    expect(statement.text).toContain('UPDATE "AssetCustomFieldValue" AS v');
    expect(statement.text).toContain(`'{valueOption}'`);
    expect(statement.text).toContain(`'{raw}'`);
    expect(statement.text).toContain(`v."customFieldId" = $5`);

    expect(mockUpdateAssetIndexSettingsAfterCfUpdate).toHaveBeenCalledWith({
      oldField: savedField,
      newField: { ...savedField, options: ["Sony", "Canon"] },
    });
  });

  it("saves without rewriting values when no spelling changes", async () => {
    const tx = mockTransaction();

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      options: ["Canon", "Sony ", "sony"],
      optionRenames: [{ from: "Canon", to: "Canon" }],
    });

    expect(tx.customField.update).toHaveBeenCalledWith({
      where: { id: "cf-brand", organizationId: "org-1" },
      data: expect.objectContaining({ options: ["Canon", "Sony ", "sony"] }),
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    {
      case: "a from that is not a saved option",
      options: ["Sony", "Canon", "sony"],
      optionRenames: [{ from: "Sony", to: "Canon" }],
    },
    {
      case: "a to that is not one of the new options",
      options: ["Sony", "Canon"],
      optionRenames: [{ from: "Sony ", to: "Sony Pictures" }],
    },
    {
      case: "two renames from the same spelling",
      options: ["Sony", "Canon", "SONY"],
      optionRenames: [
        { from: "sony", to: "Sony" },
        { from: "sony", to: "SONY" },
      ],
    },
  ])("refuses $case without writing", async ({ options, optionRenames }) => {
    const tx = mockTransaction();

    await expect(
      updateCustomField({
        id: "cf-brand",
        organizationId: "org-1",
        options,
        optionRenames,
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        "The options of this field changed since you opened it. Reload the page and try again.",
    });
    expect(tx.customField.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("getOptionUsageCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts stored values of one field in one organization", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { option: "Sony", count: 4 },
      { option: "sony", count: 1 },
    ] as never);

    const counts = await getOptionUsageCounts({
      customFieldId: "cf-brand",
      organizationId: "org-1",
    });

    expect(counts).toEqual({ Sony: 4, sony: 1 });
    const query = vi.mocked(db.$queryRaw).mock
      .calls[0][0] as unknown as Prisma.Sql;
    expect(query.values).toEqual(["cf-brand", "org-1"]);
    expect(query.text).toContain(`cf."organizationId" = $2`);
    expect(query.text).toContain(`v."value"->>'valueOption'`);
    expect(query.text).toContain(`COUNT(DISTINCT v."assetId")`);
  });
});
