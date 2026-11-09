/**
 * The asset form pre-fills a picked model's defaults from the model's row.
 * The loader sends only a page of models, while the picker searches all of
 * them, so a picked model may be missing. These tests pin that such a model is
 * fetched once, remembered, and that a failed fetch degrades to "no defaults".
 *
 * @see {@link file://./use-asset-model-lookup.ts}
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FormAssetModel } from "./use-asset-model-lookup";
import {
  assetModelFormDefaultsUrl,
  useAssetModelLookup,
} from "./use-asset-model-lookup";

const loaded: FormAssetModel[] = [
  { id: "m-recent", name: "Recent model", defaultValuation: 10 },
];

const searched: FormAssetModel = {
  id: "m-old",
  name: "LED Light 300W class",
  defaultCategoryId: "cat-lighting",
  defaultValuation: 199,
  customFieldDefaults: [],
};

describe("useAssetModelLookup", () => {
  it("finds a model the loader sent without fetching", async () => {
    const fetchModel = vi.fn();
    const { result } = renderHook(() =>
      useAssetModelLookup(loaded, fetchModel)
    );

    expect(result.current.findModel("m-recent")).toBe(loaded[0]);
    await expect(result.current.loadModel("m-recent")).resolves.toBe(loaded[0]);
    expect(fetchModel).not.toHaveBeenCalled();
  });

  it("fetches a model outside the loaded page and remembers it", async () => {
    const fetchModel = vi.fn().mockResolvedValue(searched);
    const { result } = renderHook(() =>
      useAssetModelLookup(loaded, fetchModel)
    );

    expect(result.current.findModel("m-old")).toBeUndefined();

    let picked: FormAssetModel | undefined;
    await act(async () => {
      picked = await result.current.loadModel("m-old");
    });

    expect(picked).toEqual(searched);
    expect(fetchModel).toHaveBeenCalledWith("m-old");
    // The defaults the form pre-fills are on the row it now finds.
    expect(result.current.findModel("m-old")).toMatchObject({
      defaultCategoryId: "cat-lighting",
      defaultValuation: 199,
    });

    await act(async () => {
      await result.current.loadModel("m-old");
    });
    expect(fetchModel).toHaveBeenCalledTimes(1);
  });

  it("resolves undefined when the model cannot be loaded", async () => {
    const fetchModel = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useAssetModelLookup(loaded, fetchModel)
    );

    let picked: FormAssetModel | undefined = searched;
    await act(async () => {
      picked = await result.current.loadModel("m-old");
    });

    expect(picked).toBeUndefined();
    expect(result.current.findModel("m-old")).toBeUndefined();
  });

  it("returns nothing for no model", () => {
    const { result } = renderHook(() => useAssetModelLookup(loaded, vi.fn()));

    expect(result.current.findModel(undefined)).toBeUndefined();
  });

  it("builds the endpoint URL with the id encoded", () => {
    expect(assetModelFormDefaultsUrl("a/b")).toBe(
      "/api/asset-models/a%2Fb/form-defaults"
    );
  });
});
