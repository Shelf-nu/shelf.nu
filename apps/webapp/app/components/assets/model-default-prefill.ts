/**
 * Model default pre-fill for the asset form.
 *
 * When the user picks an asset model in the asset form, the model's default
 * valuation and default custom field values are shown in the inputs that are
 * still empty, so a required field the model covers does not block the save.
 * It follows the same rule as the server fill (`planModelDefaultFill`): a
 * value the user typed or the asset already holds is never replaced.
 *
 * Switching models swaps only the values the previous model put there and
 * the user left alone. The server fill on save stays the backstop.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./custom-fields-inputs.tsx}
 * @see {@link file://./../../modules/asset-model/defaults.ts}
 */
import type { CustomField } from "@prisma/client";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import {
  defaultValueToFormString,
  isUsableFieldDefault,
} from "~/modules/asset-model/defaults";

/** Pre-fill key for the valuation input. Custom fields use their id. */
export const VALUATION_PREFILL_KEY = "valuation";

/**
 * The values a picked model put into the form.
 *
 * Keys are custom field ids, plus {@link VALUATION_PREFILL_KEY}.
 */
export type ModelPrefill = {
  /** The form string each input is pre-filled with. */
  values: Readonly<Record<string, string>>;
  /**
   * Bumped for a key whenever its pre-filled value changes. The inputs are
   * uncontrolled, so the form uses this in the input's React `key` to remount
   * it with the new value. Inputs whose version does not change keep whatever
   * the user typed.
   */
  versions: Readonly<Record<string, number>>;
};

/** A form with nothing pre-filled. */
export const EMPTY_MODEL_PREFILL: ModelPrefill = { values: {}, versions: {} };

/** The defaults of one model, as the asset form loaders send them. */
export type PrefillModel = {
  defaultValuation?: number | null;
  customFieldDefaults?: {
    customFieldId: string;
    value: ICustomFieldValueJson;
  }[];
};

/**
 * Works out the pre-fill after the user picks a model (or clears it).
 *
 * An input is free for the model when it is empty, or still holds exactly
 * what the previous model put there. A free input takes the new model's
 * default, or goes back to empty when the new model has none. An input the
 * user changed is left alone and forgotten, so no later model touches it.
 *
 * Inputs that are not on screen (a field limited to another category) count
 * as free unless the asset has a saved value for them: they show the
 * pre-filled value if they appear later.
 *
 * @param params.previous - The current pre-fill
 * @param params.model - The picked model, or `undefined` when cleared
 * @param params.readCurrent - The input's current form string, or `null`
 *   when the input is not rendered
 * @param params.savedKeys - Keys the saved asset already holds a value for
 * @returns The next pre-fill
 */
export function planModelPrefill({
  previous,
  model,
  readCurrent,
  savedKeys,
}: {
  previous: ModelPrefill;
  model: PrefillModel | undefined;
  readCurrent: (key: string) => string | null;
  savedKeys: ReadonlySet<string>;
}): ModelPrefill {
  const candidates: Record<string, string> = {};
  if (
    model?.defaultValuation !== null &&
    model?.defaultValuation !== undefined
  ) {
    candidates[VALUATION_PREFILL_KEY] = String(model.defaultValuation);
  }
  for (const fieldDefault of model?.customFieldDefaults ?? []) {
    const formValue = defaultValueToFormString(fieldDefault.value);
    if (formValue !== "") {
      candidates[fieldDefault.customFieldId] = formValue;
    }
  }

  const values: Record<string, string> = {};
  const versions: Record<string, number> = { ...previous.versions };
  const keys = new Set([
    ...Object.keys(previous.values),
    ...Object.keys(candidates),
  ]);

  for (const key of keys) {
    const read = readCurrent(key);
    // The multiline editor always submits its text with a trailing newline,
    // so a blank one reads "\n". Compare without it.
    const current = read === null ? null : withoutTrailingNewlines(read);
    const ours = previous.values[key];
    const isFree =
      current === null
        ? !savedKeys.has(key)
        : current === "" ||
          (ours !== undefined && current === withoutTrailingNewlines(ours));
    if (!isFree) {
      continue;
    }

    const next = candidates[key];
    if (next !== undefined) {
      values[key] = next;
    }
    if (withoutTrailingNewlines(next ?? "") !== (current ?? "")) {
      versions[key] = (versions[key] ?? 0) + 1;
    }
  }

  return { values, versions };
}

/** A form value without the line breaks a multiline editor appends. */
function withoutTrailingNewlines(value: string) {
  return value.replace(/\n+$/, "");
}

/**
 * The pre-filled form string for a custom field, when the field can take it.
 *
 * The field definition comes from the form's loader, which only lists active
 * fields for the current category, so the category rule is already applied.
 * This adds the type check and, for a dropdown, that the value is still one
 * of its options.
 *
 * @param prefill - The current pre-fill
 * @param field - The field being rendered
 * @returns The value to show, or `undefined` to fall back to the saved value
 */
export function getUsablePrefill(
  prefill: ModelPrefill,
  field: Pick<CustomField, "id" | "name" | "type" | "active" | "options">
): string | undefined {
  const value = prefill.values[field.id];
  if (value === undefined) {
    return undefined;
  }
  const usable = isUsableFieldDefault({
    customFieldId: field.id,
    value: { raw: value },
    customField: {
      id: field.id,
      name: field.name,
      type: field.type,
      active: field.active,
      deletedAt: null,
      options: field.options,
      categories: [],
    },
  });
  return usable ? value : undefined;
}

/**
 * React key suffix for a pre-fillable input, so it remounts when the model
 * changes its value and stays mounted otherwise.
 *
 * @param prefill - The current pre-fill
 * @param key - Custom field id or {@link VALUATION_PREFILL_KEY}
 */
export function prefillVersion(prefill: ModelPrefill, key: string) {
  return prefill.versions[key] ?? 0;
}
