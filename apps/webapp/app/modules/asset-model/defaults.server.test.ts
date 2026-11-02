import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { recordEvents } from "~/modules/activity-event/service.server";
import { lockAssetsForArchiveGuard } from "~/modules/asset/archive-lock.server";
import { createNotes } from "~/modules/note/service.server";
import type { AssetModelDefaults } from "./defaults";
import type { ModelDefaultsTxClient } from "./defaults.server";
import {
  applyAssetModelDefaultsToAssets,
  fillAssetFormDataFromModel,
  fillLinkedAssetsFromModel,
  parseModelDefaultsFromFormData,
  saveAssetModelCustomFieldDefaults,
} from "./defaults.server";

/**
 * The module's own `db`. Most suites drive the fill through an explicit
 * transaction stub and never reach it; `fillLinkedAssetsFromModel` reads the
 * model and its linked assets through it and opens its transaction on it.
 */
const dbMock = vitest.hoisted(() => ({
  assetModel: { findMany: vitest.fn() },
  customField: { findMany: vitest.fn() },
  asset: { findMany: vitest.fn() },
  user: { findFirst: vitest.fn() },
  $transaction: vitest.fn(),
}));

// why: a Prisma client cannot run in unit tests; each suite states the rows it
// needs on this stub.
vitest.mock("~/database/db.server", () => ({ db: dbMock }));

// why: the lock is a raw `SELECT ... FOR UPDATE` a stubbed transaction cannot
// run; the assertion is that it is taken in the fill's transaction, first.
vitest.mock("~/modules/asset/archive-lock.server", () => ({
  lockAssetsForArchiveGuard: vitest.fn().mockResolvedValue(undefined),
}));

// why: note persistence is covered in `note/service.server.test.ts`; here the
// question is which assets get a note and what it says.
vitest.mock("~/modules/note/service.server", () => ({
  createNotes: vitest.fn().mockResolvedValue({}),
}));

// why: event persistence is covered by the activity-event suite; the
// assertion here is on the emitted payloads.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvents: vitest.fn().mockResolvedValue(undefined),
}));

const recordEventsMock = vitest.mocked(recordEvents);
const createNotesMock = vitest.mocked(createNotes);

/** A model with a category, a valuation and a Brand default. */
function model(
  overrides: Partial<AssetModelDefaults> = {}
): AssetModelDefaults {
  return {
    id: "model-1",
    name: "Westermo L210",
    defaultCategoryId: "cat-network",
    defaultValuation: 450,
    customFieldDefaults: [
      {
        customFieldId: "brand",
        value: { raw: "Westermo", valueOption: "Westermo" },
        customField: {
          id: "brand",
          name: "Brand",
          type: "OPTION",
          active: true,
          deletedAt: null,
          options: ["Westermo", "Siemens"],
          categories: [],
        },
      },
    ],
    ...overrides,
  };
}

describe("fillAssetFormDataFromModel", () => {
  it("fills the blank inputs of a new asset", () => {
    const formData = new FormData();
    formData.set("title", "Switch 33");
    formData.set("category", "");
    formData.set("valuation", "");
    formData.set("cf-brand", "");

    fillAssetFormDataFromModel({ formData, model: model() });

    expect(formData.get("category")).toBe("cat-network");
    expect(formData.get("valuation")).toBe("450");
    expect(formData.get("cf-brand")).toBe("Westermo");
  });

  it("keeps whatever the user typed", () => {
    const formData = new FormData();
    formData.set("category", "cat-mine");
    formData.set("valuation", "12");
    formData.set("cf-brand", "Siemens");

    fillAssetFormDataFromModel({ formData, model: model() });

    expect(formData.get("category")).toBe("cat-mine");
    expect(formData.get("valuation")).toBe("12");
    expect(formData.get("cf-brand")).toBe("Siemens");
  });

  it("treats the edit form's 'uncategorized' as an empty category", () => {
    const formData = new FormData();
    formData.set("category", "uncategorized");

    fillAssetFormDataFromModel({ formData, model: model() });

    expect(formData.get("category")).toBe("cat-network");
  });

  it("on the edit form, leaves a field the saved asset already holds", () => {
    const formData = new FormData();
    formData.set("category", "");
    formData.set("valuation", "");
    formData.set("cf-brand", "");

    fillAssetFormDataFromModel({
      formData,
      model: model(),
      stored: {
        categoryId: "cat-saved",
        valuation: 99,
        customFieldIdsWithValue: new Set(["brand"]),
      },
    });

    expect(formData.get("category")).toBe("");
    expect(formData.get("valuation")).toBe("");
    expect(formData.get("cf-brand")).toBe("");
  });
});

