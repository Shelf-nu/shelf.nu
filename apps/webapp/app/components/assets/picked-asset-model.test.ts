/**
 * A model picked from the picker's search results (outside the loader's page)
 * must pre-fill the asset form exactly like a loaded one. These tests pin that
 * a search result is read as a form row with its defaults, that the row feeds
 * the same pre-fill, and that a loaded row wins over a picked one.
 *
 * @see {@link file://./picked-asset-model.ts}
 */
import { describe, expect, it } from "vitest";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import {
  EMPTY_MODEL_PREFILL,
  planModelPrefill,
  VALUATION_PREFILL_KEY,
} from "./model-default-prefill";
import type { FormAssetModel } from "./picked-asset-model";
import {
  findFormModel,
  formModelFromPickerItem,
  resolveModelPick,
} from "./picked-asset-model";

/** A search result as `/api/model-filters` returns it for an asset model. */
const searchResult = {
  id: "m-old",
  name: "ZZ Test Model",
  color: undefined,
  metadata: {},
  image: null,
  thumbnailImage: null,
  defaultCategoryId: "cat-lighting",
  defaultValuation: 199,
  customFieldDefaults: [{ customFieldId: "cf-brand", value: { raw: "Acme" } }],
} as unknown as ModelFilterItem;

describe("formModelFromPickerItem", () => {
  it("reads a search result's defaults", () => {
    expect(formModelFromPickerItem(searchResult)).toEqual({
      id: "m-old",
      name: "ZZ Test Model",
      image: null,
      thumbnailImage: null,
      defaultCategoryId: "cat-lighting",
      defaultValuation: 199,
      customFieldDefaults: [
        { customFieldId: "cf-brand", value: { raw: "Acme" } },
      ],
    });
  });

  it("reads a result without defaults as a model without any", () => {
    const bare = { id: "m-1", name: "Bare", metadata: {} } as ModelFilterItem;

    expect(formModelFromPickerItem(bare)).toMatchObject({
      defaultCategoryId: null,
      defaultValuation: null,
      customFieldDefaults: [],
    });
  });

  it("pre-fills the empty value and custom field from a searched model", () => {
    const prefill = planModelPrefill({
      previous: EMPTY_MODEL_PREFILL,
      model: formModelFromPickerItem(searchResult),
      readCurrent: () => "",
      savedKeys: new Set(),
    });

    expect(prefill.values[VALUATION_PREFILL_KEY]).toBe("199");
    expect(prefill.values["cf-brand"]).toBe("Acme");
  });
});

describe("findFormModel", () => {
  const loaded: FormAssetModel[] = [{ id: "m-1", defaultValuation: 10 }];
  const picked = { "m-old": formModelFromPickerItem(searchResult) };

  it("finds a loaded model", () => {
    expect(findFormModel("m-1", loaded, picked)).toBe(loaded[0]);
  });

  it("finds a model picked from search results", () => {
    expect(findFormModel("m-old", loaded, picked)).toBe(picked["m-old"]);
  });

  it("prefers the loaded row when the same model was also picked", () => {
    const both = { "m-1": { id: "m-1", defaultValuation: 999 } };

    expect(findFormModel("m-1", loaded, both)).toBe(loaded[0]);
  });

  it("finds nothing for no model", () => {
    expect(findFormModel(undefined, loaded, picked)).toBeUndefined();
  });
});

describe("resolveModelPick", () => {
  const loaded: FormAssetModel[] = [
    { id: "m-1", defaultCategoryId: "cat-loaded", defaultValuation: 10 },
  ];
  const searched = formModelFromPickerItem(searchResult);

  it("uses the picker's row for a model outside the loader's page", () => {
    const pick = resolveModelPick({
      pickedId: "m-old",
      pickedRow: searched,
      previousId: undefined,
      loaded,
      pickedModels: {},
    });

    expect(pick.model).toBe(searched);
    expect(pick.pickedModels).toEqual({ "m-old": searched });
  });

  it("uses the loaded row, and keeps no copy, for a model in the page", () => {
    const pick = resolveModelPick({
      pickedId: "m-1",
      pickedRow: { id: "m-1" },
      previousId: undefined,
      loaded,
      pickedModels: {},
    });

    expect(pick.model).toBe(loaded[0]);
    expect(pick.pickedModels).toEqual({});
  });

  it("takes back a searched model's untouched fill when another model is picked", () => {
    const first = resolveModelPick({
      pickedId: "m-old",
      pickedRow: searched,
      previousId: undefined,
      loaded,
      pickedModels: {},
    });
    const afterFirst = planModelPrefill({
      previous: EMPTY_MODEL_PREFILL,
      model: first.model,
      readCurrent: () => "",
      savedKeys: new Set(),
    });

    const second = resolveModelPick({
      pickedId: "m-1",
      pickedRow: loaded[0],
      previousId: "m-old",
      loaded,
      pickedModels: first.pickedModels,
    });
    // The searched model is still known, so its fill can be taken back.
    expect(second.previousModel).toBe(searched);

    const afterSecond = planModelPrefill({
      previous: afterFirst,
      model: second.model,
      // The inputs still hold what the first model put there.
      readCurrent: (key) => afterFirst.values[key] ?? "",
      savedKeys: new Set(),
    });
    expect(afterSecond.values[VALUATION_PREFILL_KEY]).toBe("10");
    expect(afterSecond.values["cf-brand"]).toBeUndefined();
  });
});
