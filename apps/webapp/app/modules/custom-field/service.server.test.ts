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

const mockRecordEvents = vi.fn();

// why: activity events are their own module with their own tests; here we only
// check which events a rename hands it, and that it writes through the tx.
vi.mock("../activity-event/service.server", () => ({
  recordEvents: mockRecordEvents,
}));

const { db } = await import("~/database/db.server");
const {
  createCustomField,
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

describe("createCustomField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the format chosen for the field", async () => {
    vi.mocked(db.customField.create).mockResolvedValue({
      name: "Manual",
      type: "TEXT",
      active: false,
    } as never);
    vi.mocked(db.assetIndexSettings.findMany).mockResolvedValue([]);

    await createCustomField({
      name: "Manual",
      helpText: null,
      type: "TEXT",
      format: "LINK",
      required: false,
      active: false,
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(db.customField.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Manual",
        type: "TEXT",
        format: "LINK",
      }),
    });
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
        format: "PLAIN",
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

  /** A value row the rename statement reports as changed. */
  type Rewritten = { assetId: string; from: string; to: string };

  // why: records which client the transaction callback writes through, so the
  // tests can prove the lock, the field update, the value rewrite and the
  // events share one transaction. The first raw query is the row lock; the
  // second is the rename, which answers with `rewritten`.
  function mockTransaction({
    field = savedField as typeof savedField | null,
    rewritten = [] as Rewritten[],
  } = {}) {
    const tx = {
      customField: {
        findFirst: vi.fn().mockResolvedValue(field),
        update: vi.fn().mockImplementation(({ data }) => ({
          ...savedField,
          options: data.options,
        })),
      },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: "cf-brand" }])
        .mockResolvedValueOnce(rewritten),
    };
    dbTransactionMock.mockImplementation(((
      callback: (client: typeof tx) => unknown
    ) => callback(tx)) as never);
    return tx;
  }

  /** The rename statement the transaction ran, or undefined when it ran none. */
  const renameStatement = (tx: ReturnType<typeof mockTransaction>) =>
    tx.$queryRaw.mock.calls[1]?.[0] as
      | { text: string; values: unknown[] }
      | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("locks the field row before reading the saved options", async () => {
    const tx = mockTransaction();

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      userId: "user-1",
      options: ["Sony ", "Canon", "sony"],
    });

    const lock = tx.$queryRaw.mock.calls[0][0];
    expect(lock.text).toContain('FROM "CustomField"');
    expect(lock.text).toContain("FOR UPDATE");
    expect(lock.values).toEqual(["cf-brand", "org-1"]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.customField.findFirst.mock.invocationCallOrder[0]
    );
  });

  it("rewrites renamed and merged values in the transaction that saves the options", async () => {
    const tx = mockTransaction();

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      userId: "user-1",
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);

    const statement = renameStatement(tx)!;
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
    expect(statement.text).toContain('RETURNING v."assetId"');

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
      userId: "user-1",
      options: ["Canon", "Sony ", "sony"],
      optionRenames: [{ from: "Canon", to: "Canon" }],
    });

    expect(tx.customField.update).toHaveBeenCalledWith({
      where: { id: "cf-brand", organizationId: "org-1" },
      data: expect.objectContaining({ options: ["Canon", "Sony ", "sony"] }),
    });
    expect(renameStatement(tx)).toBeUndefined();
    expect(mockRecordEvents).not.toHaveBeenCalled();
  });

  it("swaps two spellings in one statement, matching each row on its value before the update", async () => {
    const tx = mockTransaction();

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      userId: "user-1",
      options: ["Canon", "Sony ", "sony"],
      optionRenames: [
        { from: "Sony ", to: "sony" },
        { from: "sony", to: "Sony " },
      ],
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const statement = renameStatement(tx)!;
    expect(statement.values).toEqual([
      "Sony ",
      "sony",
      "sony",
      "Sony ",
      "cf-brand",
    ]);
    // One UPDATE joined to every pair at once: a chain of per-pair UPDATEs
    // would move the swapped assets twice and leave both sets on one spelling.
    expect(statement.text.match(/UPDATE/g)).toHaveLength(1);
    expect(statement.text).toContain(
      'FROM (VALUES ($1::text, $2::text),($3::text, $4::text)) AS m("from", "to")'
    );
    expect(statement.text).toContain(`v."value"->>'valueOption' = m."from"`);
  });

  it("records one custom-field-changed event per rewritten asset, in the transaction", async () => {
    const tx = mockTransaction({
      rewritten: [
        { assetId: "asset-1", from: "Sony ", to: "Sony" },
        { assetId: "asset-2", from: "sony", to: "Sony" },
      ],
    });

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      userId: "user-1",
      options: ["Sony", "Canon"],
      optionRenames: [
        { from: "Sony ", to: "Sony" },
        { from: "sony", to: "Sony" },
      ],
    });

    expect(mockRecordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "ASSET_CUSTOM_FIELD_CHANGED",
          entityType: "ASSET",
          entityId: "asset-1",
          assetId: "asset-1",
          field: "Brand",
          fromValue: "Sony ",
          toValue: "Sony",
        }),
        expect.objectContaining({
          entityId: "asset-2",
          fromValue: "sony",
          toValue: "Sony",
        }),
      ],
      tx
    );
  });

  it("switches a text field to the Link format", async () => {
    const tx = mockTransaction({
      field: { ...savedField, type: "TEXT", options: [] },
    });

    await updateCustomField({
      id: "cf-brand",
      organizationId: "org-1",
      userId: "user-1",
      format: "LINK",
    });

    expect(tx.customField.update).toHaveBeenCalledWith({
      where: { id: "cf-brand", organizationId: "org-1" },
      data: expect.objectContaining({ format: "LINK" }),
    });
  });

  it("refuses the Link format on a field that is not text, whatever type was posted", async () => {
    const tx = mockTransaction();

    await expect(
      updateCustomField({
        id: "cf-brand",
        organizationId: "org-1",
        userId: "user-1",
        type: "TEXT",
        format: "LINK",
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "Only single-line text fields can be Link fields",
    });
    expect(tx.customField.update).not.toHaveBeenCalled();
  });

  it("answers 404 when the field is not in the organization", async () => {
    const tx = mockTransaction({ field: null });

    await expect(
      updateCustomField({
        id: "cf-brand",
        organizationId: "org-1",
        userId: "user-1",
        options: ["Sony"],
      })
    ).rejects.toMatchObject({ status: 404, shouldBeCaptured: false });
    expect(tx.customField.update).not.toHaveBeenCalled();
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
      case: "moving assets off an option that stays selectable",
      options: ["Sony ", "Canon", "sony", "Sony"],
      optionRenames: [{ from: "Sony ", to: "Sony" }],
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
        userId: "user-1",
        options,
        optionRenames,
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        "The options of this field changed since you opened it. Reload the page and try again.",
    });
    expect(tx.customField.update).not.toHaveBeenCalled();
    expect(renameStatement(tx)).toBeUndefined();
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