describe("parseModelDefaultsFromFormData", () => {
  const fields = [
    {
      id: "brand",
      name: "Brand",
      type: "OPTION" as const,
      helpText: null,
      options: ["Westermo", "Siemens"],
      categories: [],
    },
    {
      id: "rating",
      name: "Temperature rating",
      type: "NUMBER" as const,
      helpText: null,
      options: [],
      categories: [],
    },
  ];

  it("reads only the fields the form rendered, so a form without the section clears nothing", () => {
    const formData = new FormData();
    formData.set("name", "Westermo L210");

    expect(parseModelDefaultsFromFormData({ formData, fields })).toEqual([]);
  });

  it("returns a value per filled field and undefined for a cleared one", () => {
    const formData = new FormData();
    formData.set("cf-brand", "Westermo");
    formData.set("cf-rating", "");

    const defaults = parseModelDefaultsFromFormData({ formData, fields });

    expect(defaults).toEqual([
      {
        customFieldId: "brand",
        value: { raw: "Westermo", valueOption: "Westermo" },
      },
      { customFieldId: "rating", value: undefined },
    ]);
  });

  it("refuses an option the field does not have", () => {
    const formData = new FormData();
    formData.set("cf-brand", "Not an option");

    expect(() =>
      parseModelDefaultsFromFormData({ formData, fields })
    ).toThrow();
  });
});

