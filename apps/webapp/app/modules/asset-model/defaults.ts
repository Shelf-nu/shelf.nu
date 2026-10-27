/**
 * Asset model defaults: which empty fields a model fills on an asset.
 *
 * An asset model can carry a default category, a default valuation and
 * default custom field values. They all follow one rule: when an asset joins
 * the model, each default fills the matching field only if that field is
 * empty. Nothing is overwritten and nothing stays linked afterwards, so the
 * asset owns every value from then on.
 *
 * This module is pure so the create form, the edit form, bulk assign, the
 * import and the "fill linked assets" action all decide the same way.
 *
 * @see {@link file://./defaults.server.ts}
 */
import type { CustomField, CustomFieldType } from "@prisma/client";
import type { ICustomFieldValueJson } from "~/modules/asset/types";

/**
 * Custom field types a model can hold a default for.
 *
 * BOOLEAN is left out: the asset form always submits a yes/no switch, so a
 * yes/no field is never empty and a default could never apply.
 */
export const MODEL_DEFAULT_FIELD_TYPES: readonly CustomFieldType[] = [
  "TEXT",
  "MULTILINE_TEXT",
  "OPTION",
  "DATE",
  "NUMBER",
  "AMOUNT",
];

/** The parts of a custom field definition the fill rule reads. */
export type ModelDefaultField = Pick<
  CustomField,
  "id" | "name" | "type" | "active" | "deletedAt" | "options"
> & {
  /** Categories the field is limited to. Empty means every category. */
  categories: { id: string }[];
};

/** One default custom field value held by a model. */
export type ModelCustomFieldDefault = {
  customFieldId: string;
  /** Same shape as `AssetCustomFieldValue.value`. */
  value: ICustomFieldValueJson;
  customField: ModelDefaultField;
};

/** A model's defaults, as read by `getAssetModelDefaults`. */
export type AssetModelDefaults = {
  id: string;
  name: string;
  defaultCategoryId: string | null;
  defaultValuation: number | null;
  customFieldDefaults: ModelCustomFieldDefault[];
};

/** What an asset already holds, for the fields a model could fill. */
export type AssetFillState = {
  categoryId: string | null;
  valuation: number | null;
  /** Ids of the custom fields that already have a value on the asset. */
  customFieldIdsWithValue: ReadonlySet<string>;
};

/** The fields a model fills on one asset. Absent keys are left alone. */
export type ModelDefaultFill = {
  categoryId?: string;
  valuation?: number;
  customFields: ModelCustomFieldDefault[];
};

/**
 * Whether a custom field is shown for (and so can be filled on) an asset in
 * the given category: fields limited to categories apply only to those.
 */
export function fieldAppliesToCategory(
  field: Pick<ModelDefaultField, "categories">,
  categoryId: string | null
) {
  if (field.categories.length === 0) {
    return true;
  }
  return (
    Boolean(categoryId) && field.categories.some((c) => c.id === categoryId)
  );
}

/**
 * Whether a stored default can still be used: its field is active, not
 * deleted, of a type a model can default, and for a dropdown field the value
 * is still one of its options. A removed option is never filled, because the
 * asset form would refuse it on a field the user did not touch.
 */
export function isUsableFieldDefault(fieldDefault: ModelCustomFieldDefault) {
  const { customField, value } = fieldDefault;
  return (
    customField.active &&
    customField.deletedAt === null &&
    MODEL_DEFAULT_FIELD_TYPES.includes(customField.type) &&
    (customField.type !== "OPTION" ||
      customField.options.includes(String(value.raw)))
  );
}

/**
 * Decides which of an asset's empty fields a model fills.
 *
 * The category is decided first because it decides which custom fields the
 * asset has: a field limited to other categories is never filled.
 *
 * @param params.model - The model's defaults
 * @param params.current - What the asset already holds
 * @returns The fields to fill; empty when there is nothing to do
 */
export function planModelDefaultFill({
  model,
  current,
}: {
  model: AssetModelDefaults;
  current: AssetFillState;
}): ModelDefaultFill {
  const fill: ModelDefaultFill = { customFields: [] };

  if (!current.categoryId && model.defaultCategoryId) {
    fill.categoryId = model.defaultCategoryId;
  }
  if (current.valuation === null && model.defaultValuation !== null) {
    fill.valuation = model.defaultValuation;
  }

  const categoryId = current.categoryId ?? fill.categoryId ?? null;
  fill.customFields = model.customFieldDefaults.filter(
    (fieldDefault) =>
      isUsableFieldDefault(fieldDefault) &&
      !current.customFieldIdsWithValue.has(fieldDefault.customFieldId) &&
      fieldAppliesToCategory(fieldDefault.customField, categoryId)
  );

  return fill;
}

/** Whether a fill plan changes nothing. */
export function isEmptyFill(fill: ModelDefaultFill) {
  return (
    fill.categoryId === undefined &&
    fill.valuation === undefined &&
    fill.customFields.length === 0
  );
}

/**
 * The form-input spelling of a stored default, as the asset form would
 * submit it (`cf-<id>`): dates as `YYYY-MM-DD`, numbers as plain digits.
 */
export function defaultValueToFormString(value: ICustomFieldValueJson) {
  return value.raw === null || value.raw === undefined ? "" : String(value.raw);
}
