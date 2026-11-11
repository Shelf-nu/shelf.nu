/**
 * The asset model row the asset form pre-fills from.
 *
 * The form's loader sends a page of models with their defaults; the model
 * picker also searches the server, whose results carry the same defaults
 * (`/api/model-filters`, see the `assetModel` entry in
 * `model-filters-registry.server.ts`). Either way the form gets the row at the
 * moment of the pick, so the pre-fill is synchronous.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../../utils/model-filters-registry.server.ts}
 */
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import type { PrefillModel } from "./model-default-prefill";

/** A model row as the asset form reads it. */
export type FormAssetModel = PrefillModel & {
  id: string;
  name?: string;
  defaultCategoryId?: string | null;
  image?: string | null;
  thumbnailImage?: string | null;
};

/**
 * Reads a picker search result as a form model row. Search results carry the
 * record's columns at the top level (`/api/model-filters` spreads them).
 */
export function formModelFromPickerItem(item: ModelFilterItem): FormAssetModel {
  const row = item as ModelFilterItem & Partial<FormAssetModel>;
  return {
    id: row.id,
    name: row.name,
    image: row.image ?? null,
    thumbnailImage: row.thumbnailImage ?? null,
    defaultCategoryId: row.defaultCategoryId ?? null,
    defaultValuation: row.defaultValuation ?? null,
    customFieldDefaults: (row.customFieldDefaults ?? []).map(
      (fieldDefault) => ({
        customFieldId: fieldDefault.customFieldId,
        value: fieldDefault.value as ICustomFieldValueJson,
      })
    ),
  };
}

/**
 * The model row for `id`: from the loader's page, or a row picked from search
 * results.
 */
export function findFormModel(
  id: string | undefined,
  loaded: FormAssetModel[] | undefined,
  picked: Readonly<Record<string, FormAssetModel>>
): FormAssetModel | undefined {
  if (!id) return undefined;
  return loaded?.find((m) => m.id === id) ?? picked[id];
}

/**
 * What a model pick means for the form: the previous model (whose untouched
 * pre-fill and default category are taken back), the picked model (whose
 * defaults fill the empty fields), and the picked-row cache after the pick.
 *
 * A model outside the loader's page is read from the row the picker handed
 * over, and kept so later picks can take its fill back.
 *
 * @param args.pickedId - The model just picked, or `undefined` when cleared.
 * @param args.pickedRow - The picked row from the picker, if any.
 * @param args.previousId - The model picked before.
 * @param args.loaded - The loader's page of models.
 * @param args.pickedModels - Rows picked from search results so far.
 */
export function resolveModelPick({
  pickedId,
  pickedRow,
  previousId,
  loaded,
  pickedModels,
}: {
  pickedId: string | undefined;
  pickedRow: FormAssetModel | undefined;
  previousId: string | undefined;
  loaded: FormAssetModel[] | undefined;
  pickedModels: Readonly<Record<string, FormAssetModel>>;
}) {
  const previousModel = findFormModel(previousId, loaded, pickedModels);
  const model = findFormModel(pickedId, loaded, pickedModels) ?? pickedRow;
  const keepRow =
    pickedRow &&
    !pickedModels[pickedRow.id] &&
    !loaded?.some((m) => m.id === pickedRow.id);
  return {
    previousModel,
    model,
    pickedModels: keepRow
      ? { ...pickedModels, [pickedRow.id]: pickedRow }
      : pickedModels,
  };
}