describe("saveAssetModelCustomFieldDefaults", () => {
  it("refuses a field from another workspace or of an unsupported type", async () => {
    const tx = {
      customField: {
        // Only "brand" is found in this workspace.
        findMany: vitest
          .fn()
          .mockResolvedValue([{ id: "brand", type: "OPTION" }]),
      },
      assetModelCustomFieldDefault: {
        deleteMany: vitest.fn(),
        upsert: vitest.fn(),
      },
    };

    await expect(
      saveAssetModelCustomFieldDefaults(
        {
          assetModelId: "model-1",
          organizationId: "org-1",
          defaults: [
            { customFieldId: "brand", value: { raw: "Westermo" } },
            { customFieldId: "foreign", value: { raw: "x" } },
          ],
        },
        tx as unknown as ModelDefaultsTxClient
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(tx.assetModelCustomFieldDefault.upsert).not.toHaveBeenCalled();
  });
});

describe("applyAssetModelDefaultsToAssets", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  /**
   * A transaction stub holding the given linked assets. The custom field
   * insert reports every row it is given as inserted unless `inserted` says
   * which (asset, field) pairs actually went in.
   */
  function txWith(
    assets: {
      id: string;
      categoryId: string | null;
      valuation: number | null;
      customFields: { customFieldId: string }[];
    }[],
    inserted?: { assetId: string; customFieldId: string }[]
  ) {
    return {
      $queryRaw: vitest.fn((query: Prisma.Sql) => {
        if (inserted) return Promise.resolve(inserted);
        // The unnest arrays are the first two bound values: asset ids, then
        // custom field ids.
        const [assetIds, fieldIds] = query.values as string[][];
        return Promise.resolve(
          assetIds.map((assetId, i) => ({
            assetId,
            customFieldId: fieldIds[i],
          }))
        );
      }),
      asset: {
        findMany: vitest.fn().mockResolvedValue(assets),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      category: {
        findFirst: vitest.fn().mockResolvedValue({
          id: "cat-network",
          name: "Network",
          color: "#123456",
        }),
      },
    };
  }

  const args = {
    organizationId: "org-1",
    userId: "user-1",
    userLink: "[Carlos](/settings/team/users/user-1)",
    assetIds: ["a-empty", "a-full"],
    currency: "AUD" as const,
    locale: "en-AU",
  };

  it("fills only empty fields, and leaves an asset that has them all alone", async () => {
    const tx = txWith([
      { id: "a-empty", categoryId: null, valuation: null, customFields: [] },
      {
        id: "a-full",
        categoryId: "cat-mine",
        valuation: 10,
        customFields: [{ customFieldId: "brand" }],
      },
    ]);

    const result = await applyAssetModelDefaultsToAssets(
      tx as unknown as ModelDefaultsTxClient,
      { ...args, model: model() }
    );

    expect(result).toEqual({ assetsFilled: 1, fieldsFilled: 3 });
    // Only assets still on the model are read, so one moved off it meanwhile
    // is not filled from it.
    expect(tx.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assetModelId: "model-1" }),
      })
    );
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-empty"] }, organizationId: "org-1" },
      data: { categoryId: "cat-network" },
    });
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-empty"] }, organizationId: "org-1" },
      data: { valuation: 450 },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [query] = tx.$queryRaw.mock.calls[0];
    expect(query.sql).toContain('INSERT INTO "AssetCustomFieldValue"');
    expect(query.sql).toContain("WHERE NOT EXISTS");
    expect(query.values).toEqual([
      ["a-empty"],
      ["brand"],
      [JSON.stringify({ raw: "Westermo", valueOption: "Westermo" })],
    ]);
  });

  it("does not report a custom field value saved between the read and the insert", async () => {
    // The insert skips a pair that already has a value, so nothing is
    // inserted for it and no event or note claims it was filled.
    const tx = txWith(
      [{ id: "a-empty", categoryId: null, valuation: null, customFields: [] }],
      []
    );

    const result = await applyAssetModelDefaultsToAssets(
      tx as unknown as ModelDefaultsTxClient,
      { ...args, assetIds: ["a-empty"], model: model() }
    );

    expect(result).toEqual({ assetsFilled: 1, fieldsFilled: 2 });
    const [events] = recordEventsMock.mock.calls[0];
    expect(events.map((event) => event.action)).toEqual([
      "ASSET_CATEGORY_CHANGED",
      "ASSET_VALUATION_CHANGED",
    ]);
    expect(createNotesMock.mock.calls[0][0].content).not.toContain("Brand");
  });

  it("records one event per filled field and one note per asset, in the transaction", async () => {
    const tx = txWith([
      { id: "a-empty", categoryId: null, valuation: null, customFields: [] },
    ]);

    await applyAssetModelDefaultsToAssets(
      tx as unknown as ModelDefaultsTxClient,
      { ...args, assetIds: ["a-empty"], model: model() }
    );

    const [events, eventTx] = recordEventsMock.mock.calls[0];
    expect(eventTx).toBe(tx);
    expect(events.map((event) => event.action)).toEqual([
      "ASSET_CATEGORY_CHANGED",
      "ASSET_VALUATION_CHANGED",
      "ASSET_CUSTOM_FIELD_CHANGED",
    ]);
    // Each filled field was empty before, so every event starts from null.
    for (const event of events) {
      expect(event).toMatchObject({ fromValue: null, assetId: "a-empty" });
    }

    expect(createNotesMock).toHaveBeenCalledTimes(1);
    const [note, noteTx] = createNotesMock.mock.calls[0];
    expect(noteTx).toBe(tx);
    expect(note.assetIds).toEqual(["a-empty"]);
    expect(note.content).toContain("filled empty fields from the asset model");
    expect(note.content).toContain("**Brand** **Westermo**");
  });

  it("writes nothing when no asset has an empty field to fill", async () => {
    const tx = txWith([
      {
        id: "a-full",
        categoryId: "cat-mine",
        valuation: 10,
        customFields: [{ customFieldId: "brand" }],
      },
    ]);

    const result = await applyAssetModelDefaultsToAssets(
      tx as unknown as ModelDefaultsTxClient,
      { ...args, assetIds: ["a-full"], model: model() }
    );

    expect(result).toEqual({ assetsFilled: 0, fieldsFilled: 0 });
    expect(tx.asset.updateMany).not.toHaveBeenCalled();
    expect(recordEventsMock).not.toHaveBeenCalled();
    expect(createNotesMock).not.toHaveBeenCalled();
  });
});

