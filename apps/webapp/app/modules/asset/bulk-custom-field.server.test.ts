import type { AssetIndexSettings } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { db } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { createNotes } from "~/modules/note/service.server";
import { lockAssetsForArchiveGuard } from "./archive-lock.server";
import {
  bulkCustomFieldMessage,
  bulkSetAssetCustomField,
} from "./bulk-custom-field.server";

// why: the service reads and writes through Prisma; the assertions are on the
// rows it decides to write, so the client is a stub that runs the transaction
// callback against itself.
vitest.mock("~/database/db.server", () => {
  const client = {
    customField: { findFirst: vitest.fn() },
    asset: { findMany: vitest.fn() },
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
}));

// why: note and event persistence are covered by their own suites; the
// assertions here are on what this action asks them to write.
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue({}),
}));
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

const field = {
  id: "cf-brand",
  name: "Brand",
  type: "OPTION",
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
      ] as never);

    const result = await bulkSetAssetCustomField({
      ...args,
      assetIds: ["a1", "a2"],
      mode: "EMPTY_ONLY",
    });

    expect(result).toMatchObject({ changed: 1, skippedCategory: 1 });
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
      }),
      expect.objectContaining({
        assetId: "a2",
        fromValue: "Siemens",
        toValue: "Westermo",
      }),
    ]);

    const contents = vitest
      .mocked(createNotes)
      .mock.calls.map(([note]) => note.content);
    expect(contents).toEqual([
      expect.stringContaining("set **Brand** to **Westermo**"),
      expect.stringContaining(
        "updated **Brand** from **Siemens** to **Westermo**"
      ),
    ]);
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
      "Set on 6 assets. 3 assets already had a value and were left alone. 1 asset skipped because the field does not apply to their category."
    );
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
