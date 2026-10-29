/**
 * Bulk "Set custom field" dialog.
 *
 * Sets one custom field to one value on the selected assets. By default it
 * only fills assets that have no value for the field; "Replace all" overwrites
 * every selected asset. The value input follows the field's type, and the
 * server validates it exactly like the asset form.
 *
 * @see {@link file://../../modules/asset/bulk-custom-field.server.ts}
 * @see {@link file://../../routes/api+/assets.bulk-update-custom-field.ts}
 */
import { useState } from "react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import useApiQuery from "~/hooks/use-api-query";
import type { BulkSettableCustomField } from "~/modules/asset/bulk-custom-field.server";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Button } from "../shared/button";
import { DateTimePicker } from "../shared/date-time-picker";

/** Form schema; the value itself is validated server-side against the field. */
export const BulkCustomFieldUpdateSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  customFieldId: z.string().min(1, "Pick a custom field"),
  value: z.string(),
  mode: z.enum(["EMPTY_ONLY", "REPLACE"]).default("EMPTY_ONLY"),
});

/** Shape of `GET /api/assets/bulk-update-custom-field`. */
type CustomFieldsResponse = { customFields: BulkSettableCustomField[] };

/**
 * Dialog for the asset index bulk actions menu. Takes no props: the selection
 * comes from the bulk-update dialog atoms.
 */
export default function BulkCustomFieldUpdateDialog() {
  const zo = useZorm("BulkCustomFieldUpdate", BulkCustomFieldUpdateSchema);
  const isOpen = useAtomValue(bulkDialogAtom)["custom-field"] === true;
  const [fieldId, setFieldId] = useState<string>("");
  const [mode, setMode] = useState<"EMPTY_ONLY" | "REPLACE">("EMPTY_ONLY");

  // Every opening starts from a clean form: no field, and the safe mode. The
  // dialog stays mounted between openings, so its state would otherwise carry
  // over, including a "Replace" picked for a previous batch.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setFieldId("");
      setMode("EMPTY_ONLY");
    }
  }

  // Read only while the dialog is open, so the index page pays nothing.
  const { data, isLoading } = useApiQuery<CustomFieldsResponse>({
    api: "/api/assets/bulk-update-custom-field",
    enabled: isOpen,
  });
  const fields = data?.customFields ?? [];
  const field = fields.find((f) => f.id === fieldId);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="custom-field"
      arrayFieldId="assetIds"
      title="Set custom field"
      description="Pick a field and a value. By default only assets without a value for that field are filled."
      allowBodyOverflow
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-6 flex flex-col gap-4">
            <div>
              <label
                className="mb-1 block text-sm font-medium text-gray-700"
                htmlFor="bulk-cf-field"
              >
                Custom field
              </label>
              <Select
                name="customFieldId"
                value={fieldId}
                onValueChange={setFieldId}
                disabled={disabled || isLoading}
              >
                <SelectTrigger id="bulk-cf-field">
                  <SelectValue
                    placeholder={isLoading ? "Loading..." : "Pick a field"}
                  />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="w-[var(--radix-select-trigger-width)]"
                  align="start"
                >
                  <div className="max-h-[320px] overflow-auto">
                    {fields.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="p-2">
                        {f.name}
                      </SelectItem>
                    ))}
                  </div>
                </SelectContent>
              </Select>
              {zo.errors.customFieldId()?.message ? (
                <p className="text-sm text-error-500">
                  {zo.errors.customFieldId()?.message}
                </p>
              ) : null}
              {field && field.categories.length > 0 ? (
                <p className="mt-1 text-[12px] text-gray-500">
                  Only for assets in:{" "}
                  {field.categories.map((c) => c.name).join(", ")}. Other assets
                  are skipped.
                </p>
              ) : null}
            </div>

            {/* Keyed by field so switching fields starts from an empty value. */}
            {field ? <ValueInput key={field.id} field={field} /> : null}

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-gray-700">
                Assets that already have a value
              </legend>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="mode"
                  value="EMPTY_ONLY"
                  checked={mode === "EMPTY_ONLY"}
                  onChange={() => setMode("EMPTY_ONLY")}
                  disabled={disabled}
                />
                Leave them as they are (only fill empty fields)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="mode"
                  value="REPLACE"
                  checked={mode === "REPLACE"}
                  onChange={() => setMode("REPLACE")}
                  disabled={disabled}
                />
                Replace their value
              </label>
            </fieldset>

            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled || !field}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}

/**
 * The value input for the chosen field, posted as `value` in the spelling the
 * asset form uses: dates as `YYYY-MM-DD`, a yes/no field as `on` or `off`.
 */
function ValueInput({ field }: { field: BulkSettableCustomField }) {
  const label = `Value for ${field.name}`;

  switch (field.type) {
    case "OPTION":
    case "BOOLEAN": {
      const options =
        field.type === "BOOLEAN"
          ? [
              { value: "on", label: "Yes" },
              { value: "off", label: "No" },
            ]
          : field.options.filter((o) => o).map((o) => ({ value: o, label: o }));
      return (
        <div>
          <label
            className="mb-1 block text-sm font-medium text-gray-700"
            htmlFor="bulk-cf-value"
          >
            {label}
          </label>
          {/* Required: an unanswered yes/no would otherwise post as "No". */}
          <Select name="value" required>
            <SelectTrigger id="bulk-cf-value">
              <SelectValue placeholder="Pick a value" />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="w-[var(--radix-select-trigger-width)]"
              align="start"
            >
              <div className="max-h-[320px] overflow-auto">
                {options.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="p-2">
                    {o.label}
                  </SelectItem>
                ))}
              </div>
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "DATE":
      return (
        <DateTimePicker mode="date" name="value" label={label} clearable />
      );
    case "MULTILINE_TEXT":
      return (
        <Input
          inputType="textarea"
          name="value"
          label={label}
          maxLength={5000}
        />
      );
    case "NUMBER":
    case "AMOUNT":
      return <Input type="number" step="any" name="value" label={label} />;
    default:
      return <Input name="value" label={label} />;
  }
}
