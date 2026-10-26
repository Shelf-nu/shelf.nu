import { describe, expect, it } from "vitest";
import type { AssetModelDefaults, ModelCustomFieldDefault } from "./defaults";
import {
  defaultValueToFormString,
  fieldAppliesToCategory,
  isEmptyFill,
  planModelDefaultFill,
} from "./defaults";

/** A default for a field of the given type, active and unscoped unless told. */
function fieldDefault(
  overrides: Partial<ModelCustomFieldDefault["customField"]> & { id: string },
  raw: string | number = "Westermo"
): ModelCustomFieldDefault {
  return {
    customFieldId: overrides.id,
    value: { raw, valueText: String(raw) },
    customField: {
      name: overrides.id,
      type: "TEXT",
      active: true,
      deletedAt: null,
      options: [],
      categories: [],
      ...overrides,
    },
  };
}

/** A model with a category, a valuation and one Brand default. */
function model(
  overrides: Partial<AssetModelDefaults> = {}
): AssetModelDefaults {
  return {
    id: "model-1",
    name: "Westermo L210",
    defaultCategoryId: "cat-network",
    defaultValuation: 450,
    customFieldDefaults: [fieldDefault({ id: "cf-brand", name: "Brand" })],
    ...overrides,
  };
}

/** An asset with nothing filled in. */
const emptyAsset = {
  categoryId: null,
  valuation: null,
  customFieldIdsWithValue: new Set<string>(),
};

describe("planModelDefaultFill", () => {
  it("fills every empty field the model has a default for", () => {
    const fill = planModelDefaultFill({ model: model(), current: emptyAsset });

    expect(fill.categoryId).toBe("cat-network");
    expect(fill.valuation).toBe(450);
    expect(fill.customFields.map((d) => d.customFieldId)).toEqual(["cf-brand"]);
  });

  it("never replaces a value the asset already has", () => {
    const fill = planModelDefaultFill({
      model: model(),
      current: {
        categoryId: "cat-other",
        valuation: 10,
        customFieldIdsWithValue: new Set(["cf-brand"]),
      },
    });

    expect(isEmptyFill(fill)).toBe(true);
  });

  it("treats a valuation of zero as a value, not as empty", () => {
    const fill = planModelDefaultFill({
      model: model(),
      current: { ...emptyAsset, valuation: 0 },
    });

    expect(fill.valuation).toBeUndefined();
  });

  it("skips a field limited to a category the asset is not in", () => {
    const scoped = fieldDefault({
      id: "cf-rating",
      categories: [{ id: "cat-power" }],
    });

    const fill = planModelDefaultFill({
      model: model({ customFieldDefaults: [scoped] }),
      current: { ...emptyAsset, categoryId: "cat-network" },
    });

    expect(fill.customFields).toEqual([]);
  });

  it("decides category first, so a field scoped to the filled category is filled", () => {
    const scoped = fieldDefault({
      id: "cf-ports",
      categories: [{ id: "cat-network" }],
    });

    const fill = planModelDefaultFill({
      model: model({ customFieldDefaults: [scoped] }),
      current: emptyAsset,
    });

    expect(fill.categoryId).toBe("cat-network");
    expect(fill.customFields.map((d) => d.customFieldId)).toEqual(["cf-ports"]);
  });

  it("ignores a dropdown default whose option was removed from the field", () => {
    const fill = planModelDefaultFill({
      model: model({
        defaultCategoryId: null,
        defaultValuation: null,
        customFieldDefaults: [
          fieldDefault(
            { id: "cf-brand", type: "OPTION", options: ["Siemens"] },
            "Westermo"
          ),
        ],
      }),
      current: emptyAsset,
    });

    expect(isEmptyFill(fill)).toBe(true);
  });

  it("ignores defaults whose field is inactive, deleted or a yes/no field", () => {
    const fill = planModelDefaultFill({
      model: model({
        defaultCategoryId: null,
        defaultValuation: null,
        customFieldDefaults: [
          fieldDefault({ id: "cf-inactive", active: false }),
          fieldDefault({ id: "cf-deleted", deletedAt: new Date() }),
          fieldDefault({ id: "cf-bool", type: "BOOLEAN" }),
        ],
      }),
      current: emptyAsset,
    });

    expect(isEmptyFill(fill)).toBe(true);
  });
});

describe("fieldAppliesToCategory", () => {
  it("applies an unscoped field to every asset, with or without a category", () => {
    expect(fieldAppliesToCategory({ categories: [] }, null)).toBe(true);
    expect(fieldAppliesToCategory({ categories: [] }, "cat-1")).toBe(true);
  });

  it("applies a scoped field only to assets in one of its categories", () => {
    const field = { categories: [{ id: "cat-1" }] };
    expect(fieldAppliesToCategory(field, "cat-1")).toBe(true);
    expect(fieldAppliesToCategory(field, "cat-2")).toBe(false);
    expect(fieldAppliesToCategory(field, null)).toBe(false);
  });
});

describe("defaultValueToFormString", () => {
  it("spells a stored value the way the asset form submits it", () => {
    expect(defaultValueToFormString({ raw: 12.5, valueText: "12.5" })).toBe(
      "12.5"
    );
    expect(
      defaultValueToFormString({
        raw: "2026-10-26",
        valueDate: "2026-10-26T00:00:00.000Z",
      })
    ).toBe("2026-10-26");
  });
});
