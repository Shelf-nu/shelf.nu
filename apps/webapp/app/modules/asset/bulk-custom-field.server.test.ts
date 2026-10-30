import type { AssetIndexSettings } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import { lockAssetsForArchiveGuard } from "./archive-lock.server";
import {
  bulkCustomFieldMessage,
  bulkSetAssetCustomField,
} from "./bulk-custom-field.server";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";

// why: the service reads and writes through Prisma; the assertions are on the
// rows it decides to write, so the client is a stub that runs the transaction
// callback against itself.
vitest.mock("~/database/db.server", () => {
  const client = {
    customField: { findFirst: vitest.fn() },
    asset: { findMany: vitest.fn(), updateMany: vitest.fn() },
    note: { createMany: vitest.fn() },
    user: {
      findFirst: vitest.fn().mockResolvedValue({
        firstName: "Sam",
        lastName: "Lee",
        displayName: null,
      }),
    },
    assetCustomFieldValue: {
      createMany: vitest.fn(),
      updateMany: vitest.fn(),
    },
    $transaction: vitest.fn(),
  };
  client.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(client)
  );
  return { db: client };
});

// why: select-all resolution has its own suite; here the selection is the ids.
vitest.mock("./bulk-operations-helper.server", () => ({
  resolveAssetIdsForBulkOperation: vitest.fn(
    ({ assetIds }: { assetIds: string[] }) => Promise.resolve(assetIds)
  ),
}));

// why: the archive lock is a raw SQL row lock with its own suite.
vitest.mock("./archive-lock.server", () => ({
  lockAssetsForArchiveGuard: vitest.fn(),
}));

// why: the archive guard has its own suite and reads tables this stub lacks.
vitest.mock("~/utils/org-validation.server", () => ({
  assertAssetsAreNotArchived: vitest.fn(),
  assertAssetsBelongToOrg: vitest.fn(),
}));

// why: event persistence is covered by its own suite; the assertions here are
// on what this action asks it to write.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

const field = {
  id: "cf-brand",
  name: "Brand",
  type: "OPTION",
  format: "PLAIN",
  options: ["Westermo", "Siemens"],
  helpText: null,
  categories: [] as { id: string }[],
};

/** An asset row as the service reads it. */
function asset(
  id: string,
  {
    categoryId = null,
    brand,
  }: { categoryId?: string | null; brand?: string } = {}
) {
  return {
    id,
    categoryId,
    customFields: brand
      ? [
          {
            id: `v-${id}`,
            customFieldId: "cf-brand",
            value: { raw: brand, valueOption: brand },
          },
        ]
      : [],
  };
}

const args = {
  userId: "user-1",
  organizationId: "org-1",
  customFieldId: "cf-brand",
  rawValue: "Westermo",
  // The index settings are only passed through to select-all resolution.
  settings: { mode: "SIMPLE" } as unknown as AssetIndexSettings,
  lastAuditDateAccess: "available" as const,
  bookableScope: null,
};

