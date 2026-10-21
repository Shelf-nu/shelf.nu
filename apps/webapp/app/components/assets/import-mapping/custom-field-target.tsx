/**
 * @file Name and type of a custom field a column maps to, edited inline under
 * the row's destination picker in the import mapping review. Both inputs carry
 * visible labels: a bare field name next to the picker reads as a value, not
 * as the name of the Shelf field the column fills.
 *
 * @see {@link file://./mapping-review.tsx}
 */
import type { CustomFieldType } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import type { ColumnTarget } from "~/modules/import-mapping/types";
import {
  MAX_CUSTOM_FIELD_NAME_LENGTH,
  customFieldNameSchema,
} from "~/modules/import-mapping/types";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";

type CustomFieldTargetValue = Extract<ColumnTarget, { kind: "customField" }>;

/**
 * Edits a custom field destination.
 *
 * @param props.id - Unique prefix for the inputs' ids
 * @param props.value - The custom field target being edited
 * @param props.onChange - Called with the edited target
 * @param props.existingType - When the workspace already has a field of this
 *   name, its stored type: the importer refuses any other, so the type is
 *   locked to it
 */
export function CustomFieldTarget({
  id,
  value,
  onChange,
  existingType,
}: {
  id: string;
  value: CustomFieldTargetValue;
  onChange: (target: CustomFieldTargetValue) => void;
  existingType?: CustomFieldType;
}) {
  const nameCheck = customFieldNameSchema.safeParse(value.name);
  const nameError = nameCheck.success
    ? undefined
    : nameCheck.error.issues[0]?.message;

  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <div className="flex-1">
        <label
          htmlFor={`${id}-name`}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          Custom field name
        </label>
        <input
          id={`${id}-name`}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-[14px] focus:border-primary-300 focus:ring-primary-25"
          value={value.name}
          maxLength={MAX_CUSTOM_FIELD_NAME_LENGTH}
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? `${id}-name-error` : undefined}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
          // Enter must not submit an enclosing form: the review keeps its edits.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        {nameError ? (
          <p id={`${id}-name-error`} className="mt-1 text-xs text-error-600">
            {nameError}
          </p>
        ) : null}
      </div>
      <div className="sm:w-[190px]">
        <label
          htmlFor={`${id}-type`}
          className="mb-1 block text-xs font-medium text-gray-600"
        >
          Field type
        </label>
        <Select
          value={existingType ?? value.type}
          disabled={Boolean(existingType)}
          onValueChange={(type) =>
            onChange({ ...value, type: type as CustomFieldType })
          }
        >
          <SelectTrigger id={`${id}-type`} className="py-1.5 text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[999999]">
            {Object.entries(FIELD_TYPE_NAME).map(([type, label]) => (
              <SelectItem key={type} value={type}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {existingType ? (
          <p className="mt-1 text-xs text-gray-500">
            Uses your existing field's type
          </p>
        ) : null}
      </div>
    </div>
  );
}