describe("fillLinkedAssetsFromModel", () => {
  beforeEach(() => {
    vitest.resetAllMocks();
    createNotesMock.mockResolvedValue({ count: 0 });
    recordEventsMock.mockResolvedValue(undefined);
    dbMock.user.findFirst.mockResolvedValue({
      firstName: "Carlos",
      lastName: "Diaz",
      displayName: null,
    });
    dbMock.assetModel.findMany.mockResolvedValue([
      {
        id: "model-1",
        name: "Westermo L210",
        defaultCategoryId: null,
        defaultValuation: 450,
        customFieldDefaults: [
          {
            customFieldId: "brand",
            value: { raw: "Westermo", valueOption: "Westermo" },
          },
        ],
      },
    ]);
    dbMock.customField.findMany.mockResolvedValue([
      {
        id: "brand",
        name: "Brand",
        type: "OPTION",
        active: true,
        deletedAt: null,
        options: ["Westermo", "Siemens"],
        categories: [],
      },
    ]);
  });

  const args = {
    assetModelId: "model-1",
    organizationId: "org-1",
    userId: "user-1",
    currency: "AUD" as const,
    locale: "en-AU",
  };

  /**
   * A transaction holding the given linked assets, run by `db.$transaction`.
   * The custom field insert reports every row it is given as inserted.
   */
  function transactionWith(
    assets: {
      id: string;
      categoryId: string | null;
      valuation: number | null;
      customFields: { customFieldId: string }[];
    }[]
  ) {
    const tx = {
      $queryRaw: vitest.fn((query: Prisma.Sql) => {
        const [assetIds, fieldIds] = query.values as string[][];
        return Promise.resolve(
          assetIds.map((assetId, i) => ({
            assetId,
            customFieldId: fieldIds[i],
          }))
        );
      }),
      asset: {
        findMany: vitest.fn().mockResolvedValue(assets),
        updateMany: vitest.fn().mockResolvedValue({ count: 0 }),
      },
      category: { findFirst: vitest.fn().mockResolvedValue(null) },
    };
    dbMock.asset.findMany.mockResolvedValue(
      assets.map((asset) => ({ id: asset.id }))
    );
    dbMock.$transaction.mockImplementation(
      (callback: (client: typeof tx) => unknown) => callback(tx)
    );
    return tx;
  }

  it("answers 404 when the model is not in the organization", async () => {
    dbMock.assetModel.findMany.mockResolvedValue([]);

    await expect(fillLinkedAssetsFromModel(args)).rejects.toMatchObject({
      status: 404,
    });
    expect(dbMock.asset.findMany).not.toHaveBeenCalled();
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns zeros and opens no transaction when no asset is linked", async () => {
    dbMock.asset.findMany.mockResolvedValue([]);

    await expect(fillLinkedAssetsFromModel(args)).resolves.toEqual({
      assetsFilled: 0,
      fieldsFilled: 0,
    });
    expect(dbMock.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assetModelId: "model-1",
          organizationId: "org-1",
          archivedAt: null,
        },
      })
    );
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("locks the linked assets inside the transaction before filling them", async () => {
    const tx = transactionWith([
      { id: "a-empty", categoryId: null, valuation: null, customFields: [] },
    ]);

    await fillLinkedAssetsFromModel(args);

    expect(lockAssetsForArchiveGuard).toHaveBeenCalledWith(
      tx,
      ["a-empty"],
      "org-1"
    );
    // The lock comes before the fill re-reads the assets.
    expect(
      vitest.mocked(lockAssetsForArchiveGuard).mock.invocationCallOrder[0]
    ).toBeLessThan(tx.asset.findMany.mock.invocationCallOrder[0]);
  });

  it("fills only empty fields and never overwrites a value an asset holds", async () => {
    const tx = transactionWith([
      { id: "a-empty", categoryId: null, valuation: null, customFields: [] },
      {
        id: "a-held",
        categoryId: null,
        valuation: 10,
        customFields: [{ customFieldId: "brand" }],
      },
    ]);

    const result = await fillLinkedAssetsFromModel(args);

    expect(result).toEqual({ assetsFilled: 1, fieldsFilled: 2 });
    // The valuation goes only to the asset without one.
    expect(tx.asset.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-empty"] }, organizationId: "org-1" },
      data: { valuation: 450 },
    });
    // The Brand insert carries only the asset that had no Brand.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const [query] = tx.$queryRaw.mock.calls[0];
    expect(query.values).toEqual([
      ["a-empty"],
      ["brand"],
      [JSON.stringify({ raw: "Westermo", valueOption: "Westermo" })],
    ]);
  });
});