describe("bulkSetAssetCustomField", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    vitest.mocked(db.customField.findFirst).mockResolvedValue(field as never);
  });

  it("only fills empty fields by default, and leaves values alone", async () => {
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1"),
        asset("a2", { brand: "Siemens" }),
      ] as never);

    const result = await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2"],
      mode: "EMPTY_ONLY",
    });

    expect(result).toEqual({
      resolved: 2,
      changed: 1,
      skippedWithValue: 1,
      skippedCategory: 0,
    });
    expect(db.assetCustomFieldValue.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "a1",
          customFieldId: "cf-brand",
          value: { raw: "Westermo", valueOption: "Westermo" },
        },
      ],
    });
    expect(db.assetCustomFieldValue.updateMany).not.toHaveBeenCalled();
  });

  it("replaces a different value and skips an identical one", async () => {
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1", { brand: "Siemens" }),
        asset("a2", { brand: "Westermo" }),
      ] as never);

    const result = await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2"],
      mode: "REPLACE",
    });

    expect(result.changed).toBe(1);
    expect(db.assetCustomFieldValue.updateMany).toHaveBeenCalledWith({
      where: { assetId: { in: ["a1"] }, customFieldId: "cf-brand" },
      data: { value: { raw: "Westermo", valueOption: "Westermo" } },
    });
  });

  it("skips assets whose category the field does not apply to", async () => {
    vitest.mocked(db.customField.findFirst).mockResolvedValue({
      ...field,
      categories: [{ id: "cat-network" }],
    } as never);
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1", { categoryId: "cat-network" }),
        asset("a2", { categoryId: "cat-power" }),
        asset("a3"),
      ] as never);

    const result = await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2", "a3"],
      mode: "EMPTY_ONLY",
    });

    // a3 has no category, so a category-limited field does not apply to it.
    expect(result).toMatchObject({ changed: 1, skippedCategory: 2 });
  });

  it("writes the single edit's event and note, in the transaction", async () => {
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1"),
        asset("a2", { brand: "Siemens" }),
      ] as never);

    await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2"],
      mode: "REPLACE",
    });

    const [events, eventTx] = vitest.mocked(recordEvents).mock.calls[0];
    expect(eventTx).toBe(db);
    expect(events).toEqual([
      expect.objectContaining({
        action: "ASSET_CUSTOM_FIELD_CHANGED",
        assetId: "a1",
        field: "Brand",
        fromValue: null,
        toValue: "Westermo",
        meta: { isFirstTimeSet: true, viaBulk: true },
      }),
      expect.objectContaining({
        assetId: "a2",
        fromValue: "Siemens",
        toValue: "Westermo",
        meta: { isFirstTimeSet: false, viaBulk: true },
      }),
    ]);

    expect(db.note.createMany).toHaveBeenCalledTimes(1);
    const [{ data: notes }] = vitest.mocked(db.note.createMany).mock
      .calls[0] as unknown as [
      { data: { assetId: string; content: string }[] },
    ];
    expect(notes).toEqual([
      expect.objectContaining({
        assetId: "a1",
        type: "UPDATE",
        content: expect.stringContaining("set **Brand** to **Westermo**"),
      }),
      expect.objectContaining({
        assetId: "a2",
        type: "UPDATE",
        content: expect.stringContaining(
          "updated **Brand** from **Siemens** to **Westermo**"
        ),
      }),
    ]);
  });

  it("writes every note in one statement, however many previous values", async () => {
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1", { brand: "Siemens" }),
        asset("a2", { brand: "Moxa" }),
        asset("a3", { brand: "Cisco" }),
      ] as never);

    await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2", "a3"],
      mode: "REPLACE",
    });

    expect(db.note.createMany).toHaveBeenCalledTimes(1);
  });

  it("moves the Updated time of the changed assets only", async () => {
    vitest
      .mocked(db.asset.findMany)
      .mockResolvedValue([
        asset("a1"),
        asset("a2", { brand: "Westermo" }),
      ] as never);

    await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2"],
      mode: "REPLACE",
    });

    expect(db.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, organizationId: "org-1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("passes the caller's list scope to select-all resolution", async () => {
    vitest.mocked(db.asset.findMany).mockResolvedValue([asset("a1")] as never);
    const bookableScope = { holderUserId: "user-1" };

    await bulkSetAssetCustomField({
      ...args,
      bookableScope,
      assetIds: ["a1"],
      mode: "EMPTY_ONLY",
    });

    expect(resolveAssetIdsForBulkOperation).toHaveBeenCalledWith(
      expect.objectContaining({ bookableScope, organizationId: "org-1" })
    );
  });

  it("does nothing when the selection resolves to no assets", async () => {
    vitest.mocked(resolveAssetIdsForBulkOperation).mockResolvedValueOnce([]);

    const result = await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1"],
      mode: "REPLACE",
    });

    expect(result).toEqual({
      resolved: 0,
      changed: 0,
      skippedWithValue: 0,
      skippedCategory: 0,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("reads the assets inside the transaction, under the archive lock", async () => {
    vitest.mocked(db.asset.findMany).mockResolvedValue([asset("a1")] as never);

    await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1"],
      mode: "EMPTY_ONLY",
    });

    const lock = vitest.mocked(lockAssetsForArchiveGuard).mock
      .invocationCallOrder[0];
    const read = vitest.mocked(db.asset.findMany).mock.invocationCallOrder[0];
    expect(db.$transaction).toHaveBeenCalled();
    expect(lock).toBeLessThan(read);
  });

  it("refuses a value that is not one of the field's options", async () => {
    await expect(
      bulkSetAssetCustomField({
        ...args,
        rawValue: "Not an option",
        assetIds: ["a1"],
        mode: "EMPTY_ONLY",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(db.asset.findMany).not.toHaveBeenCalled();
  });

  describe("values in the spelling the dialog posts", () => {
    /** Runs the action for one empty asset with a field of `type`. */
    async function setOn(type: string, rawValue: string) {
      vitest
        .mocked(db.customField.findFirst)
        .mockResolvedValue({ ...field, type, options: [] } as never);
      vitest
        .mocked(db.asset.findMany)
        .mockResolvedValue([asset("a1")] as never);
      await bulkSetAssetCustomField({
        ...args,
        rawValue,
        assetIds: ["a1"],
        mode: "EMPTY_ONLY",
      });
      return vitest.mocked(db.assetCustomFieldValue.createMany).mock
        .calls[0][0] as unknown as { data: { value: unknown }[] };
    }

    it("stores a yes/no `on` as Yes and `off` as No", async () => {
      expect((await setOn("BOOLEAN", "on")).data[0].value).toMatchObject({
        valueBoolean: true,
      });
      vitest.mocked(db.assetCustomFieldValue.createMany).mockClear();
      expect((await setOn("BOOLEAN", "off")).data[0].value).toMatchObject({
        valueBoolean: false,
      });
    });

    it("refuses a yes/no field with no answer instead of storing No", async () => {
      await expect(setOn("BOOLEAN", "")).rejects.toMatchObject({
        status: 400,
      });
      expect(db.assetCustomFieldValue.createMany).not.toHaveBeenCalled();
    });

    it("stores a YYYY-MM-DD date", async () => {
      const { data } = await setOn("DATE", "2026-03-14");
      expect(data[0].value).toMatchObject({ raw: "2026-03-14" });
      expect((data[0].value as { valueDate: string }).valueDate).toBeTruthy();
    });

    it("refuses a blank text value", async () => {
      await expect(setOn("TEXT", "")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("a Link field", () => {
    /** Runs the action for one empty asset with a Link-format text field. */
    async function setOnLink(rawValue: string) {
      vitest.mocked(db.customField.findFirst).mockResolvedValue({
        ...field,
        type: "TEXT",
        format: "LINK",
        options: [],
      } as never);
      vitest
        .mocked(db.asset.findMany)
        .mockResolvedValue([asset("a1")] as never);
      await bulkSetAssetCustomField({
        ...args,
        rawValue,
        assetIds: ["a1"],
        mode: "EMPTY_ONLY",
      });
      return vitest.mocked(db.assetCustomFieldValue.createMany).mock
        .calls[0][0] as unknown as { data: { value: unknown }[] };
    }

    it("reads the field's format, which decides the Link rule", async () => {
      await setOnLink("https://example.com/manual.pdf");
      expect(db.customField.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ format: true }),
        })
      );
    });

    it("refuses text that is not a web link, and writes nothing", async () => {
      await expect(setOnLink("see binder 3")).rejects.toMatchObject({
        status: 400,
      });
      expect(db.assetCustomFieldValue.createMany).not.toHaveBeenCalled();
    });

    it("stores a link typed without a scheme as https", async () => {
      const { data } = await setOnLink("example.com/manual.pdf");
      expect(data[0].value).toMatchObject({
        raw: "https://example.com/manual.pdf",
      });
    });
  });

  it("refuses the whole selection when an id is not in this workspace", async () => {
    vitest.mocked(assertAssetsBelongToOrg).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Invalid assets",
        label: "Assets",
        status: 400,
      })
    );

    await expect(
      bulkSetAssetCustomField({
        ...args,
        assetIds: ["a1", "foreign"],
        mode: "REPLACE",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(assertAssetsBelongToOrg).toHaveBeenCalledWith(
      { assetIds: ["a1", "foreign"], organizationId: "org-1" },
      db
    );
    expect(db.asset.findMany).not.toHaveBeenCalled();
    expect(db.assetCustomFieldValue.updateMany).not.toHaveBeenCalled();
    expect(db.note.createMany).not.toHaveBeenCalled();
  });

  it("refuses a field that is not in this workspace", async () => {
    vitest.mocked(db.customField.findFirst).mockResolvedValue(null);

    await expect(
      bulkSetAssetCustomField({ ...args, assetIds: ["a1"], mode: "EMPTY_ONLY" })
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("bulkCustomFieldMessage", () => {
  it("says what changed and why the rest were left alone", () => {
    expect(
      bulkCustomFieldMessage({
        resolved: 10,
        changed: 6,
        skippedWithValue: 3,
        skippedCategory: 1,
      })
    ).toBe(
      "Set on 6 assets. 3 assets already had a value and were left alone. 1 asset was skipped because the field does not apply to its category."
    );
  });

  it("agrees the verb with the count", () => {
    expect(
      bulkCustomFieldMessage({
        resolved: 4,
        changed: 0,
        skippedWithValue: 1,
        skippedCategory: 3,
      })
    ).toBe(
      "No asset needed changing. 1 asset already had a value and was left alone. 3 assets were skipped because the field does not apply to their category."
    );
  });

  it("says so when the selection matched nothing", () => {
    expect(
      bulkCustomFieldMessage({
        resolved: 0,
        changed: 0,
        skippedWithValue: 0,
        skippedCategory: 0,
      })
    ).toBe("Your selection no longer matches any assets.");
  });

  it("does not claim a change when nothing moved", () => {
    expect(
      bulkCustomFieldMessage({
        resolved: 2,
        changed: 0,
        skippedWithValue: 2,
        skippedCategory: 0,
      })
    ).toBe(
      "No asset needed changing. 2 assets already had a value and were left alone."
    );
  });
});
