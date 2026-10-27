/**
 * Custom field defaults section of the asset model form.
 *
 * One optional input per custom field the model can hold a default for. Each
 * value fills the matching field on an asset only when that field is empty,
 * at the moment the asset joins the model. Inputs are named `cf-<id>`, the
 * same as on the asset form, so the server validates them with the same
 * schema.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../../modules/asset-model/defaults.server.ts}
 */
import type { Currency } from "@prisma/client";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import type { ModelDefaultFieldOption } from "~/modules/asset-model/defaults.server";
import { OptionSelect } from "../assets/custom-fields-inputs";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { MarkdownEditor } from "../markdown/markdown-editor";
import { Button } from "../shared/button";
import { DateTimePicker } from "../shared/date-time-picker";

/** Props for {@link AssetModelCustomFieldDefaults}. */
type Props = {
  /** Fields the model can hold a default for. */
  fields: ModelDefaultFieldOption[];
  /** The model's saved defaults, keyed by custom field id. */
  values: Record<string, ICustomFieldValueJson>;
  /** Organization currency, shown on amount fields. */
  currency: Currency;
  /** Per-field validation messages, keyed by `cf-<id>`. */
  errors: Record<string, string | undefined>;
  disabled: boolean;
};

/**
 * Renders the "Default custom field values" rows of the model form.
 */
export function AssetModelCustomFieldDefaults({
  fields,
  values,
  currency,
  errors,
  disabled,
}: Props) {
  /** A saved default in the spelling its input expects. */
  const valueFor = (id: string) => {
    const raw = values[id]?.raw;
    return raw === undefined || raw === null ? "" : String(raw);
  };

  if (fields.length === 0) {
    return (
      <FormRow
        rowLabel="Default custom field values"
        subHeading="Your workspace has no custom fields yet."
        className="border-b-0 py-[10px]"
      >
        <Button to="/settings/custom-fields/new" variant="secondary">
          Create a custom field
        </Button>
      </FormRow>
    );
  }

  return (
    <div className="border-t pt-4">
      <h3 className="text-[16px] font-semibold">Default custom field values</h3>
      <p className="mb-2 text-[14px] text-gray-600">
        When an asset joins this model, these fill its empty fields. Values the
        asset already has are never replaced, and the asset can change them
        afterwards. Yes/no fields can't have a default.
      </p>
      {fields.map((field) => {
        const name = `cf-${field.id}`;
        const error = errors[name];
        const scope =
          field.categories.length > 0
            ? `Only for assets in: ${field.categories
                .map((category) => category.name)
                .join(", ")}.`
            : undefined;
        const subHeading = [field.helpText, scope].filter(Boolean).join(" ");

        return (
          <FormRow
            key={field.id}
            rowLabel={field.name}
            subHeading={subHeading ? <p>{subHeading}</p> : undefined}
            className="border-b-0 py-[10px]"
          >
            {field.type === "OPTION" ? (
              <div className="w-full">
                <OptionSelect
                  field={field}
                  getCustomFieldVal={valueFor}
                  error={error}
                />
              </div>
            ) : field.type === "DATE" ? (
              <DateTimePicker
                mode="date"
                className="w-full"
                label={field.name}
                hideLabel
                name={name}
                defaultValue={valueFor(field.id)}
                clearable
                error={error}
                disabled={disabled}
              />
            ) : field.type === "MULTILINE_TEXT" ? (
              <div className="w-full">
                <MarkdownEditor
                  name={name}
                  label={field.name}
                  defaultValue={valueFor(field.id)}
                  placeholder={field.helpText ?? field.name}
                  disabled={disabled}
                  maxLength={5000}
                />
                {error ? (
                  <p className="mt-1 text-sm text-error-500">{error}</p>
                ) : null}
              </div>
            ) : field.type === "AMOUNT" ? (
              <div className="relative w-full">
                <Input
                  hideLabel
                  type="number"
                  label={field.name}
                  name={name}
                  error={error}
                  defaultValue={valueFor(field.id)}
                  inputClassName="pl-[70px] valuation-input"
                  disabled={disabled}
                  step="any"
                  min={0}
                  className="w-full"
                />
                <span className="absolute bottom-0 border-r px-3 py-2.5 text-gray-600">
                  {currency}
                </span>
              </div>
            ) : (
              <Input
                hideLabel
                type={field.type === "NUMBER" ? "number" : "text"}
                step={field.type === "NUMBER" ? "any" : undefined}
                label={field.name}
                name={name}
                error={error}
                defaultValue={valueFor(field.id)}
                disabled={disabled}
                className="w-full"
              />
            )}
          </FormRow>
        );
      })}
    </div>
  );
}
