/**
 * Finds the asset model the asset form needs, loading it when it is not in
 * the page the loader sent.
 *
 * The asset form loaders send a page of models with their defaults. The model
 * picker searches the server, so the user can pick a model outside that page;
 * without its row the form cannot pre-fill the model's category, value and
 * custom fields or preview its image. `loadModel` fetches such a model once
 * and keeps it, so `findModel` finds it from then on.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../../routes/api+/asset-models.$assetModelId.form-defaults.ts}
 */
import { useCallback, useState } from "react";
import type { PrefillModel } from "./model-default-prefill";

/** A model row as the asset form reads it. */
export type FormAssetModel = PrefillModel & {
  id: string;
  name?: string;
  defaultCategoryId?: string | null;
  image?: string | null;
  thumbnailImage?: string | null;
};

/** URL of the endpoint that returns one model's form defaults. */
export function assetModelFormDefaultsUrl(assetModelId: string) {
  return `/api/asset-models/${encodeURIComponent(assetModelId)}/form-defaults`;
}

/**
 * @param loadedModels - The models the loader sent.
 * @param fetchModel - Fetches one model; injectable for tests.
 */
export function useAssetModelLookup(
  loadedModels: FormAssetModel[] | undefined,
  fetchModel: (
    assetModelId: string
  ) => Promise<FormAssetModel | null> = fetchAssetModelFormDefaults
) {
  const [fetchedModels, setFetchedModels] = useState<
    Record<string, FormAssetModel>
  >({});

  /** The model's row, from the loader or an earlier fetch. */
  const findModel = useCallback(
    (assetModelId: string | undefined) =>
      assetModelId
        ? loadedModels?.find((m) => m.id === assetModelId) ??
          fetchedModels[assetModelId]
        : undefined,
    [loadedModels, fetchedModels]
  );

  /**
   * The model's row, fetching it when neither the loader nor an earlier fetch
   * has it. Resolves `undefined` when it cannot be loaded; the form then saves
   * without the pre-fill and the server fills empty fields on save.
   */
  const loadModel = useCallback(
    async (assetModelId: string) => {
      const known = findModel(assetModelId);
      if (known) return known;

      const fetched = await fetchModel(assetModelId).catch(() => null);
      if (!fetched) return undefined;

      setFetchedModels((prev) => ({ ...prev, [fetched.id]: fetched }));
      return fetched;
    },
    [findModel, fetchModel]
  );

  return { findModel, loadModel };
}

/** Reads one model's form defaults from the API. */
async function fetchAssetModelFormDefaults(
  assetModelId: string
): Promise<FormAssetModel | null> {
  const response = await fetch(assetModelFormDefaultsUrl(assetModelId));
  if (!response.ok) return null;
  const body = (await response.json()) as { assetModel?: FormAssetModel };
  return body.assetModel ?? null;
}
