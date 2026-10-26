import { beforeEach, describe, expect, it, vitest } from "vitest";
import { recordEvents } from "~/modules/activity-event/service.server";
import { createNotes } from "~/modules/note/service.server";
import type { AssetModelDefaults } from "./defaults";
import type { ModelDefaultsTxClient } from "./defaults.server";
import {
  applyAssetModelDefaultsToAssets,
  fillAssetFormDataFromModel,
  parseModelDefaultsFromFormData,
  saveAssetModelCustomFieldDefaults,
} from "./defaults.server";

// why: these tests drive the fill through an explicit transaction stub; the
// module's own `db` import is only a default and must never be reached.
vitest.mock("~/database/db.server", () => ({ db: {} }));

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

  /** A transaction stub holding two linked assets. */
  function txWith(
    assets: {
      id: string;
      categoryId: string | null;
      valuation: number | null;
      customFields: { customFieldId: string }[];
    }[]
  ) {
    return {
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
      assetCustomFieldValue: {
        createMany: vitest.fn().mockResolvedValue({ count: 0 }),
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
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-empty"] }, organizationId: "org-1" },
      data: { categoryId: "cat-network" },
    });
    expect(tx.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a-empty"] }, organizationId: "org-1" },
      data: { valuation: 450 },
    });
    expect(tx.assetCustomFieldValue.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "a-empty",
          customFieldId: "brand",
          value: { raw: "Westermo", valueOption: "Westermo" },
        },
      ],
    });
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
